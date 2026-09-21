/** reducer.test — submit_user / input_accepted / input_rejected. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {turnsToTimeline} from '../timeline/turnAdapter.js';
import {
	userEntries,
	assistantEntries,
	lastAssistant,
	lastUser,
	entryStatus,
	bridgeTurnCount,
	assistantText,
	userText,
	thinking,
	tools,
	segments,
	localSystemMessages,
	lastLocalTurn,
	approvalsFromState,
	questionsFromState
} from '../../test-utils/transcriptAssert.js';

test('input_rejected already-running keeps peer turn live without error banner', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'turn_started',
			turnId: 'ide_turn',
			clientMessageId: 'ide_turn',
			text: '/skill'
		}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'input_rejected',
			clientMessageId: 'ink_bounce',
			reason: 'A turn is already running'
		}
	});
	assert.equal(state.running, true);
	assert.equal(state.errors.length, 0);
	assert.equal(lastAssistant(state)?.status, 'streaming');
});

test('submit_user immediately enters running/thinking state before any engine event', () => {
	// Guards the "thinking 过程没有了" regression: the optimistic local turn must
	// flip the UI into a running state the instant the user submits, even if the
	// engine is slow to ack (or stalls entirely on the backend route).
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});

	assert.equal(state.running, true);
	assert.equal(state.inputMode, 'running');
	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'hello');
	assert.equal(entryStatus(lastUser(state)), 'pending');
});

test('optimistic bridge sequence (input_accepted -> turn_started -> thinking_started) keeps a single running turn with thinking progress', () => {
	// Mirrors the exact optimistic events the Scala bridge now emits synchronously
	// in handleUserMessage, before the sharded SessionEntity.Route reply arrives.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_started', turnId: 'turn_1', clientMessageId: 'client_1', text: 'go'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'thinking_started', turnId: 'turn_1', turn: 1, maxTurns: 50}});

	assert.equal(state.running, true);
	assert.equal(state.status, 'thinking 1/50');
	assert.equal(bridgeTurnCount(state), 1, 'optimistic local turn must reconcile with the engine turn id, not duplicate');
	assert.equal(lastAssistant(state)?.turnId, 'turn_1');
	assert.equal(entryStatus(lastAssistant(state)), 'running');
});

test('input_rejected stops running and marks the originating turn failed', () => {
	// The bridge rejects concurrent submissions ("A turn is already running"); the
	// UI must leave the running state instead of spinning a phantom thinking block.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_rejected', clientMessageId: 'client_1', reason: 'A turn is already running'}});

	assert.equal(state.running, false);
	assert.equal(state.status, 'rejected');
	assert.equal(entryStatus(lastAssistant(state)), 'failed');
	assert.equal(state.errors.at(-1), 'A turn is already running');
});

test('multi-turn: second turn after first completes', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});

	state = reducer(state, {type: 'submit_user', text: 'first', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'answer1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(state.running, false);
	assert.equal(bridgeTurnCount(state), 1);

	state = reducer(state, {type: 'submit_user', text: 'second', clientMessageId: 'client_2'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_2', turnId: 'turn_2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_2', text: 'answer2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_2', success: true}});

	assert.equal(bridgeTurnCount(state), 2);
	assert.equal(assistantText(state, 0), 'answer1');
	assert.equal(assistantText(state, 1), 'answer2');
	assert.equal(state.running, false);
});

// ── Undo ──────────────────────────────────────────────────────────
