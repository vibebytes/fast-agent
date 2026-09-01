import type {LiveChildWork, LiveTask} from '@fast-ide/session-view';

/** Drawer keeps armed/paused/running; drops cancelled/expired. */
export function drawerTasks(tasks: LiveTask[]): LiveTask[] {
	return tasks.filter(t => !['cancelled', 'expired'].includes(t.status.toLowerCase()));
}

/** Main-session run already owns the transcript; only child workloads belong in the drawer. */
function isMainSessionRun(work: LiveChildWork): boolean {
	return (
		work.kind.toLowerCase() === 'run' &&
		!work.parentRef?.trim() &&
		work.title.trim().toLowerCase() === 'run' &&
		!work.goalId?.trim()
	);
}

/** Goal-step L1 runs — drawer rich cards under GoalRow (goalId or legacy title marker). */
export function isGoalStepWork(work: LiveChildWork): boolean {
	return (
		Boolean(work.goalId?.trim()) ||
		work.title.trim().toLowerCase().startsWith('goal-step:')
	);
}

/** L1 rows for a Goal drawer — scoped to `goalId` so settled steps from prior Goals never leak. */
export function goalStepChildWork(work: LiveChildWork[], goalId?: string): LiveChildWork[] {
	const gid = goalId?.trim();
	return work.filter(w => {
		if (!isGoalStepWork(w)) return false;
		if (!gid) return true;
		if (w.goalId?.trim()) return w.goalId.trim() === gid;
		return w.title.trim().toLowerCase().startsWith(`goal-step:${gid.toLowerCase()}`);
	});
}

export function drawerChildWork(
	work: LiveChildWork[],
	opts?: {hideGoalSteps?: boolean}
): LiveChildWork[] {
	return work.filter(w => {
		if (isMainSessionRun(w)) return false;
		if (opts?.hideGoalSteps && isGoalStepWork(w)) return false;
		return true;
	});
}

/** Nested subagent / fire rows suitable for Goal「详情」(not the L1 goal-step itself). */
export function goalDetailChildWork(work: LiveChildWork[]): LiveChildWork[] {
	return work.filter(w => {
		if (isGoalStepWork(w)) return false;
		if (isMainSessionRun(w)) return false;
		const title = w.title.trim().toLowerCase();
		return title === 'subagent' || Boolean(w.parentRef?.trim()) || w.kind.toLowerCase() === 'fire';
	});
}

/** Display name for an L1 step from workflowJson + stepId (fallback title / id). */
export function goalStepDisplayName(
	work: LiveChildWork,
	workflowJson: string | undefined,
	parseSteps: (json?: string) => Array<{id?: string; use?: string; name?: string}>
): string {
	const stepId = work.stepId?.trim();
	if (stepId) {
		const steps = parseSteps(workflowJson);
		const hit = steps.find(
			(s, i) => (s.id || s.use || `step-${i}`) === stepId || s.use === stepId
		);
		const named = hit?.use?.trim() || hit?.name?.trim();
		if (named) return named;
		return stepId;
	}
	const title = work.title.trim();
	if (title && !title.toLowerCase().startsWith('goal-step:')) return title;
	return work.id;
}
