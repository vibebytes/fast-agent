import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState} from './index.js';

test('context_injected rows are collected and keyed by runId + label', () => {
	let state = createTranscriptState();
	assert.equal(state.contextInjections, undefined);
	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'r1',
		sourceKind: 'plugin',
		form: 'snapshot',
		label: 'Runtime context',
		text: 'first'
	});
	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'r1',
		sourceKind: 'plugin',
		form: 'snapshot',
		label: 'Runtime context',
		text: 'second'
	});
	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'r1',
		sourceKind: 'recall',
		form: 'inline',
		label: 'Recalled memory',
		text: 'memory'
	});
	assert.deepEqual(
		state.contextInjections?.map(r => [r.id, r.text]),
		[
			['r1:Runtime context', 'second'],
			['r1:Recalled memory', 'memory']
		]
	);
});

test('a run without context_injected leaves the transcript untouched', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'hi'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 't1',
		text: 'hello'
	});
	assert.equal(state.contextInjections, undefined);
	assert.equal(state.entries.length, 2);
});
