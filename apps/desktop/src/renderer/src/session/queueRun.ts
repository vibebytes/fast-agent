/** What the queued-message row and the composer primary button should offer. */
export type QueueAffordance = 'run' | 'interrupt' | 'none';

/**
 * Idle + a Follow-up queue means drain was missed (or Stop left the queue).
 * The primary control must light as「执行」. A live turn lights「插话」instead.
 * Paused, locked, and empty queues stay quiet.
 */
export function queueAffordance(opts: {
	runState: 'idle' | 'running' | 'stopping';
	canSubmitNow: boolean;
	canEnqueue: boolean;
	canCancel: boolean;
	queuePaused: boolean;
	queueLength: number;
}): QueueAffordance {
	if (opts.queuePaused || opts.queueLength === 0) return 'none';
	// Goal-busy keeps canSubmitNow so Enter can steer, but the turn is not idle.
	if (opts.runState === 'idle' && opts.canSubmitNow) return 'run';
	if (opts.canEnqueue || opts.canCancel || opts.runState !== 'idle') return 'interrupt';
	return 'none';
}

/** Empty composer still lights the send button so it can run the queued head. */
export function sendLightsForQueuedRun(opts: {
	affordance: QueueAffordance;
	hasDraft: boolean;
	composerDisabled: boolean;
}): boolean {
	return opts.affordance === 'run' && !opts.hasDraft && !opts.composerDisabled;
}
