import {canFlushQueuedInput, type RunState} from './composerGate.js';

export type CompletionCueKind = 'turn_finished' | 'goal_finished';

export type CompletionCueInput = {
	kind: CompletionCueKind | 'other';
	/** True when this Task was running/stopping (or Goal-busy) before the settle event. */
	wasBusy: boolean;
	runState: RunState;
	composerLocked: boolean;
	queueLength: number;
	queuePaused: boolean;
	/** After the event: Goal track still owns the session. */
	goalBusy: boolean;
};

/** Play the completion chime only when a turn/goal actually hands control back to the user. */
export function shouldSoundOnSettle(opts: CompletionCueInput): boolean {
	if (opts.kind === 'other' || !opts.wasBusy) return false;
	if (opts.goalBusy) return false;
	if (opts.kind === 'turn_finished') {
		if (opts.runState !== 'idle' || opts.composerLocked) return false;
	}
	if (
		canFlushQueuedInput({
			sessionReady: true,
			running: false,
			queuePaused: opts.queuePaused,
			queueLength: opts.queueLength,
			lastTurnTerminal: 'finished'
		})
	) {
		return false;
	}
	return true;
}
