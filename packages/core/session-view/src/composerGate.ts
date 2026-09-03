/**
 * Shared Composer Gate policy (ADR-0007 + CONTEXT Composer Gate).
 * Pure derivation — hosts own timers and copy text.
 */

import {createTranscriptState, type TranscriptState} from './transcriptProjection.js';

/** Default matches Engine ~10s hard timeout + small buffer. */
export const CANCEL_SETTLEMENT_TIMEOUT_MS = 12_000;

/** Engine run_state heartbeat interval (aligned with CommandLoop durationProp). */
export const RUN_LEASE_INTERVAL_MS = 5_000;
/** 3× interval — tolerate two missed heartbeats before expiry. */
export const RUN_LEASE_TTL_MS = 15_000;

export type RunState = 'idle' | 'running' | 'stopping';

export type ComposerLockReason = 'prompt' | null;

export type ComposerGate = {
	runState: RunState;
	canSubmitNow: boolean;
	canEnqueue: boolean;
	canCancel: boolean;
	composerLocked: boolean;
	lockReason: ComposerLockReason;
};

export type TurnTerminal = 'finished' | 'cancelled';

export type ComposerRunFlags = {
	sessionReady: boolean;
	running: boolean;
	awaitingCancelSettlement: boolean;
	leaseExpired?: boolean;
	approvals: TranscriptState['approvals'];
	questions: TranscriptState['questions'];
	questionBatches?: TranscriptState['questionBatches'];
};

/**
 * Auto-send the Composer queue after a normal Turn finish; never on the cancel path.
 * Hosts still honour user `queuePaused` and session readiness on top of this.
 */
export function canAutoDequeue(terminal: TurnTerminal): boolean {
	return terminal === 'finished';
}

/**
 * Whether the host should flush the next queued Composer input.
 * - `lastTurnTerminal == null`: boot buffer (typed before sessionReady) — flush once ready.
 * - `finished`: normal post-turn queue.
 * - `cancelled`: never auto-send (ADR-0007).
 */
export function canFlushQueuedInput(opts: {
	sessionReady: boolean;
	running: boolean;
	queuePaused: boolean;
	queueLength: number;
	lastTurnTerminal: TurnTerminal | null | undefined;
}): boolean {
	if (!opts.sessionReady || opts.running || opts.queuePaused || opts.queueLength === 0) return false;
	if (opts.lastTurnTerminal == null) return true;
	return canAutoDequeue(opts.lastTurnTerminal);
}

/**
 * Derive Composer affordances from Transcript state + host-folded session readiness.
 * `sessionReady` = Session exists, attached, not pending create/attach — not prompt lock.
 */
export function composerGate(
	transcript: TranscriptState,
	sessionReady: boolean,
	leaseExpired = false
): ComposerGate {
	const hasPrompt =
		transcript.approvals.length > 0 ||
		transcript.questions.length > 0 ||
		transcript.questionBatches.length > 0;
	const stopping = Boolean(transcript.awaitingCancelSettlement);
	const hasRun =
		!leaseExpired &&
		(Boolean(transcript.activeRunId) ||
			transcript.entries.some(e => e.status === 'streaming'));

	// Waiting for user (question / approval) is not model execution. Fast IDE Stop is
	// bound to canCancel — keeping runState=running after ask_user_question leaves the
	// Stop button lit after SkillSlash/grilling has already handed control to the user
	// (repro: repro-skillslash-stuck-stop.mjs FIXTURE=ask).
	const runState: RunState =
		stopping ? 'stopping' : hasRun && !hasPrompt ? 'running' : 'idle';
	const composerLocked = hasPrompt;
	const lockReason: ComposerLockReason = hasPrompt ? 'prompt' : null;
	const canCancel = runState === 'running' || runState === 'stopping';
	const canSubmitNow = sessionReady && !composerLocked && runState === 'idle';
	const canEnqueue =
		sessionReady && !composerLocked && (runState === 'running' || runState === 'stopping');

	return {runState, canSubmitNow, canEnqueue, canCancel, composerLocked, lockReason};
}

/**
 * Host adapter when the Thin Client does not share Transcript projection yet.
 * Maps run / Stopping / prompt flags only — does not inspect transcript entries.
 */
export function composerGateFromRunFlags(flags: ComposerRunFlags): ComposerGate {
	return composerGate(
		{
			...createTranscriptState(),
			approvals: flags.approvals,
			questions: flags.questions,
			questionBatches: flags.questionBatches ?? [],
			activeRunId:
				flags.running && !flags.awaitingCancelSettlement ? 'active' : undefined,
			awaitingCancelSettlement: flags.awaitingCancelSettlement
		},
		flags.sessionReady,
		flags.leaseExpired ?? false
	);
}
