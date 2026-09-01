import type {TranscriptEntry, TranscriptState} from './transcriptProjection.js';

/**
 * One user chat run owns one assistant card (the document slot).
 *
 * Settle, approval, and persist ReAct TurnStarted change chrome (Stop / tools).
 * They do not open a second card and do not retarget unkeyed persist prose.
 * Cancel of this run closes the slot. The next user submit opens a new one.
 *
 * Every "live body missing, persist has it" shape we have dumped is this
 * invariant breaking — not a new event type.
 */
export function isChatAssistant(entry: TranscriptEntry): boolean {
	return entry.role === 'assistant' && !entry.messageType && entry.status !== 'cancelled';
}

export function rememberDocument(state: TranscriptState, id: string | undefined): TranscriptState {
	if (!id) return state;
	return {...state, lastDocumentId: id};
}

export function forgetDocument(state: TranscriptState, id?: string): TranscriptState {
	if (!state.lastDocumentId) return state;
	if (id && state.lastDocumentId !== id && !sameCard(state, state.lastDocumentId, id))
		return state;
	const {lastDocumentId: _gone, ...rest} = state;
	return rest;
}

/** Card that persist/live prose must write. Never a cancelled or Goal-notice row. */
export function documentCard(
	state: TranscriptState,
	turnId?: string
): TranscriptEntry | undefined {
	if (turnId) {
		const exact = cardById(state, turnId, {allowCancelled: true, anyMessage: true});
		if (exact && exact.status !== 'cancelled') return exact;
		// Cancelled exact match: stamp is stale (bindHeld inherited the opener).
	}
	return (
		cardById(state, state.lastDocumentId) ??
		cardById(state, state.activeRunId) ??
		[...state.entries].reverse().find(e => isChatAssistant(e) && e.status === 'streaming') ??
		(state.postRunTerminal
			? [...state.entries].reverse().find(e => isChatAssistant(e) && !e.text.trim())
			: undefined)
	);
}

function cardById(
	state: TranscriptState,
	id: string | undefined,
	opts: {allowCancelled?: boolean; anyMessage?: boolean} = {}
): TranscriptEntry | undefined {
	if (!id) return undefined;
	for (let i = state.entries.length - 1; i >= 0; i -= 1) {
		const e = state.entries[i]!;
		if (e.role !== 'assistant') continue;
		if (!opts.anyMessage && e.messageType) continue;
		if (!opts.allowCancelled && e.status === 'cancelled') continue;
		if (e.turnId === id || e.clientMessageId === id) return e;
	}
	return undefined;
}

function sameCard(state: TranscriptState, documentId: string, runId: string): boolean {
	return state.entries.some(
		e =>
			e.role === 'assistant' &&
			(e.turnId === runId || e.clientMessageId === runId) &&
			(e.turnId === documentId || e.clientMessageId === documentId)
	);
}
