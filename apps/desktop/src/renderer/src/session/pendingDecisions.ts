import {useSyncExternalStore} from 'react';
import {shellT as t} from '../i18n/t';

/**
 * Decision Transition local state (message-flow-performance.md 刀 3-2;
 * CONTEXT.md「Decision Transition」): the instant an Approval / User Question
 * decision is clicked, the interactive card becomes a compact decided row and
 * the flow advances — engine events then own the narrative. This store holds
 * only the client-side decision record `{label, sentAt, failed}` per pending
 * id; convergence = the pending item leaving `transcript.approvals/questions`
 * (the projection then drops the card entirely and the record is pruned).
 *
 * Module-level external store (same pattern as editorStatusStore / composer
 * draft, ADR-0006): cards self-subscribe by id, so a decision update re-renders
 * only that card — no TimelineRow props, no memo comparator changes.
 */
export type PendingDecision = {
	/** Compact-row label, e.g. "Allowed" / "Denied" / the chosen option text. */
	label: string;
	/** Approval decisions carry the direction for the compact-row icon. */
	approved?: boolean;
	sentAt: number;
	/** IPC command accepted; engine events still own final convergence. */
	acked?: boolean;
	/** Local send failure; the compact row remains non-interactive. */
	failed?: string;
};

export type PendingDecisionKind = 'approval' | 'question' | 'questionBatch';
type DecisionMap = Readonly<Record<string, PendingDecision>>;

let decisions: DecisionMap = {};
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function scopedKey(scope: string, kind: PendingDecisionKind, id: string): string {
	return `${scope}\0${kind}\0${id}`;
}

export function decisionFor(
	scope: string,
	kind: PendingDecisionKind,
	id: string
): PendingDecision | undefined {
	return decisions[scopedKey(scope, kind, id)];
}

/** Per-card subscription: re-renders only when this id's record changes. */
export function usePendingDecision(
	scope: string,
	kind: PendingDecisionKind,
	id: string
): PendingDecision | undefined {
	const key = scopedKey(scope, kind, id);
	return useSyncExternalStore(
		subscribe,
		() => decisions[key],
		() => decisions[key]
	);
}

// ── Pure transitions (exported for tests; reference-disciplined) ────────────

export function withSent(
	map: DecisionMap,
	id: string,
	decision: Omit<PendingDecision, 'sentAt'>,
	now: number
): DecisionMap {
	return {...map, [id]: {...decision, sentAt: now}};
}

export function withAcked(map: DecisionMap, id: string): DecisionMap {
	const prev = map[id];
	return prev && !prev.acked ? {...map, [id]: {...prev, acked: true}} : map;
}

export function withFailed(map: DecisionMap, id: string, reason: string, now: number): DecisionMap {
	const prev = map[id];
	return {...map, [id]: {...(prev ?? {label: '', sentAt: now}), failed: reason}};
}

/** Drop records whose id is no longer pending; same reference when nothing changed. */
export function pruned(map: DecisionMap, liveIds: ReadonlySet<string>): DecisionMap {
	let changed = false;
	const next: Record<string, PendingDecision> = {};
	for (const [id, d] of Object.entries(map)) {
		if (liveIds.has(id)) next[id] = d;
		else changed = true;
	}
	return changed ? next : map;
}

// ── Store actions ────────────────────────────────────────────────────────────

function failedReason(prefix: string, error?: unknown): string {
	const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
	return `${prefix}${detail}`;
}

function observeSend(
	key: string,
	sent: PendingDecision,
	request: Promise<boolean>,
	rejectedPrefix: string,
	notAccepted: string
): void {
	void request.then(
		ok => {
			if (decisions[key] !== sent) return;
			decisions = ok
				? withAcked(decisions, key)
				: withFailed(decisions, key, notAccepted, Date.now());
			emit();
		},
		error => {
			if (decisions[key] !== sent) return;
			decisions = withFailed(decisions, key, failedReason(rejectedPrefix, error), Date.now());
			emit();
		}
	);
}

