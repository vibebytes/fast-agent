/**
 * Transcript keep-alive stash (tab-switch perf, final tier).
 *
 * The mounted `VirtualTranscript` of a Task the user just left is kept in the
 * tree (`display: none`) with its render props frozen, so switching back skips
 * the whole mount — React sees the same keyed instance and identical props.
 * MRU-capped: at most `KEEP_ALIVE_MAX` hidden panes besides the active one.
 */

export const KEEP_ALIVE_MAX = 2;

export type KeepAliveEntry<P> = {taskId: string; pane: P};

/**
 * Reconcile the stash on a focus switch: the leaving pane (frozen at its last
 * live render) moves to the front; the newly active Task leaves the stash
 * (it renders live); oldest entries beyond the cap are dropped (cold next visit).
 */
export function stashOnSwitch<P>(
	stash: readonly KeepAliveEntry<P>[],
	leaving: KeepAliveEntry<P> | null,
	activeTaskId: string | null,
	max = KEEP_ALIVE_MAX
): KeepAliveEntry<P>[] {
	const rest = stash.filter(
		e => e.taskId !== activeTaskId && e.taskId !== leaving?.taskId
	);
	const next = leaving && leaving.taskId !== activeTaskId ? [leaving, ...rest] : rest;
	return next.slice(0, Math.max(0, max));
}
