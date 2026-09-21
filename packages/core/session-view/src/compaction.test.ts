import assert from 'node:assert/strict';
import test from 'node:test';
import {COMPACTION_WAIT_REASON, formatThoughtChromeEn} from './chrome.js';
import {toTimelineItems} from './timeline.js';
import {compactionNotice, contextPruneText, tokenSpan} from './transcript/usage.js';
import {applyBridgeEvent, createTranscriptState} from './transcriptProjection.js';

const caps = {usage: true, childTranscript: true, contextPrune: true, goalDelta: true};

test('context_compacting marks the run and the streaming answer; context_pruned closes both', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run_1', text: 'partial'});
	state = applyBridgeEvent(state, {
		type: 'context_compacting',
		runId: 'run_1',
		trigger: 'threshold',
		tokensBefore: 128_000
	});
	assert.equal(state.compacting?.runId, 'run_1');
	assert.equal(state.compacting?.trigger, 'threshold');
	assert.equal(state.compacting?.tokensBefore, 128_000);
	const running = compactionNotice(state, caps);
	assert.equal(running?.phase, 'running');
	assert.match(running!.text, /正在压缩上下文（128k）/);
	// The streaming answer shows the same chrome slot network waits use.
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.waitState?.reason, COMPACTION_WAIT_REASON);
	const thought = toTimelineItems(state).find(i => i.kind === 'thought' && i.open);
	assert.ok(thought && thought.kind === 'thought');
	assert.equal(formatThoughtChromeEn(thought.chrome), 'Compacting context');

	state = applyBridgeEvent(state, {
		type: 'context_pruned',
		runId: 'run_1',
		prunedIds: [],
		reason: 'summary',
		remainingTokens: 51_000,
		durationMs: 42_000
	});
	assert.equal(state.compacting, undefined);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.waitState, undefined);
	const done = compactionNotice(state, caps);
	assert.equal(done?.phase, 'done');
	assert.equal(done?.reason, 'summary');
	// tokensBefore carried from the compacting state when the prune omits it.
	assert.equal(done?.tokensBefore, 128_000);
	assert.equal(done?.remainingTokens, 51_000);
	assert.equal(done?.durationMs, 42_000);
	assert.equal(done?.text, '历史上下文已压缩为摘要（128k → 51k）');
});

test('a compacting state left behind by a dead run is cleared on turn_finished', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {type: 'context_compacting', runId: 'run_1', trigger: 'manual'});
	assert.ok(state.compacting);
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run_1', success: false, reason: 'boom'});
	assert.equal(state.compacting, undefined);
	assert.equal(compactionNotice(state, caps), null);
});

test('compactionNotice is gated by the contextPrune cap and falls back to the latest prune', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run_1'});
	state = applyBridgeEvent(state, {type: 'context_pruned', runId: 'run_1', prunedIds: [], reason: 'nothing-to-compact'});
	assert.equal(compactionNotice(state, {...caps, contextPrune: false}), null);
	assert.equal(compactionNotice(state, caps)?.text, '当前没有可压缩的历史上下文');
	assert.equal(contextPruneText({runId: 'r', prunedIds: [], reason: 'summary-fallback', tokensBefore: 90_500, remainingTokens: 40_000}),
		'摘要压缩未成功，已回退到裁剪方式（91k → 40k）');
	assert.equal(tokenSpan(1500, 800), '1.5k → 800');
	assert.equal(tokenSpan(undefined, 800), undefined);
});
