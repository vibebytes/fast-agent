import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {documentCard, forgetDocument, rememberDocument} from '../chatDocument.js';
import {planBuildDisplayContent} from '../plan.js';
import {chromePostRun, chromeRunId, runChromeTransition} from '../runChrome.js';
import {
	entryMatchesKey,
	entryTurnIdIs,
	isGoalNoticeId,
	isScheduledId,
	sameTurn,
	serverRunIdOf
} from '../turnIdentity.js';
import {patchAssistant, sealOpenThinking, sealStreamingAsDone} from './entry.js';
import type {TranscriptEntry, TranscriptState} from './state.js';

/** Per-run delta views (usage / prune notices) must not leak into the next turn. */
const freshRunDeltas: Pick<TranscriptState, 'usage' | 'contextPrunes'> = {
	usage: undefined,
	contextPrunes: undefined
};

/** Opener belongs to a Turn the transcript already shows — by id, or by repeating
 *  a prompt that came from the restore snapshot (persist ids differ from snapshot ids). */
function isKnownTurnOpener(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'turn_started'}>
): boolean {
	const key = event.turnId ?? event.clientMessageId ?? '';
	if (key && state.entries.some(e => entryMatchesKey(e, key))) {
		return true;
	}
	const text = (event.text ?? '').trim();
	if (!text) return false;
	return (state.restoredPromptTexts ?? []).includes(text);
}

/** Attach replay of a finished chat turn — not a live Goal notice or a new user submit. */
function isAttachReplayChatOpener(event: BridgeEvent): boolean {
	if (event.type !== 'turn_started') return false;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome') return false;
	if (event.messageType === 'plan_build') return false;
	const turn = event.turnId ?? event.clientMessageId ?? '';
	if (isGoalNoticeId(turn)) return false;
	if (typeof event.eventSeq === 'number' && event.eventSeq > 0) return true;
	return isRiverTurnStarted(event);
}

/** Persist/river TurnStarted: empty text, not a user/plan/goal opener. */
function isRiverTurnStarted(
	event: BridgeEvent
): event is Extract<BridgeEvent, {type: 'turn_started'}> {
	if (event.type !== 'turn_started') return false;
	if ((event.text ?? '').trim()) return false;
	if (event.messageType === 'plan_build') return false;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome')
		return false;
	const turn = event.turnId ?? event.clientMessageId ?? '';
	if (isGoalNoticeId(turn)) return false;
	return true;
}

/** River TurnStarted has the engine run id and empty text — remap onto the live optimistic turn. */
function riverEchoAssistant(state: TranscriptState, event: BridgeEvent): TranscriptEntry | undefined {
	if (event.type !== 'turn_started') return undefined;
	if ((event.text ?? '').trim()) return undefined;
	if (event.clientMessageId) return undefined;
	if (event.messageType === 'plan_build') return undefined;
	const runId = chromeRunId(state.chrome);
	if (!runId) return undefined;
	return state.entries.find(
		e =>
			e.role === 'assistant' && e.status === 'streaming' && !e.messageType && entryMatchesKey(e, runId)
	);
}

