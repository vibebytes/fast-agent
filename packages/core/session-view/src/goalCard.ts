import type {GoalFlowMember, GoalFlowView, TranscriptEntry, TranscriptState} from './transcriptProjection.js';
import type {GoalCardView} from './wire.js';
import {chromePostRun, runChromeTransition} from './runChrome.js';
import {pickIdList} from '@fastllm/bridge-protocol';

/** Chat-history prose for an unconfirmed plan (natural confirm, not a Goal card). */
export function awaitingConfirmPlan(card: GoalCardView): string {
	const lines: string[] = [];
	const title = card.name?.trim();
	const statement = card.statement?.trim();
	if (title) lines.push(`目标：${title}`);
	if (statement && statement !== title) lines.push(title ? `说明：${statement}` : `目标：${statement}`);
	if (card.acceptance?.trim()) lines.push(`验收：${card.acceptance.trim()}`);
	const members = planMemberNames(card.membersJson);
	if (members) lines.push(`成员：${members}`);
	lines.push('请确认是否开始执行（回复「开始」或「确认」即可）。');
	return lines.join('\n');
}

function planMemberNames(json?: string): string | undefined {
	if (!json?.trim()) return undefined;
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed)) return undefined;
		const names = parsed.flatMap(m => {
			if (m && typeof m === 'object' && 'name' in m && typeof m.name === 'string' && m.name.trim())
				return [m.name.trim()];
			return [];
		});
		return names.length > 0 ? names.join('、') : undefined;
	} catch {
		return undefined;
	}
}

const CONFIRM_ASK = '请确认是否开始执行';

function isChatAssistant(e: TranscriptEntry): boolean {
	return e.role === 'assistant' && !e.messageType;
}

function hasToolWork(e: TranscriptEntry): boolean {
	return (e.tools?.length ?? 0) > 0 || (e.segments?.some(s => s.kind === 'tools') ?? false);
}

function hasAssistantSegment(e: TranscriptEntry): boolean {
	return (e.segments ?? []).some(s => s.kind === 'assistant' && s.text.trim());
}

/**
 * Confirm is a chat reply after the plan turn — never `entry.text` on a tool-bearing
 * assistant (timeline treats that as orphan preamble above Process Stack).
 */
export function paintAwaitingConfirm(
	transcript: TranscriptState,
	card?: GoalCardView | null
): TranscriptState {
	if (!card || card.phase !== 'awaiting_confirm') return transcript;
	const streaming = transcript.entries.some(e => e.role === 'assistant' && e.status === 'streaming');
	if (streaming && !chromePostRun(transcript.chrome)) return transcript;
	let lastUser = -1;
	for (let i = transcript.entries.length - 1; i >= 0; i--) {
		if (transcript.entries[i].role === 'user') {
			lastUser = i;
			break;
		}
	}
	const chats = transcript.entries.slice(lastUser + 1).filter(isChatAssistant);
	const dedicated = [...chats].reverse().find(
		e => hasAssistantSegment(e) || (!hasToolWork(e) && Boolean(e.text.trim()))
	);
	if (dedicated) return transcript;
	const last = chats.at(-1);
	const fallback = awaitingConfirmPlan(card);
	if (last && hasToolWork(last)) {
		const existing = last.text.trim();
		const text = existing.includes(CONFIRM_ASK) ? existing : fallback;
		const stripped = existing.includes(CONFIRM_ASK)
			? transcript.entries.map(e => (e.id === last.id ? {...e, text: ''} : e))
			: transcript.entries;
		return {
			...transcript,
			entries: [
				...stripped,
				{id: `assistant-awaiting-${card.goalId}`, role: 'assistant', text, status: 'done'}
			]
		};
	}
	if (last && !last.text.trim())
		return {
			...transcript,
			entries: transcript.entries.map(e =>
				e.id === last.id ? {...e, text: fallback, status: 'done' as const} : e
			)
		};
	return {
		...transcript,
		entries: [
			...transcript.entries,
			{id: `assistant-awaiting-${card.goalId}`, role: 'assistant', text: fallback, status: 'done'}
		]
	};
}

