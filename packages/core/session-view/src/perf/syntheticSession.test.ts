import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState} from '../transcriptProjection.js';
import {
	SYNTHETIC_DEFAULTS,
	syntheticOptionsFromEnv,
	syntheticSession,
	syntheticStreamingDelta
} from './syntheticSession.js';

const SMALL = {turns: 3, deltasPerTurn: 5, deltaLen: 20, toolsPerTurn: 2, approvals: 2, scale: 1};

test('synthetic events are consumable by transcriptProjection without error', () => {
	let state = createTranscriptState();
	for (const event of syntheticSession(SMALL)) {
		state = applyBridgeEvent(state, event);
	}
	// 3 completed turns (user+assistant each) + trailing live turn pair.
	assert.equal(state.entries.length, SMALL.turns * 2 + 2);
	const last = state.entries.at(-1)!;
	assert.equal(last.role, 'assistant');
	assert.equal(last.status, 'streaming', 'trailing turn stays streaming for the card scenario');
	assert.equal(state.approvals.length, SMALL.approvals, 'pending approvals survive');
	const done = state.entries.filter(e => e.role === 'assistant' && e.status === 'done');
	assert.equal(done.length, SMALL.turns, 'completed turns are done');
	assert.ok(done.every(e => (e.tools ?? []).length === SMALL.toolsPerTurn), 'tools attached');
});

test('deterministic: same options produce identical sequences', () => {
	assert.deepEqual(syntheticSession(SMALL), syntheticSession(SMALL));
});

test('scale multiplies turns', () => {
	const single = syntheticSession({...SMALL, approvals: 0});
	const doubled = syntheticSession({...SMALL, approvals: 0, scale: 2});
	assert.equal(doubled.length, single.length * 2);
});

test('streaming delta targets the live turn', () => {
	let state = createTranscriptState();
	for (const event of syntheticSession(SMALL)) state = applyBridgeEvent(state, event);
	const before = state.entries.at(-1)!.text.length;
	state = applyBridgeEvent(state, syntheticStreamingDelta(0));
	assert.ok(state.entries.at(-1)!.text.length > before, 'delta appended to live entry');
});

test('env parsing falls back to defaults and clamps scale', () => {
	assert.deepEqual(syntheticOptionsFromEnv({}), SYNTHETIC_DEFAULTS);
	const opts = syntheticOptionsFromEnv({FLOW_PERF_TURNS: '7', FLOW_PERF_SCALE: '0', FLOW_PERF_DELTA_LEN: 'junk'});
	assert.equal(opts.turns, 7);
	assert.equal(opts.scale, 1, 'scale clamps to >=1');
	assert.equal(opts.deltaLen, SYNTHETIC_DEFAULTS.deltaLen, 'junk falls back');
});
