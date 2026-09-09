import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {
	ChildTranscriptView,
	ContextPruneView,
	GoalFlowMember,
	TranscriptState,
	UsageView
} from './state.js';
import type {DshDeltaCaps} from '../wire/session.js';
import {sameRunId} from '../turnIdentity.js';

/** Cap on retained child transcript tail per child session (chars). */
export const CHILD_TRANSCRIPT_MAX = 4000;
/** Cap on retained context-prune notices per run. */
export const CONTEXT_PRUNE_MAX = 20;

const DELTA_CAP_BY_TYPE: Record<string, keyof DshDeltaCaps> = {
	usage_reported: 'usage',
	child_transcript_delta: 'childTranscript',
	context_pruned: 'contextPrune',
	goal_delta: 'goalDelta'
};

/**
 * Fail-closed gate for the four DSH delta rivers: an engine that ships a delta
 * while its caps bit is absent/false is out of contract, so the neutral layer
 * drops it instead of painting a surface the engine did not declare.
 */
export function deltaEventAllowed(type: string, caps: DshDeltaCaps | undefined): boolean {
	const bit = DELTA_CAP_BY_TYPE[type];
	return bit ? caps?.[bit] === true : true;
}

/**
 * Engine payloadJson → display text. Deltas arrive as per-entry JSON rows, so
 * concatenating them raw would render `{"text":"a"}{"text":"b"}`; plain-string
 * payloads pass through unchanged.
 */
function childDeltaText(payloadJson: string, entryKind: string): string {
	if (!payloadJson) return '';
	let parsed: unknown;
	try {
		parsed = JSON.parse(payloadJson);
	} catch {
		return payloadJson;
	}
	if (typeof parsed === 'string') return parsed;
	if (!parsed || typeof parsed !== 'object') return '';
	const row = parsed as Record<string, unknown>;
	const pick = (...keys: string[]): string | undefined =>
		keys.map(key => row[key]).find((value): value is string => typeof value === 'string');
	if (entryKind === 'tool_started' || entryKind === 'tool_finished') {
		const parts = [
			pick('name', 'tool', 'title', 'label') ?? '',
			pick('summary', 'preview', 'output', 'text') ?? ''
		].filter(Boolean);
		return parts.length ? `${parts.join(' ')}\n` : '';
	}
	return pick('text', 'delta', 'content', 'message', 'summary') ?? '';
}

function numericBuckets(raw: unknown): Record<string, number> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
	}
	return out;
}

function stringRaw(raw: unknown): Record<string, string> | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string') out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

export function applyUsageReported(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'usage_reported'}>
): TranscriptState {
	const runId = typeof event.runId === 'string' ? event.runId.trim() : '';
	if (!runId) return state;
	const turnId =
		typeof event.turnId === 'string' && event.turnId.trim()
			? event.turnId.trim()
			: undefined;
	const raw = stringRaw((event as {raw?: unknown}).raw);
	const usage: UsageView = {
		runId,
		...(turnId ? {turnId} : {}),
		buckets: numericBuckets((event as {buckets?: unknown}).buckets),
		...(raw ? {raw} : {})
	};
	return {...state, usage};
}

export function applyContextPruned(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'context_pruned'}>
): TranscriptState {
	const runId = typeof event.runId === 'string' ? event.runId.trim() : '';
	if (!runId) return state;
	const prunedIds = Array.isArray(event.prunedIds)
		? event.prunedIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
		: [];
	if (!prunedIds.length) return state;
	const remaining =
		typeof event.remainingTokens === 'number' && Number.isFinite(event.remainingTokens)
			? event.remainingTokens
			: undefined;
	const notice: ContextPruneView = {
		runId,
		prunedIds,
		reason: typeof event.reason === 'string' ? event.reason : '',
		...(remaining !== undefined ? {remainingTokens: remaining} : {})
	};
	const prev = state.contextPrunes ?? [];
	// River replay / resync can re-deliver the same row; identical notices collapse.
	const duplicate = prev.some(
		item =>
			item.runId === notice.runId &&
			item.reason === notice.reason &&
			item.remainingTokens === notice.remainingTokens &&
			item.prunedIds.length === notice.prunedIds.length &&
			item.prunedIds.every((id, index) => id === notice.prunedIds[index])
	);
	if (duplicate) return state;
	return {...state, contextPrunes: [...prev, notice].slice(-CONTEXT_PRUNE_MAX)};
}

export function applyChildTranscriptDelta(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'child_transcript_delta'}>
): TranscriptState {
	const childSessionId =
		typeof event.childSessionId === 'string' ? event.childSessionId.trim() : '';
	if (!childSessionId) return state;
	const seq = typeof event.childSeq === 'number' ? event.childSeq : 0;
	const prev = state.childTranscripts ?? {};
	const existing = prev[childSessionId];
	// Out-of-order / duplicate deltas below the applied watermark are dropped.
	if (existing && seq <= existing.lastSeq) return state;
	const entryKind = typeof event.entryKind === 'string' ? event.entryKind : '';
	const chunk = childDeltaText(
		typeof event.payloadJson === 'string' ? event.payloadJson : '',
		entryKind
	);
	const text = `${existing?.text ?? ''}${chunk}`.slice(-CHILD_TRANSCRIPT_MAX);
	const next: ChildTranscriptView = {
		childSessionId,
		lastSeq: seq,
		...(entryKind ? {entryKind} : {}),
		text
	};
	return {...state, childTranscripts: {...prev, [childSessionId]: next}};
}

const GOAL_MEMBER_STATUS: Record<string, GoalFlowMember['status']> = {
	step_started: 'running',
	step_finished: 'success',
	step_failed: 'error',
	step_cancelled: 'cancelled'
};

function goalDeltaPayload(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function stringField(raw: unknown): string | undefined {
	return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

export function applyGoalDelta(
	state: TranscriptState,
	event: Extract<BridgeEvent, {type: 'goal_delta'}>
): TranscriptState {
	const goalId = typeof event.goalId === 'string' ? event.goalId.trim() : '';
	if (!goalId) return state;
	const operation = typeof event.operation === 'string' ? event.operation : '';
	// `remove` retires the chat-flow Goal card; other ops keep it live.
	if (operation === 'remove' || operation === 'deleted') {
		const flow = state.goalFlow;
		if (!flow || flow.goalId !== goalId) return state;
		return {...state, goalFlow: undefined};
	}
	const status = GOAL_MEMBER_STATUS[operation];
	const flow = state.goalFlow;
	if (!status || !flow || flow.goalId !== goalId) return state;
	const payload = goalDeltaPayload(event.payloadJson);
	const step =
		payload.step && typeof payload.step === 'object'
			? (payload.step as Record<string, unknown>)
			: {};
	const stepId = stringField(payload.stepId) ?? stringField(step.id) ?? '';
	const runId = stringField(payload.runId) ?? stringField(step.runId) ?? '';
	if (!stepId && !runId) return state;
	let changed = false;
	const members = flow.members.map(member => {
		const hit = (stepId && member.stepId === stepId) || (runId && sameRunId(member.runId, runId));
		if (!hit) return member;
		// A late failure report must not downgrade a member already marked success.
		if (member.status === status || (member.status === 'success' && status === 'error')) return member;
		changed = true;
		return {...member, status};
	});
	return changed ? {...state, goalFlow: {...flow, members}} : state;
}