/** Busy A′ surface — Goal track owns the session even when no Chat turn is open. */
export function goalKeepsBusy(card?: GoalCardView | null): boolean {
	if (!card) return false;
	if (card.phase === 'started' || card.phase === 'paused') return true;
	// Infra escalate unlocks composer — Resume retries supply; decision escalate keeps the gate.
	if (card.phase === 'escalated' && card.escalateKind !== 'infra') return true;
	return false;
}

/** Seed chat goalFlow from a Goal card (Attach hydrate / finished restore). */
export function goalFlowSeed(card: GoalCardView): GoalFlowView {
	const completed = completedStepIds(card.progressJson);
	const current = new Set(card.currentStepIds ?? []);
	const nodes = workflowNodes(card.workflowJson);
	if (nodes.length > 0) {
		const finished = card.phase === 'finished';
		const members = nodes
			.filter(n => finished || completed.has(n.id) || current.has(n.id))
			.map(n => {
				const done = completed.has(n.id);
				const active = current.has(n.id) && !done;
				const status: GoalFlowMember['status'] = done
					? 'success'
					: active
						? 'running'
						: terminalMemberStatus(card.status);
				return {
					runId: `seed-${card.goalId}-${n.id}`,
					name: n.use || n.id,
					stepId: n.id,
					status
				};
			});
		if (members.length > 0) return {goalId: card.goalId, members};
	}
	const name = card.name?.trim() || 'Goal';
	const status: GoalFlowMember['status'] =
		card.phase === 'finished'
			? terminalMemberStatus(card.status)
			: card.phase === 'escalated'
				? 'error'
				: 'running';
	return {
		goalId: card.goalId,
		members: [{runId: `seed-${card.goalId}`, name, status}]
	};
}

function terminalMemberStatus(status: string): GoalFlowMember['status'] {
	const s = status.trim().toLowerCase();
	if (s === 'failed') return 'error';
	if (s === 'cancelled' || s === 'canceled') return 'cancelled';
	return 'success';
}

function completedStepIds(progressJson?: string): Set<string> {
	if (!progressJson?.trim()) return new Set();
	try {
		const j = JSON.parse(progressJson) as {completed_steps?: unknown};
		const raw = j.completed_steps;
		if (!Array.isArray(raw)) return new Set();
		return new Set(raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0));
	} catch {
		return new Set();
	}
}

function workflowNodes(workflowJson?: string): Array<{id: string; use: string}> {
	if (!workflowJson?.trim()) return [];
	try {
		const j = JSON.parse(workflowJson) as {nodes?: unknown};
		if (!Array.isArray(j.nodes)) return [];
		return j.nodes.flatMap(n => {
			if (!n || typeof n !== 'object') return [];
			const id = typeof (n as {id?: unknown}).id === 'string' ? (n as {id: string}).id.trim() : '';
			if (!id) return [];
			const use =
				typeof (n as {use?: unknown}).use === 'string'
					? (n as {use: string}).use.trim()
					: id;
			return [{id, use: use || id}];
		});
	} catch {
		return [];
	}
}

export type GoalReplyFields = {
	id: string;
	status: string;
	statement?: string | null;
	acceptance?: string | null;
	workflowJson?: string | null;
	membersJson?: string | null;
	budgetJson?: string | null;
	loopAgentId?: string | null;
	resultSummary?: string | null;
	currentStepIds?: string | string[] | null;
	currentStepId?: string | string[] | null;
	activeRunIds?: string | string[] | null;
	activeRunId?: string | string[] | null;
	progressJson?: string | null;
};

export type GoalPushFields = Omit<GoalReplyFields, 'id'> & {
	goalId: string;
	phase: GoalCardView['phase'];
	name?: string | null;
	escalateActions?: GoalCardView['escalateActions'];
	reason?: string | null;
	escalateKind?: string | null;
};

/** Keep previous when both next plural and singular are nullish. */
function mergeIdList(
	prev: string[] | undefined,
	plural?: string | string[] | null,
	singular?: string | string[] | null
): string[] | undefined {
	if (plural == null && singular == null) return prev;
	return pickIdList(plural, singular);
}

