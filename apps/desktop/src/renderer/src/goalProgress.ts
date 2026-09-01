/** Parse Goal.progress_json for live flowchart / drawer (shared by Teams + session drawer). */
export function goalProgress(progressJson?: string | null): {
	completedSteps: Set<string>;
	pendingExtras: Set<string>;
	rejectCount: number;
} {
	const empty = {
		completedSteps: new Set<string>(),
		pendingExtras: new Set<string>(),
		rejectCount: 0
	};
	if (!progressJson?.trim()) return empty;
	try {
		const raw = JSON.parse(progressJson) as {
			completed_steps?: string[];
			pending_extras?: Record<string, unknown>;
			reject_count?: number;
		};
		return {
			completedSteps: new Set(
				Array.isArray(raw.completed_steps) ? raw.completed_steps.filter(Boolean) : []
			),
			pendingExtras: new Set(
				raw.pending_extras && typeof raw.pending_extras === 'object'
					? Object.keys(raw.pending_extras)
					: []
			),
			rejectCount: typeof raw.reject_count === 'number' ? raw.reject_count : 0
		};
	} catch {
		return empty;
	}
}
