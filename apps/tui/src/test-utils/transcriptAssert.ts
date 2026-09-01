/**
 * Test helpers for Candidate J embed: assert against transcript / localTurns.
 */
import type {ToolCallView, TranscriptEntry} from '@fast-ide/session-view';
import type {Turn, UiState} from '../state/model.js';
import {approvalsFromState, questionsFromState} from '../state/model.js';

export function userEntries(state: UiState): TranscriptEntry[] {
	return state.transcript.entries.filter(e => e.role === 'user');
}

export function assistantEntries(state: UiState): TranscriptEntry[] {
	return state.transcript.entries.filter(e => e.role === 'assistant');
}

export function lastAssistant(state: UiState): TranscriptEntry | undefined {
	return assistantEntries(state).at(-1);
}

export function lastUser(state: UiState): TranscriptEntry | undefined {
	return userEntries(state).at(-1);
}

/** Approximate old Turn.status from a TranscriptEntry. */
export function entryStatus(entry: TranscriptEntry | undefined): string | undefined {
	if (!entry) return undefined;
	if (entry.role === 'user') {
		return entry.clientMessageId && entry.turnId === entry.clientMessageId ? 'pending' : 'success';
	}
	switch (entry.status) {
		case 'streaming':
			return entry.clientMessageId && entry.turnId === entry.clientMessageId ? 'pending' : 'running';
		case 'done':
			return 'success';
		case 'error':
			return 'failed';
		case 'cancelled':
			return 'cancelled';
	}
}

export function bridgeTurnCount(state: UiState): number {
	return Math.max(userEntries(state).length, assistantEntries(state).length);
}

export function assistantText(state: UiState, index = 0): string {
	return assistantEntries(state)[index]?.text ?? '';
}

export function userText(state: UiState, index = 0): string {
	return userEntries(state)[index]?.text ?? '';
}

export function thinking(state: UiState, index = 0): string {
	return assistantEntries(state)[index]?.reasoning ?? '';
}

export function tools(state: UiState, index = 0): ToolCallView[] {
	return assistantEntries(state)[index]?.tools ?? [];
}

export function segments(state: UiState, index = 0) {
	return assistantEntries(state)[index]?.segments ?? [];
}

export function localSystemMessages(state: UiState) {
	return state.localTurns.flatMap(turn => turn.systemMessages);
}

export function lastLocalTurn(state: UiState): Turn | undefined {
	return state.localTurns.at(-1);
}

export {approvalsFromState, questionsFromState};
