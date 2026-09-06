import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {planBuildDisplayContent, planFromWire} from '../plan.js';
import {normalizeToolOutput} from '../toolOutput.js';
import {rememberDocument} from '../chatDocument.js';
import {runChromeTransition} from '../runChrome.js';
import {entryMatchesKey, sameTurn} from '../turnIdentity.js';
import type {EntrySegment, TranscriptEntry, TranscriptState} from './state.js';

type RestoredTurn = Parameters<typeof entriesFromRestoredTurns>[0][number];

export function applySessionRestored(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'session_restored'}>
): TranscriptState {
	const activeAssistants = state.entries.filter(
		e => e.role === 'assistant' && e.status === 'streaming'
	);
	const liveIds = new Set(
		activeAssistants.flatMap(a => [a.turnId, a.clientMessageId].filter(Boolean) as string[])
	);
	const activeUsers = state.entries.filter(
		e =>
			e.role === 'user' &&
			((e.turnId && liveIds.has(e.turnId)) ||
				(e.clientMessageId && liveIds.has(e.clientMessageId)) ||
				activeAssistants.some(a => {
					const idx = state.entries.indexOf(a);
					return idx > 0 && state.entries[idx - 1] === e;
				}))
	);
	const liveUserTexts = new Set(activeUsers.map(u => u.text));
	const restoredEntries = entriesFromRestoredTurns(event.turns, liveUserTexts)
		.filter(e => !(e.turnId && liveIds.has(e.turnId)) && !(e.clientMessageId && liveIds.has(e.clientMessageId)));
	const live = activeAssistants.length > 0;
	const hydratedAssistants = activeAssistants.map(entry =>
		hydrateLiveAssistant(entry, event.turns)
	);
	const history = live
		? restoredEntries
		: keepLiveProse(restoredEntries, state.entries);
	const restoredDoc = [...history].reverse().find(e => e.role === 'assistant' && !e.messageType);
	const superseded = {...state.superseded};
	for (const rt of event.turns) {
		if (rt.supersedes) {
			superseded[rt.supersedes] = rt.turnId;
		}
	}
	return {
		...rememberDocument(state, live ? state.lastDocumentId : restoredDoc?.turnId),
		entries: [...history, ...activeUsers, ...hydratedAssistants],
		superseded,
		hasMoreOlder: event.hasMoreOlder ?? false,
		totalTurnCount: event.totalTurnCount ?? event.turns.length,
		restoredPromptTexts: event.turns.map(rt => rt.userText.trim()).filter(Boolean),
		// Cold Attach has no local streaming: history is done. Arm the same
		// straggler guard as turn_finished so persist TurnStarted cannot
		// reopen a streaming row and relight Composer Stop.
		...(live
			? {chrome: state.chrome}
			: {
					chrome: runChromeTransition(state.chrome, {
						run: 'clear',
						postRun: true,
						awaiting: false
					})
				})
	};
}

export function applySessionHistoryPage(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'session_history_page'}>
): TranscriptState {
	const existingIds = new Set(state.entries.map(e => e.id));
	const existingTurnKeys = new Set(
		state.entries.flatMap(e =>
			[e.turnId, e.clientMessageId]
				.filter((k): k is string => Boolean(k))
				.map(k => `${e.role}:${k}`)
		)
	);
	const older = entriesFromRestoredTurns(event.turns).filter(
		e =>
			!existingIds.has(e.id) &&
			!(e.turnId && existingTurnKeys.has(`${e.role}:${e.turnId}`)) &&
			!(e.clientMessageId && existingTurnKeys.has(`${e.role}:${e.clientMessageId}`))
	);
	const superseded = {...state.superseded};
	for (const rt of event.turns) {
		if (rt.supersedes) {
			superseded[rt.supersedes] = rt.turnId;
		}
	}
	return {
		...state,
		entries: [...older, ...state.entries],
		superseded,
		hasMoreOlder: event.hasMoreOlder,
		totalTurnCount: event.totalTurnCount
	};
}

