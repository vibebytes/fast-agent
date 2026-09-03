import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyBridgeEvent, createTranscriptState} from './transcriptProjection.js';
import {composerGate} from './composerGate.js';

function live(): ReturnType<typeof createTranscriptState> {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-1',
		text: 'hello'
	});
	return state;
}

test('run_state heartbeat keeps Composer running and marks leaseAware', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 1
	});
	assert.equal(state.leaseAware, true);
	assert.equal(state.runLease?.state, 'running');
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true, true).runState, 'idle');
});

test('run_state waiting does not clear HITL lock', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'question_requested',
		id: 'q1',
		runId: 'run-1',
		turnId: 'run-1',
		question: 'Pick',
		options: [{id: 'a', label: 'A'}],
		allowCustom: false
	});
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'waiting',
		ts: 1
	});
	const gate = composerGate(state, true);
	assert.equal(gate.composerLocked, true);
	assert.equal(state.questions.length, 1);
	assert.equal(composerGate(state, true, true).composerLocked, true);
});

test('run_state idle snapshot locally settles a busy transcript', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 1
	});
	state = applyBridgeEvent(state, {
		type: 'run_state',
		state: 'idle',
		ts: 2
	});
	assert.equal(state.activeRunId, undefined);
	assert.equal(state.leaseAware, false);
	assert.equal(state.entries.some(e => e.status === 'streaming'), false);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canSubmitNow, true);
});

test('run_state idle does not settle a new run that never saw a heartbeat', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		state: 'idle',
		ts: 1
	});
	assert.equal(state.leaseAware, false);
	assert.equal(state.activeRunId, 'run-1');
	assert.equal(composerGate(state, true).runState, 'running');
});

test('turn_started clears leaseAware from the previous run', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 1
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-1', success: true});
	assert.equal(state.leaseAware, false);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-2',
		clientMessageId: 'c2',
		text: 'next'
	});
	assert.equal(state.leaseAware, false);
	state = applyBridgeEvent(state, {type: 'run_state', state: 'idle', ts: 3});
	assert.equal(state.activeRunId, 'run-2');
	assert.equal(composerGate(state, true).runState, 'running');
});

test('run_state running snapshot revives a locally settled chat run', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 1
	});
	state = applyBridgeEvent(state, {type: 'run_state', state: 'idle', ts: 2});
	assert.equal(composerGate(state, true).runState, 'idle');
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 3
	});
	assert.equal(state.activeRunId, 'run-1');
	assert.equal(state.entries.some(e => e.status === 'streaming'), true);
	assert.equal(composerGate(state, true).runState, 'running');
});

test('run_state waiting snapshot revives a locally settled chat run', () => {
	let state = live();
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: 1
	});
	state = applyBridgeEvent(state, {type: 'run_state', state: 'idle', ts: 2});
	assert.equal(composerGate(state, true).runState, 'idle');
	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		state: 'waiting',
		ts: 3
	});
	assert.equal(state.activeRunId, 'run-1');
	assert.equal(state.entries.some(e => e.status === 'streaming'), true);
	assert.equal(composerGate(state, true).runState, 'running');
});

test('turn_finished still unlocks immediately without waiting for lease', () => {
	let state = live();
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-1', success: true});
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
});
