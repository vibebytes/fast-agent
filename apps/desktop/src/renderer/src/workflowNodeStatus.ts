import {pickIdList, wireIdList} from '@fastllm/bridge-protocol';

/** Align with engine GoalProgress + terminal Goal status for list/detail chrome. */
export type WorkflowNodeState =
	| 'done'
	| 'running'
	| 'blocked'
	| 'reject-reopen'
	| 'pending'
	| 'failed'
	| 'skipped';

const TERMINAL_FAIL = new Set(['failed', 'cancelled', 'discarded']);
const TERMINAL_OK = new Set(['passed', 'succeeded']);

export {pickIdList, wireIdList};

/** Goal in-flight step ids — array or legacy comma-separated string. */
export function currentStepIds(raw?: string | string[] | null): Set<string> {
	return new Set(wireIdList(raw));
}

export function workflowNodeStatus(
	stepId: string,
	opts: {
		currentStepIds?: string | string[] | null;
		/** @deprecated wire dual-read — prefer currentStepIds */
		currentStepId?: string | string[] | null;
		completedSteps: Set<string>;
		pendingExtras: Set<string>;
		goalStatus?: string | null;
	}
): WorkflowNodeState {
	if (opts.completedSteps.has(stepId)) return 'done';
	const goalSt = (opts.goalStatus ?? '').toLowerCase();
	if (currentStepIds(pickIdList(opts.currentStepIds, opts.currentStepId)).has(stepId)) {
		if (TERMINAL_FAIL.has(goalSt)) return 'failed';
		if (TERMINAL_OK.has(goalSt)) return 'done';
		// Blocked Goal: director halted — cursor stays, but step is not executing.
		if (goalSt === 'blocked') return 'blocked';
		return 'running';
	}
	if (opts.pendingExtras.has(stepId)) return 'reject-reopen';
	if (TERMINAL_OK.has(goalSt)) return 'done';
	if (TERMINAL_FAIL.has(goalSt)) return 'skipped';
	return 'pending';
}

/** In-flight member labels in workflow order (drawer chrome). */
export function currentStepNames(
	raw: string | string[] | undefined | null,
	steps: Array<{id?: string; use?: string; name?: string}>
): string[] {
	const ids = currentStepIds(raw);
	if (ids.size === 0) return [];
	const seen = new Set<string>();
	const names: string[] = [];
	steps.forEach((s, i) => {
		const sid = s.id || s.use || `step-${i}`;
		if (ids.has(sid) || (s.use != null && ids.has(s.use))) {
			names.push(s.use?.trim() || s.name?.trim() || sid);
			seen.add(sid);
			if (s.use) seen.add(s.use);
		}
	});
	for (const id of ids) if (!seen.has(id)) names.push(id);
	return names;
}