function entriesFromRestoredTurns(
	turns: Array<{
		turnId: string;
		userText: string;
		assistantText: string;
		thinking?: string | null;
		tools?: Array<{
			id: string;
			tool: string;
			args?: Record<string, string> | null;
			status: string;
			summary?: string | null;
		}> | null;
		steps?: Parameters<typeof restoreSegmentsFromTurn>[0]['steps'];
		origin?: string | null;
		userMessageType?: string | null;
		planId?: string | null;
		planName?: string | null;
		assistantMessageType?: string | null;
		goalId?: string | null;
		goalStatus?: string | null;
		goalStepId?: string | null;
		goalAgentName?: string | null;
		goalVerdict?: string | null;
		failed?: boolean | null;
	}>,
	skipUserTexts?: Set<string>
): TranscriptEntry[] {
	const restoredEntries: TranscriptEntry[] = [];
	for (const rt of turns) {
		const goalMsg =
			rt.assistantMessageType === 'goal_step_conclusion' ||
			rt.assistantMessageType === 'goal_outcome'
				? rt.assistantMessageType
				: null;
		if (goalMsg) {
			const verdictRaw = rt.goalVerdict?.trim().toLowerCase() ?? '';
			const verdict =
				verdictRaw === 'pass' || verdictRaw === 'reject' ? verdictRaw : undefined;
			restoredEntries.push({
				id: `assistant-${rt.turnId}`,
				role: 'assistant',
				text: rt.assistantText,
				reasoning: '',
				status: 'done',
				turnId: rt.turnId,
				messageType: goalMsg,
				...(rt.goalAgentName?.trim() ? {goalAgentName: rt.goalAgentName.trim()} : {}),
				...(verdict ? {goalVerdict: verdict} : {}),
				...(rt.goalId?.trim() ? {goalId: rt.goalId.trim()} : {}),
				...(rt.goalStepId?.trim() ? {goalStepId: rt.goalStepId.trim()} : {}),
				...(rt.goalStatus?.trim() ? {goalStatus: rt.goalStatus.trim()} : {})
			});
			continue;
		}
		const failed = rt.failed === true;
		const emptyAssistant = !rt.assistantText.trim();
		if (emptyAssistant && !failed && skipUserTexts?.has(rt.userText)) continue;
		const planBuild =
			rt.userMessageType === 'plan_build' && rt.planId
				? {
						messageType: 'plan_build' as const,
						planId: rt.planId,
						planName: rt.planName?.trim() || undefined
					}
				: null;
		const userText =
			rt.userText ||
			(planBuild ? planBuildDisplayContent(rt.planName ?? '', rt.planId!) : '');
		if (userText) {
			const origin = rt.origin?.trim() || undefined;
			restoredEntries.push({
				id: `user-${rt.turnId}`,
				role: 'user',
				text: userText,
				status: 'done',
				turnId: rt.turnId,
				...(origin ? {origin} : {}),
				...(planBuild ?? {})
			});
		}
		restoredEntries.push({
			id: `assistant-${rt.turnId}`,
			role: 'assistant',
			text: rt.assistantText,
			reasoning: rt.thinking ?? '',
			status: failed ? 'error' : 'done',
			turnId: rt.turnId,
			tools: (rt.tools ?? []).map(t => ({
				id: t.id,
				tool: t.tool,
				args: t.args ?? undefined,
				output: normalizeToolOutput(t.summary ?? ''),
				status: t.status === 'failed' || t.status === 'error' ? 'error' : 'success'
			})),
			segments: restoreSegmentsFromTurn(rt)
		});
	}
	return restoredEntries;
}

