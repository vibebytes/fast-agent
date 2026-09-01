import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatThoughtChromeEn,
	networkWaitLabel,
	thoughtChromeFrom
} from './chrome.js';
import {toTimelineItems} from './timeline.js';
import {applyBridgeEvent, createTranscriptState} from './transcriptProjection.js';

test('networkWaitLabel formats retrying and waiting (deprecated English wrapper)', () => {
	// attempt/maxAttempts = silent-retry index / max extra retries (not total attempts)
	assert.equal(networkWaitLabel({phase: 'retrying', attempt: 1, maxAttempts: 2}), 'Reconnecting (1/2)');
	assert.equal(networkWaitLabel({phase: 'waiting'}), 'Waiting for network');
	assert.equal(networkWaitLabel(undefined), undefined);
});

test('thoughtChromeFrom emits open / duration / network kinds', () => {
	assert.deepEqual(thoughtChromeFrom('x', {open: true}), {kind: 'open'});
	assert.deepEqual(
		thoughtChromeFrom('short', {
			open: false,
			startedAt: 1_000,
			sealedAt: 4_500
		}),
		{kind: 'duration', seconds: 4}
	);
	assert.deepEqual(
		thoughtChromeFrom('', {
			open: true,
			wait: {phase: 'retrying', attempt: 1, maxAttempts: 2}
		}),
		{kind: 'network', phase: 'retrying', attempt: 1, maxAttempts: 2}
	);
	assert.equal(
		formatThoughtChromeEn({kind: 'network', phase: 'retrying', attempt: 1, maxAttempts: 2}),
		'Reconnecting (1/2)'
	);
});

test('llm_network_wait sets waitState on streaming assistant and clears on first delta', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {
		type: 'llm_network_wait',
		runId: 'run_1',
		phase: 'retrying',
		attempt: 1,
		maxAttempts: 2
	});
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.waitState?.phase, 'retrying');
	assert.equal(assistant!.waitState?.attempt, 1);

	const items = toTimelineItems(state);
	const thought = items.find(i => i.kind === 'thought' && i.open);
	assert.ok(thought && thought.kind === 'thought');
	assert.deepEqual(thought.chrome, {
		kind: 'network',
		phase: 'retrying',
		attempt: 1,
		maxAttempts: 2
	});

	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run_1', text: 'hi'});
	const after = state.entries.find(e => e.role === 'assistant');
	assert.equal(after!.waitState, undefined);
});

test('llm_network_wait ignored on finished assistant (live-only)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run_1', success: true});
	state = applyBridgeEvent(state, {
		type: 'llm_network_wait',
		runId: 'run_1',
		phase: 'waiting',
		elapsedMs: 5000
	});
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant!.waitState, undefined);
});

test('llm_network_wait discard clears streaming text before retry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run_1', text: 'half'});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'run_1', text: 'think'});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, 'half');
	state = applyBridgeEvent(state, {
		type: 'llm_network_wait',
		runId: 'run_1',
		phase: 'retrying',
		attempt: 1,
		maxAttempts: 1,
		discard: true
	});
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.text, '');
	assert.equal(assistant?.reasoning, undefined);
	assert.equal(assistant?.waitState?.phase, 'retrying');
});