/** Decide an Approval: compact the card now, converge on engine events. */
export function sendApprovalDecision(
	scope: string,
	id: string,
	approved: boolean,
	reason?: string
): void {
	const key = scopedKey(scope, 'approval', id);
	if (decisions[key]) return;
	const label = !approved
		? t('shell.decision.denied')
		: reason === 'always'
			? t('shell.decision.alwaysAllowed')
			: t('shell.decision.allowed');
	decisions = withSent(decisions, key, {label, approved}, Date.now());
	const sent = decisions[key]!;
	emit();
	try {
		observeSend(
			key,
			sent,
			window.fastIde.decideApproval(id, approved, reason),
			t('shell.decision.sendFailed'),
			t('shell.decision.engineRejected')
		);
	} catch (error) {
		if (decisions[key] !== sent) return;
		decisions = withFailed(
			decisions,
			key,
			failedReason(t('shell.decision.sendFailed'), error),
			Date.now()
		);
		emit();
	}
}

/** Answer a User Question: compact the card now, converge on engine events. */
export function sendQuestionAnswer(
	scope: string,
	id: string,
	answer: string,
	label = answer
): void {
	const key = scopedKey(scope, 'question', id);
	if (decisions[key]) return;
	decisions = withSent(decisions, key, {label}, Date.now());
	const sent = decisions[key]!;
	emit();
	try {
		observeSend(
			key,
			sent,
			window.fastIde.answerQuestion(id, answer),
			t('shell.decision.answerSendFailed'),
			t('shell.decision.answerRejected')
		);
	} catch (error) {
		if (decisions[key] !== sent) return;
		decisions = withFailed(
			decisions,
			key,
			failedReason(t('shell.decision.answerSendFailed'), error),
			Date.now()
		);
		emit();
	}
}

export function sendQuestionBatch(
	scope: string,
	rpcId: string,
	payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true},
	label: string
): void {
	const key = scopedKey(scope, 'questionBatch', rpcId);
	if (decisions[key]) return;
	decisions = withSent(decisions, key, {label}, Date.now());
	const sent = decisions[key]!;
	emit();
	try {
		observeSend(
			key,
			sent,
			window.fastIde.answerQuestionBatch(rpcId, payload),
			t('shell.decision.answerSendFailed'),
			t('shell.decision.answerRejected')
		);
	} catch (error) {
		if (decisions[key] !== sent) return;
		decisions = withFailed(
			decisions,
			key,
			failedReason(t('shell.decision.answerSendFailed'), error),
			Date.now()
		);
		emit();
	}
}

/**
 * Converge one Task scope with its authoritative pending lists. Records from
 * background Tasks survive a focus switch and converge when that Task is next
 * observed, matching the per-Session decision semantics.
 */
export function pruneDecisions(
	scope: string,
	liveApprovalIds: ReadonlySet<string>,
	liveQuestionIds: ReadonlySet<string>,
	liveBatchIds: ReadonlySet<string> = new Set()
): void {
	const liveKeys = new Set<string>();
	for (const id of liveApprovalIds) liveKeys.add(scopedKey(scope, 'approval', id));
	for (const id of liveQuestionIds) liveKeys.add(scopedKey(scope, 'question', id));
	for (const id of liveBatchIds) liveKeys.add(scopedKey(scope, 'questionBatch', id));
	const prefix = `${scope}\0`;
	let changed = false;
	const next: Record<string, PendingDecision> = {};
	for (const [key, decision] of Object.entries(decisions)) {
		if (key.startsWith(prefix) && !liveKeys.has(key)) changed = true;
		else next[key] = decision;
	}
	if (!changed) return;
	decisions = next;
	emit();
}

export function __resetPendingDecisionsForTests(): void {
	decisions = {};
	emit();
}