function restoreSegmentsFromTurn(rt: {
	turnId: string;
	assistantText: string;
	thinking?: string | null;
	tools?: Array<{id: string}> | null;
	steps?: Array<{
		reasoning?: string | null;
		tools?: Array<{id: string}> | null;
		text?: string | null;
		textBeforeTools?: boolean | null;
		/** Session Plan from Bridge restore (`message_type=plan`). */
		plan?: {
			planId: string;
			name?: string | null;
			overview?: string | null;
			todos?: Array<{id?: string; content?: string; status?: string}> | null;
			body?: string | null;
			payloadJson?: string | null;
		} | null;
	}> | null;
}): EntrySegment[] {
	const steps = rt.steps ?? [];
	if (steps.length > 0) {
		const segments: EntrySegment[] = [];
		for (const [index, step] of steps.entries()) {
			if (step.reasoning?.trim()) {
				segments.push({
					kind: 'thinking',
					id: `seg-th-${rt.turnId}-${index}`,
					text: step.reasoning,
					sealedAt: 0
				});
			}
			const toolIds = (step.tools ?? []).map(t => t.id);
			const text = step.text?.trim() ? step.text : undefined;
			const pushTools = () => {
				if (toolIds.length === 0) return;
				segments.push({
					kind: 'tools',
					id: `seg-t-${rt.turnId}-${index}`,
					toolIds
				});
			};
			const pushText = () => {
				if (!text) return;
				segments.push({
					kind: 'assistant',
					id: `seg-a-${rt.turnId}-${index}`,
					text
				});
			};
			const pushPlan = () => {
				const plan = step.plan
					? planFromWire({
							planId: step.plan.planId,
							name: step.plan.name,
							overview: step.plan.overview,
							todos: step.plan.todos,
							body: step.plan.body,
							payloadJson: step.plan.payloadJson
						})
					: null;
				if (!plan) return;
				segments.push({
					kind: 'plan',
					id: `seg-plan-${plan.planId}`,
					plan
				});
			};
			if (step.textBeforeTools) {
				pushText();
				pushTools();
			} else {
				pushTools();
				pushText();
			}
			// Plan card after thin upsert_plan tool ack in the same step (not from tool_result body).
			pushPlan();
		}
		return segments;
	}
	return restoreSegments(rt.turnId, rt.assistantText, rt.tools ?? [], rt.thinking ?? undefined);
}

function restoreSegments(
	turnId: string,
	assistantText: string,
	tools: Array<{id: string}>,
	thinking?: string
): EntrySegment[] {
	const segments: EntrySegment[] = [];
	if (thinking?.trim()) {
		segments.push({
			kind: 'thinking',
			id: `seg-th-${turnId}`,
			text: thinking,
			sealedAt: 0
		});
	}
	if (tools.length > 0) {
		segments.push({
			kind: 'tools',
			id: `seg-t-${turnId}`,
			toolIds: tools.map(t => t.id)
		});
	}
	if (assistantText.trim()) {
		segments.push({
			kind: 'assistant',
			id: `seg-a-${turnId}`,
			text: assistantText
		});
	}
	return segments;
}

/** Settled attach must not replace a painted body with a thinking-only restore. */
function keepLiveProse(restored: TranscriptEntry[], live: TranscriptEntry[]): TranscriptEntry[] {
	return restored.map(entry => {
		if (entry.role !== 'assistant' || entry.text.trim()) return entry;
		const src = [...live]
			.reverse()
			.find(
				e =>
					e.role === 'assistant' &&
					e.status !== 'cancelled' &&
					e.text.trim() &&
					sameTurn(e, entry)
			);
		if (!src) return entry;
		const hasAssistantSeg = (entry.segments ?? []).some(
			s => s.kind === 'assistant' && s.text.trim()
		);
		return {
			...entry,
			text: src.text,
			reasoning: entry.reasoning?.trim() ? entry.reasoning : src.reasoning,
			segments: hasAssistantSeg
				? entry.segments
				: src.segments && src.segments.length > 0
					? src.segments
					: entry.segments
		};
	});
}

function hydrateLiveAssistant(
	live: TranscriptEntry,
	turns: RestoredTurn[]
): TranscriptEntry {
	if (live.text.trim()) return live;
	const rt = turns.find(t => entryMatchesKey(live, t.turnId));
	if (!rt?.assistantText.trim()) return live;
	const seeded = entriesFromRestoredTurns([rt]).find(e => e.role === 'assistant');
	if (!seeded) return live;
	return {
		...live,
		text: seeded.text,
		reasoning: live.reasoning?.trim() ? live.reasoning : seeded.reasoning,
		segments: live.segments && live.segments.length > 0 ? live.segments : seeded.segments,
		tools: live.tools && live.tools.length > 0 ? live.tools : seeded.tools
	};
}
