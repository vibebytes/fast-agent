const ACTIVE = new Set(['armed', 'paused']);

/** Jobs shown in the IDE「调度任务」rail — project loops + platform automations. */
export function scheduledJobsVisible<T extends {kind: string; status?: string}>(jobs: T[]): T[] {
	return jobs.filter(
		j =>
			(j.kind === 'session_loop' || j.kind === 'platform') &&
			ACTIVE.has((j.status ?? '').toLowerCase())
	);
}

export function scheduledJobKindLabel(kind: string): string {
	if (kind === 'platform') return 'Automation';
	if (kind === 'session_loop') return 'Loop';
	return kind;
}
