import type {AgentRun} from '../model.js';
import type {AgentCallTimelineItem} from './model.js';

/**
 * Project flat agentRuns into tree-shaped timeline items.
 *
 * Grouping: runs sharing a batchId render together — a synthesized "main"
 * trunk row heads batches with ≥2 top-level delegations, and children hang
 * under their parent via parentRunId with box-drawing connectors.
 *
 * Settling contract (the <Static> invariant): a batch settles as a UNIT, only
 * when every member is terminal. The reducer freezes batch membership once all
 * members are terminal, so a settled batch can never gain rows or change shape
 * — and at most the trailing batch is still open. Per-row settling would tear
 * scrollback: an early ✓ row would print while its running sibling below keeps
 * repainting.
 */
export function agentCallItems(runs: AgentRun[]): AgentCallTimelineItem[] {
	const items: AgentCallTimelineItem[] = [];
	for (const batch of batches(runs)) {
		const running = batch.some(ar => ar.status === 'running');
		const pending = running ? (true as const) : undefined;
		const memberIds = new Set(batch.map(ar => ar.runId));
		const roots = batch.filter(ar => !ar.parentRunId || !memberIds.has(ar.parentRunId));
		const hasTrunk = roots.length >= 2;

		if (hasTrunk) items.push(trunkItem(batch, roots, pending));

		roots.forEach((root, index) => {
			const isLast = index === roots.length - 1;
			const prefix = hasTrunk ? (isLast ? '└─ ' : '├─ ') : '';
			const continuation = hasTrunk ? (isLast ? '   ' : '│  ') : '';
			pushSubtree(items, batch, root, prefix, continuation, pending);
		});
	}
	return items;
}

/** Batches in first-appearance order; runs without a batchId stand alone. */
function batches(runs: AgentRun[]): AgentRun[][] {
	const byBatch = new Map<string, AgentRun[]>();
	for (const ar of runs) {
		const key = ar.batchId ?? ar.runId;
		const group = byBatch.get(key);
		if (group) group.push(ar);
		else byBatch.set(key, [ar]);
	}
	return [...byBatch.values()];
}

function pushSubtree(
	items: AgentCallTimelineItem[],
	batch: AgentRun[],
	run: AgentRun,
	prefix: string,
	continuation: string,
	pending: true | undefined
): void {
	items.push(runItem(run, prefix, continuation, pending));
	const children = batch.filter(ar => ar.parentRunId === run.runId);
	children.forEach((child, index) => {
		const isLast = index === children.length - 1;
		pushSubtree(
			items, batch, child,
			`${continuation}${isLast ? '└─ ' : '├─ '}`,
			`${continuation}${isLast ? '   ' : '│  '}`,
			pending
		);
	});
}

function runItem(ar: AgentRun, treePrefix: string, continuation: string, pending: true | undefined): AgentCallTimelineItem {
	return {
		// Keyed by runId: the same agent delegated twice must be two distinct
		// items — duplicate ids corrupt <Static> scrollback (repaint storms).
		id: `agent-${ar.runId}`,
		kind: 'agent_call',
		agentId: ar.agentId,
		name: ar.name,
		depth: ar.depth,
		status: ar.status,
		currentTool: ar.currentTool,
		toolCalls: ar.toolCalls,
		detail: ar.detail,
		elapsedMs: ar.elapsedMs,
		tokensUsed: ar.tokensUsed,
		startedAt: ar.startedAt,
		resultSummary: ar.resultSummary,
		isRetry: ar.isRetry,
		treePrefix,
		summaryIndent: continuation,
		pending
	};
}

/** Synthesized parent row: makes the delegating agent visible over ≥2 siblings. */
function trunkItem(batch: AgentRun[], roots: AgentRun[], pending: true | undefined): AgentCallTimelineItem {
	const batchId = batch[0]?.batchId ?? batch[0]?.runId ?? 'batch';
	const runningCount = roots.filter(ar => ar.status === 'running').length;
	const failedCount = roots.filter(ar => ar.status === 'failed').length;
	const tokens = batch.map(ar => ar.tokensUsed).filter((t): t is number => t !== undefined);
	return {
		id: `agent-trunk-${batchId}`,
		kind: 'agent_call',
		agentId: 'main',
		name: 'main',
		depth: 0,
		status: runningCount > 0 ? 'running' : failedCount > 0 ? 'failed' : 'success',
		toolCalls: batch.reduce((sum, ar) => sum + ar.toolCalls, 0),
		elapsedMs: pending ? undefined : maxOrUndefined(batch.map(ar => ar.elapsedMs)),
		tokensUsed: tokens.length > 0 ? tokens.reduce((a, b) => a + b, 0) : undefined,
		treePrefix: '',
		summaryIndent: '',
		trunk: {total: roots.length, running: runningCount, failed: failedCount},
		pending
	};
}

function maxOrUndefined(values: Array<number | undefined>): number | undefined {
	const defined = values.filter((v): v is number => v !== undefined);
	return defined.length > 0 ? Math.max(...defined) : undefined;
}