/** Same chat turn, sealed for approval / user-wait — resume instead of a second card. */
function resumeSealedAssistant(
	state: TranscriptState,
	event: BridgeEvent
): TranscriptEntry | undefined {
	if (chromePostRun(state.chrome)) return undefined;
	if (event.type !== 'turn_started') return undefined;
	if (event.messageType === 'plan_build') return undefined;
	if (event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome')
		return undefined;
	for (let i = state.entries.length - 1; i >= 0; i -= 1) {
		const e = state.entries[i]!;
		if (e.role !== 'assistant' || e.status !== 'done' || e.messageType) continue;
		if (entryMatchesKey(e, event.clientMessageId) || entryMatchesKey(e, event.turnId)) return e;
	}
	return undefined;
}

function finishesActiveRun(state: TranscriptState, turnId: string | undefined): boolean {
	if (!turnId) return true;
	const activeRun = chromeRunId(state.chrome);
	if (!activeRun) return true;
	if (activeRun === turnId) return true;
	return state.entries.some(
		e => e.role === 'assistant' && entryMatchesKey(e, turnId) && entryMatchesKey(e, activeRun)
	);
}

export function applyTurnStarted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'turn_started'}>
): TranscriptState {
	const goalMsg =
		event.messageType === 'goal_step_conclusion' || event.messageType === 'goal_outcome'
			? event.messageType
			: null;
	if (chromePostRun(state.chrome) && isAttachReplayChatOpener(event)) {
		if (isKnownTurnOpener(state, event)) return state;
	}
	if (goalMsg) {
		const turnKey = event.turnId ?? event.clientMessageId ?? `goal-${state.entries.length}`;
		const verdictRaw =
			typeof event.verdict === 'string' ? event.verdict.trim().toLowerCase() : '';
		const verdict =
			verdictRaw === 'pass' || verdictRaw === 'reject' ? verdictRaw : undefined;
		const agentName =
			typeof event.agentName === 'string' && event.agentName.trim()
				? event.agentName.trim()
				: undefined;
		const goalId =
			typeof event.goalId === 'string' && event.goalId.trim()
				? event.goalId.trim()
				: undefined;
		const stepId =
			typeof event.stepId === 'string' && event.stepId.trim()
				? event.stepId.trim()
				: undefined;
		const goalStatus =
			typeof event.goalStatus === 'string' && event.goalStatus.trim()
				? event.goalStatus.trim()
				: undefined;
		const staleStreamingSealed = state.entries.map(entry =>
			entry.role === 'assistant' && entry.status === 'streaming'
				? sealStreamingAsDone(entry)
				: entry
		);
		return {
			...state,
			entries: [
				...staleStreamingSealed,
				{
					id: `assistant-${turnKey}`,
					role: 'assistant',
					text: '',
					reasoning: '',
					status: 'streaming',
					turnId: event.turnId ?? turnKey,
					clientMessageId: event.clientMessageId ?? turnKey,
					messageType: goalMsg,
					...(agentName ? {goalAgentName: agentName} : {}),
					...(verdict ? {goalVerdict: verdict} : {}),
					...(goalId ? {goalId} : {}),
					...(stepId ? {goalStepId: stepId} : {}),
					...(goalStatus ? {goalStatus} : {})
				}
			],
			chrome: runChromeTransition(state.chrome, {awaiting: false})
		};
	}
	const existingAssistant =
		state.entries.find(
			e =>
				e.role === 'assistant' &&
				e.status === 'streaming' &&
				sameTurn(e, event)
		) ??
		riverEchoAssistant(state, event) ??
		resumeSealedAssistant(state, event) ??
		(isRiverTurnStarted(event)
			? documentCard(state, event.turnId ?? event.clientMessageId)
			: undefined);
	const planBuildFields =
		event.messageType === 'plan_build' && event.planId
			? {
					messageType: 'plan_build' as const,
					planId: event.planId,
					planName: event.planName?.trim() || undefined
				}
			: null;
	if (existingAssistant) {
		if (chromePostRun(state.chrome) && isRiverTurnStarted(event)) return state;
		return {
			...rememberDocument(
				state,
				existingAssistant.turnId ?? event.turnId ?? event.clientMessageId
			),
			chrome: runChromeTransition(state.chrome, {postRun: false, awaiting: false}),
			entries: state.entries.map(entry => {
				const matchesAssistant = entry === existingAssistant;
				const matchesUser =
					entry.role === 'user' &&
					(entry.clientMessageId === existingAssistant.clientMessageId ||
						entry.turnId === existingAssistant.turnId ||
						entry.turnId === existingAssistant.clientMessageId);
				if (!matchesAssistant && !matchesUser) return entry;
				const schedOrigin = isScheduledId(event.clientMessageId)
					? 'scheduler_generated'
					: entry.origin;
				const persistRiver =
					typeof event.eventSeq === 'number' &&
					event.eventSeq > 0 &&
					event.messageType !== 'plan_build';
				const text =
					matchesUser &&
					!persistRiver &&
					!(entry.text ?? '').trim() &&
					(event.text ?? '').trim()
						? event.text!
						: entry.text;
				return {
					...entry,
					...(matchesUser && text !== entry.text ? {text} : {}),
					...(matchesAssistant && entry.status === 'done' ? {status: 'streaming' as const} : {}),
					turnId: entry.turnId ?? event.turnId,
					clientMessageId: event.clientMessageId ?? entry.clientMessageId,
					...(schedOrigin ? {origin: schedOrigin} : {}),
					...(matchesUser && planBuildFields ? planBuildFields : {})
				};
			})
		};
	}
	if (chromePostRun(state.chrome) && isRiverTurnStarted(event)) return state;
	const staleStreamingSealed = state.entries.map(entry =>
		entry.role === 'assistant' && entry.status === 'streaming'
			? sealStreamingAsDone(entry)
			: entry
	);
	const schedOrigin = isScheduledId(event.clientMessageId) ? 'scheduler_generated' : undefined;
	const userText = (event.text ?? '').trim()
		? event.text!
		: planBuildFields
			? planBuildDisplayContent(event.planName ?? '', event.planId!)
			: '';
	const planBuild = planBuildFields ?? {};
	const entries = [...staleStreamingSealed];
	if (userText || planBuildFields) {
		entries.push({
			id: `user-${event.turnId ?? entries.length}`,
			role: 'user',
			text: userText,
			status: 'done',
			turnId: event.turnId,
			clientMessageId: event.clientMessageId,
			...(schedOrigin ? {origin: schedOrigin} : {}),
			...planBuild
		});
	}
	entries.push({
		id: `assistant-${event.turnId ?? entries.length}`,
		role: 'assistant',
		text: '',
		reasoning: '',
		status: 'streaming',
		turnId: event.turnId,
		clientMessageId: event.clientMessageId ?? event.turnId,
		tools: [],
		segments: []
	});
	return {
		...rememberDocument(state, event.turnId ?? event.clientMessageId),
		entries,
		chrome: event.turnId
			? runChromeTransition(state.chrome, {
					run: {id: event.turnId, fromServer: false},
					postRun: false,
					awaiting: false
				})
			: runChromeTransition(state.chrome, {postRun: false, awaiting: false}),
		leaseAware: false,
		runLease: undefined,
		...freshRunDeltas
	};
}

