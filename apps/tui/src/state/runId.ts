import type {Turn, UiState} from './model.js';
import {approvalsFromState, questionsFromState} from './model.js';

/**
 * Engine CancelRun / AnswerQuestion / DecideApproval need the server-assigned
 * run UUID. Prefer transcript.activeRunId, then pending prompts, then the
 * streaming assistant's remapped turnId.
 */
export function engineRunId(turn: Turn | undefined): string | undefined {
	if (!turn) return undefined;
	return turn.serverTurnId ?? turn.id;
}

/** Most recent still-active Bridge run id (for CancelRun while streaming). */
export function activeTurnId(state: UiState): string | undefined {
	if (state.transcript.activeRunId) return state.transcript.activeRunId;
	for (let index = state.transcript.entries.length - 1; index >= 0; index -= 1) {
		const entry = state.transcript.entries[index];
		if (entry?.role === 'assistant' && entry.status === 'streaming') {
			// Prefer server turnId when remapped away from clientMessageId.
			if (entry.turnId && entry.turnId !== entry.clientMessageId) return entry.turnId;
			return entry.turnId ?? entry.clientMessageId;
		}
	}
	return undefined;
}

/**
 * Resolve the run id for bridge commands that target the current (or a
 * specific) run. Prefer explicit target fields, then pending dialogs, then the
 * active transcript run.
 */
export function runIdFor(state: UiState, target?: {runId?: string; turnId?: string}): string | undefined {
	const approvals = approvalsFromState(state);
	const questions = questionsFromState(state);
	return target?.runId
		?? target?.turnId
		?? approvals.at(-1)?.runId
		?? approvals.at(-1)?.turnId
		?? questions.at(-1)?.runId
		?? questions.at(-1)?.turnId
		?? activeTurnId(state)
		?? state.transcript.entries.at(-1)?.turnId;
}