export function goalCardFromPush(e: GoalPushFields): GoalCardView {
	return {
		goalId: e.goalId,
		phase: e.phase,
		status: e.status,
		name: e.name ?? undefined,
		statement: e.statement ?? undefined,
		acceptance: e.acceptance ?? undefined,
		workflowJson: e.workflowJson ?? undefined,
		membersJson: e.membersJson ?? undefined,
		budgetJson: e.budgetJson ?? undefined,
		loopAgentId: e.loopAgentId ?? undefined,
		resultSummary: e.resultSummary ?? undefined,
		escalateActions: e.escalateActions,
		reason: e.reason ?? undefined,
		currentStepIds: pickIdList(e.currentStepIds, e.currentStepId),
		activeRunIds: pickIdList(e.activeRunIds, e.activeRunId),
		progressJson: e.progressJson ?? undefined,
		escalateKind:
			e.escalateKind === 'infra' || e.escalateKind === 'decision' ? e.escalateKind : undefined
	};
}

/** A push for another goal must not clobber a live confirm card. */
export function goalPushClobbersConfirm(prev: GoalCardView | undefined, push: GoalPushFields): boolean {
	return (
		!!prev &&
		prev.goalId !== push.goalId &&
		prev.phase === 'awaiting_confirm' &&
		push.phase !== 'awaiting_confirm'
	);
}

/** Goal track is not a Chat-turn straggler — lift postRun so Goal turns are not dropped. */
export function applyGoalPush(
	transcript: TranscriptState,
	card: GoalCardView,
	phase: GoalCardView['phase']
): TranscriptState {
	const prevFlow = transcript.goalFlow;
	const keepLive =
		prevFlow?.goalId === card.goalId && prevFlow.members.some(m => !m.runId.startsWith('seed-'));
	const lift = phase === 'started' || phase === 'paused' || phase === 'escalated';
	return paintAwaitingConfirm(
		{
			...transcript,
			goalFlow: keepLive ? prevFlow : goalFlowSeed(card),
			chrome: lift ? runChromeTransition(transcript.chrome, {postRun: false}) : transcript.chrome
		},
		card
	);
}

export function patchedGoalCard(prev: GoalCardView, g: GoalReplyFields): GoalCardView {
	return {
		...prev,
		status: g.status,
		statement: g.statement ?? prev.statement,
		acceptance: g.acceptance ?? prev.acceptance,
		workflowJson: g.workflowJson ?? prev.workflowJson,
		membersJson: g.membersJson ?? prev.membersJson,
		budgetJson: g.budgetJson ?? prev.budgetJson,
		loopAgentId: g.loopAgentId ?? prev.loopAgentId,
		resultSummary: g.resultSummary ?? prev.resultSummary,
		currentStepIds: mergeIdList(prev.currentStepIds, g.currentStepIds, g.currentStepId),
		activeRunIds: mergeIdList(prev.activeRunIds, g.activeRunIds, g.activeRunId),
		progressJson: g.progressJson ?? prev.progressJson
	};
}

export function goalConfirmStarted(g: GoalReplyFields | undefined, message: string): boolean {
	return (
		g?.status === 'running' ||
		message.includes('confirmed+started') ||
		message.startsWith('confirmed+started')
	);
}

export function startedGoalCardFromConfirm(
	prev: GoalCardView | undefined,
	g: GoalReplyFields | undefined
): GoalCardView | undefined {
	const card: GoalCardView = {
		goalId: g?.id ?? prev?.goalId ?? '',
		phase: 'started',
		status: g?.status ?? 'running',
		statement: g?.statement ?? prev?.statement,
		acceptance: g?.acceptance ?? prev?.acceptance,
		workflowJson: g?.workflowJson ?? prev?.workflowJson,
		membersJson: g?.membersJson ?? prev?.membersJson,
		budgetJson: g?.budgetJson ?? prev?.budgetJson,
		loopAgentId: g?.loopAgentId ?? prev?.loopAgentId,
		resultSummary: g?.resultSummary ?? prev?.resultSummary,
		currentStepIds: mergeIdList(prev?.currentStepIds, g?.currentStepIds, g?.currentStepId),
		activeRunIds: mergeIdList(prev?.activeRunIds, g?.activeRunIds, g?.activeRunId),
		progressJson: g?.progressJson ?? prev?.progressJson
	};
	if (!card.goalId) return undefined;
	return card;
}
