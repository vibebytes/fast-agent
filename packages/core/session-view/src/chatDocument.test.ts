/**
 * Document slot: one user chat run → one assistant card.
 * The four live-blank dumps are this invariant, not four bugs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {documentCard, forgetDocument, rememberDocument} from './chatDocument.js';
import {createTranscriptState, type TranscriptEntry, type TranscriptState} from './transcriptProjection.js';

function assistant(partial: Partial<TranscriptEntry> & {id: string; turnId: string}): TranscriptEntry {
	return {
		role: 'assistant',
		text: '',
		status: 'streaming',
		...partial
	};
}

function withCards(...entries: TranscriptEntry[]): TranscriptState {
	return {...createTranscriptState(), entries};
}

test('documentCard prefers lastDocumentId over a cancelled opener', () => {
	const cancelled = assistant({
		id: 'a1',
		turnId: 'run-1',
		clientMessageId: 'c1',
		status: 'cancelled'
	});
	const live = assistant({id: 'a2', turnId: 'run-2', clientMessageId: 'c2', text: ''});
	const state = rememberDocument(withCards(cancelled, live), 'run-2');
	const card = documentCard(state, 'run-1');
	assert.equal(card?.id, 'a2');
});

test('documentCard still finds the approval-sealed card (status done, run live)', () => {
	const sealed = assistant({id: 'a1', turnId: 'run-2', status: 'done', text: ''});
	const state = {...rememberDocument(withCards(sealed), 'run-2'), activeRunId: 'run-2'};
	assert.equal(documentCard(state)?.id, 'a1');
	assert.equal(documentCard(state, 'run-2')?.id, 'a1');
});

test('forgetDocument only closes the matching run', () => {
	const live = assistant({id: 'a2', turnId: 'run-2'});
	const state = rememberDocument(withCards(live), 'run-2');
	assert.equal(forgetDocument(state, 'run-1').lastDocumentId, 'run-2');
	assert.equal(forgetDocument(state, 'run-2').lastDocumentId, undefined);
});