export function applyInputAccepted(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'input_accepted'}>
): TranscriptState {
	if (!event.turnId && !event.clientMessageId) return state;
	if (chromePostRun(state.chrome) && !state.entries.some(e => e.status === 'streaming'))
		return state;
	const serverRunId = serverRunIdOf(event);
	return {
		...rememberDocument(state, serverRunId ?? event.turnId ?? event.clientMessageId),
		...freshRunDeltas,
		chrome: serverRunId
			? runChromeTransition(state.chrome, {run: {id: serverRunId, fromServer: true}})
			: state.chrome,
		entries: state.entries.map(entry => {
			const matchesClient = entryMatchesKey(entry, event.clientMessageId);
			const matchesTurn = entryTurnIdIs(entry, event.turnId);
			if (!matchesClient && !matchesTurn) return entry;
			if (entry.role === 'assistant' && entry.status !== 'streaming') return entry;
			return {
				...entry,
				turnId: event.turnId ?? entry.turnId,
				clientMessageId: event.clientMessageId ?? entry.clientMessageId
			};
		})
	};
}

export function applyTurnFinished(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'turn_finished'}>
): TranscriptState {
	const finishesActive = finishesActiveRun(state, event.turnId);
	const patched = patchAssistant(
		{
			...state,
			chrome: runChromeTransition(
				state.chrome,
				finishesActive
					? {run: 'clear', postRun: true, awaiting: false}
					: {postRun: true, awaiting: false}
			),
			approvals: state.approvals.filter(a => !a.runId),
			questions: [],
			questionBatches: state.questionBatches.filter(q => !q.runId)
		},
		event.turnId,
		entry => {
			if (entry.status === 'cancelled') return entry;
			const sealed = sealOpenThinking(entry);
			const {waitState: _w, ...rest} = sealed;
			const failReason =
				!event.success && 'reason' in event && typeof event.reason === 'string'
					? event.reason.trim()
					: '';
			return {
				...rest,
				status: event.success ? 'done' : 'error',
				text: rest.text.trim() || failReason || rest.text,
				tools: (entry.tools ?? []).map(t =>
					t.status === 'running' && !t.agentRunId
						? {...t, status: event.success ? 'success' : 'error'}
						: t
				)
			};
		}
	);
	const stillStreaming = patched.entries.some(
		e => e.role === 'assistant' && e.status === 'streaming'
	);
	const keepActive = stillStreaming && !finishesActive;
	return {
		...patched,
		chrome: keepActive
			? runChromeTransition(patched.chrome, {postRun: false})
			: runChromeTransition(patched.chrome, {run: 'clear', postRun: !stillStreaming}),
		leaseAware: keepActive ? state.leaseAware : false,
		runLease: keepActive ? state.runLease : undefined
	};
}

export function applyTurnCancelled(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'turn_cancelled'}>
): TranscriptState {
	if (event.turnId && !finishesActiveRun(state, event.turnId)) {
		return {
			...state,
			approvals: state.approvals.filter(a => !a.runId || a.runId !== event.turnId),
			questions: state.questions.filter(q => q.runId !== event.turnId),
			questionBatches: state.questionBatches.filter(q => !q.runId || q.runId !== event.turnId),
			entries: state.entries.map(entry => {
				if (entry.role !== 'assistant') return entry;
				if (entry.status !== 'streaming' && entry.status !== 'cancelled') return entry;
				if (!entryMatchesKey(entry, event.turnId)) return entry;
				const sealed = sealOpenThinking(entry);
				const {waitState: _w, ...rest} = sealed;
				return {
					...rest,
					status: 'cancelled',
					tools: (entry.tools ?? []).map(t =>
						t.status === 'running' ? {...t, status: 'cancelled'} : t
					)
				};
			})
		};
	}
	return {
		...forgetDocument(state),
		chrome: runChromeTransition(state.chrome, {
			run: 'clear',
			postRun: true,
			awaiting: false
		}),
		leaseAware: false,
		runLease: undefined,
		approvals: state.approvals.filter(a => !a.runId),
		questions: [],
		questionBatches: state.questionBatches.filter(q => !q.runId),
		entries: state.entries.map(entry => {
			if (entry.role !== 'assistant') return entry;
			if (entry.status !== 'streaming' && entry.status !== 'cancelled') return entry;
			const sealed = sealOpenThinking(entry);
			const {waitState: _w, ...rest} = sealed;
			return {
				...rest,
				status: 'cancelled',
				tools: (entry.tools ?? []).map(t =>
					t.status === 'running' ? {...t, status: 'cancelled'} : t
				)
			};
		})
	};
}

export function applyError(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'error'}>
): TranscriptState {
	return patchAssistant(state, event.turnId, entry => ({
		...entry,
		text: entry.text || event.message,
		status: 'error'
	}));
}
