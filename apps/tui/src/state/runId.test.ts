import test from 'node:test';
import assert from 'node:assert/strict';
import {canAutoDequeue, createTranscriptState} from '@fast-ide/session-view';
import {initialState, type Turn, type UiState} from './model.js';
import {reducer} from './reducer.js';
import {activeTurnId, engineRunId, runIdFor} from './runId.js';
import {lastAssistant} from '../test-utils/transcriptAssert.js';

function turn(partial: Partial<Turn> & Pick<Turn, 'id'>): Turn {
	return {
		userText: '',
		thinking: '',
		assistantText: '',
		tools: [],
		files: [],
		systemMessages: [],
		segments: [],
		status: 'running',
		tokensUsed: 0,
		streamSeq: 0,
		...partial
	};
}

test('engineRunId prefers serverTurnId over client id', () => {
	assert.equal(engineRunId(turn({id: 'client_abc', serverTurnId: '019f-server-uuid'})), '019f-server-uuid');
	assert.equal(engineRunId(turn({id: 'client_only'})), 'client_only');
	assert.equal(engineRunId(undefined), undefined);
});

test('activeTurnId returns server UUID for a double-accepted running turn', () => {
	let state: UiState = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'client_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: '019f-real-run'}});

	assert.equal(lastAssistant(state)?.turnId, '019f-real-run', 'assistant entry remapped to the server run id');
	assert.equal(activeTurnId(state), '019f-real-run', 'CancelRun must target the server run');
	assert.equal(runIdFor(state), '019f-real-run');
});

test('runIdFor after local_cancel still resolves last turn via activeRunId', () => {
	let state: UiState = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'client_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: '019f-real-run'}});
	state = reducer(state, {type: 'local_cancel'});

	assert.equal(state.running, true, 'O1: keep running until turn_cancelled (Stopping)');
	assert.equal(state.transcript.awaitingCancelSettlement, true);
	assert.equal(state.queuePaused, true);
	assert.equal(lastAssistant(state)?.status, 'cancelled');
	assert.equal(activeTurnId(state), '019f-real-run', 'activeRunId stays targetable while Stopping');
	assert.equal(runIdFor(state), '019f-real-run', 'fallback must not send client_* to the engine');

	state = reducer(state, {type: 'engine_event', event: {type: 'turn_cancelled', reason: 'stop'}});
	assert.equal(state.running, false);
	assert.equal(state.transcript.awaitingCancelSettlement, false);
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(state.queuePaused, true, 'queue must not auto-send after cancel');
	assert.equal(canAutoDequeue(state.lastTurnTerminal), false);
});

test('runIdFor prefers explicit target and pending approval over turn ids', () => {
	const state: UiState = {
		...initialState,
		ready: true,
		running: true,
		transcript: {
			...createTranscriptState(),
			entries: [{
				id: 'assistant-client_1',
				role: 'assistant',
				text: '',
				status: 'streaming',
				turnId: 'client_1'
			}],
			approvals: [{
				id: 'a1',
				runId: 'server-from-approval',
				tool: 'shell',
				description: 'run',
				risk: 'Shell',
				context: 'ls'
			}]
		}
	};
	assert.equal(runIdFor(state), 'server-from-approval');
	assert.equal(runIdFor(state, {runId: 'explicit-run'}), 'explicit-run');
	assert.equal(runIdFor(state, {turnId: 'explicit-turn'}), 'explicit-turn');
});

test('runIdFor before server accept falls back to client id (only id available)', () => {
	let state: UiState = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_early'});
	assert.equal(runIdFor(state), 'client_early');
});
