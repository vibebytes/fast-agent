import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState} from './index.js';
import {
	childTranscriptText,
	contextPruneNotice,
	contextUsage,
	formatCompactTokens,
	usageFooter
} from './transcript/usage.js';

const CAPS_ON = {usage: true, childTranscript: true, goalDelta: true, contextPrune: true};
const CAPS_OFF = {usage: false, childTranscript: false, goalDelta: false, contextPrune: false};

function withUsage() {
	return applyBridgeEvent(createTranscriptState(), {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 't1',
		buckets: {output: 40, input: 120, cache_read: 80, total: 240, zeta: 1},
		raw: {model: 'gpt-5', reasoning: '10'}
	});
}

test('usageFooter renders ordered buckets when caps.delta.usage is true', () => {
	const footer = usageFooter(withUsage(), CAPS_ON);
	assert.equal(footer?.runId, 'r1');
	assert.equal(footer?.turnId, 't1');
	assert.deepEqual(footer?.buckets.map(b => b.key), ['input', 'output', 'cache_read', 'total', 'zeta']);
	assert.deepEqual(footer?.raw, {model: 'gpt-5', reasoning: '10'});
});

test('usageFooter is null when caps.delta.usage is false or absent', () => {
	assert.equal(usageFooter(withUsage(), CAPS_OFF), null);
	assert.equal(usageFooter(withUsage(), undefined), null);
});

test('usageFooter is null without a usage event even when caps allow it', () => {
	assert.equal(usageFooter(createTranscriptState(), CAPS_ON), null);
});

test('contextPruneNotice returns the latest notice only when caps allow it', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'context_pruned',
		runId: 'r1',
		prunedIds: ['a'],
		reason: 'window',
		remainingTokens: 900
	});
	state = applyBridgeEvent(state, {
		type: 'context_pruned',
		runId: 'r1',
		prunedIds: ['b', 'c'],
		reason: 'window',
		remainingTokens: 800
	});
	const notice = contextPruneNotice(state, CAPS_ON);
	assert.deepEqual(notice?.prunedIds, ['b', 'c']);
	assert.equal(notice?.remainingTokens, 800);
	assert.equal(contextPruneNotice(state, CAPS_OFF), null);
	// Fast path: no dsh_caps → undefined delta still shows prune notices.
	assert.deepEqual(contextPruneNotice(state, undefined)?.prunedIds, ['b', 'c']);
	assert.equal(contextPruneNotice(createTranscriptState(), CAPS_ON), null);
});

const compactionNotices = {
	'nothing-to-compact': '当前没有可压缩的历史上下文',
	'summary-breaker': '摘要压缩暂时熔断，已使用裁剪方式释放上下文',
	'summary-fallback': '摘要压缩未成功，已回退到裁剪方式',
	'summary': '历史上下文已压缩为摘要',
	'compaction': '历史上下文已裁剪'
};

for (const [reason, text] of Object.entries(compactionNotices)) {
	test(`contextPruneNotice retains ${reason} without message ids`, () => {
		const state = applyBridgeEvent(createTranscriptState(), {
			type: 'context_pruned', runId: 'r1', prunedIds: [], reason
		});
		assert.equal(contextPruneNotice(state, CAPS_ON)?.reason, reason);
		assert.equal(contextPruneNotice(state, CAPS_ON)?.text, text);
		assert.equal(contextPruneNotice(state, CAPS_OFF), null);
	});
}

test('childTranscriptText returns the tail only when caps allow it', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'child_transcript_delta',
		childSessionId: 'c1',
		childSeq: 1,
		entryKind: 'assistant',
		payloadJson: 'hello '
	});
	state = applyBridgeEvent(state, {
		type: 'child_transcript_delta',
		childSessionId: 'c1',
		childSeq: 2,
		entryKind: 'assistant',
		payloadJson: 'world'
	});
	assert.equal(childTranscriptText(state, 'c1', CAPS_ON), 'hello world');
	assert.equal(childTranscriptText(state, 'c1', CAPS_OFF), null);
	assert.equal(childTranscriptText(state, 'missing', CAPS_ON), null);
	assert.equal(childTranscriptText(state, '  ', CAPS_ON), null);
});

test('formatCompactTokens formats small, k, and M token counts cleanly', () => {
	assert.equal(formatCompactTokens(0), '0');
	assert.equal(formatCompactTokens(850), '850');
	assert.equal(formatCompactTokens(1200), '1.2k');
	assert.equal(formatCompactTokens(128000), '128k');
	assert.equal(formatCompactTokens(54120), '54.1k');
	assert.equal(formatCompactTokens(1048576), '1.0M');
});

test('contextUsage computes percentage, level, breakdown, and cache hit rate', () => {
	const state = applyBridgeEvent(createTranscriptState(), {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 't1',
		buckets: {
			input: 64000,
			output: 1200,
			cache_read: 48000,
			cache_write: 4000,
			total: 65200,
			context_used: 64000,
			context_window: 128000,
			context_budget: 102400,
			ctx_system: 4000,
			ctx_memory: 2000,
			ctx_tools: 8000,
			ctx_summary: 10000,
			ctx_messages: 40000
		},
		raw: {model: 'deepseek-v4', provider: 'deepseek', cost: '$0.012'}
	});

	const view = contextUsage(state);
	assert.ok(view);
	assert.equal(view.usedTokens, 64000);
	assert.equal(view.contextWindow, 128000);
	assert.equal(view.contextBudget, 102400);
	assert.equal(view.percent, 50);
	assert.equal(view.level, 'normal');
	assert.equal(view.cacheHitPercent, 75);
	assert.equal(view.inputTokens, 64000);
	assert.equal(view.outputTokens, 1200);
	assert.equal(view.cacheReadTokens, 48000);
	assert.equal(view.cacheWriteTokens, 4000);
	assert.equal(view.totalTokens, 65200);
	assert.equal(view.breakdown.length, 4);
	assert.deepEqual(
		view.breakdown.map(b => [b.key, b.tokens]),
		[
			['system', 6000],
			['tools', 8000],
			['summary', 10000],
			['messages', 40000]
		]
	);
});

test('contextUsage falls back to modelContextWindow option and classifies warning/danger levels', () => {
	const warnState = applyBridgeEvent(createTranscriptState(), {
		type: 'usage_reported',
		runId: 'r1',
		buckets: {input: 140000, output: 1000, total: 141000}
	});
	const warnView = contextUsage(warnState, {modelContextWindow: 200000});
	assert.ok(warnView);
	assert.equal(warnView.usedTokens, 140000);
	assert.equal(warnView.contextWindow, 200000);
	assert.equal(warnView.percent, 70);
	assert.equal(warnView.level, 'warning');

	const dangerState = applyBridgeEvent(createTranscriptState(), {
		type: 'usage_reported',
		runId: 'r1',
		buckets: {input: 180000, output: 1000, total: 181000}
	});
	const dangerView = contextUsage(dangerState, {modelContextWindow: 200000});
	assert.equal(dangerView?.percent, 90);
	assert.equal(dangerView?.level, 'danger');
});

test('contextUsage returns idle window view when no usage_reported yet but modelContextWindow is known', () => {
	const empty = createTranscriptState();
	assert.equal(contextUsage(empty), null);

	const idleView = contextUsage(empty, {modelContextWindow: 128000});
	assert.ok(idleView);
	assert.equal(idleView.usedTokens, 0);
	assert.equal(idleView.contextWindow, 128000);
	assert.equal(idleView.percent, 0);
	assert.equal(idleView.level, 'normal');
});

test('context_pruned with remainingTokens rescales context_used and breakdown immediately', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 't1',
		buckets: {
			input: 100_000,
			output: 4_000,
			total: 104_000,
			context_used: 100_000,
			context_window: 128_000,
			context_budget: 96_000,
			ctx_system: 5_000,
			ctx_tools: 8_000,
			ctx_summary: 2_000,
			ctx_messages: 85_000
		}
	});
	const before = contextUsage(state);
	assert.equal(before?.usedTokens, 100_000);
	assert.equal(before?.percent, 78);

	state = applyBridgeEvent(state, {
		type: 'context_pruned',
		runId: 'r1',
		prunedIds: ['a', 'b'],
		reason: 'summary',
		remainingTokens: 32_000
	});
	const after = contextUsage(state);
	assert.equal(after?.usedTokens, 32_000);
	assert.equal(after?.percent, 25);
	assert.equal(after?.contextWindow, 128_000);
	const breakdownSum = after?.breakdown.reduce((acc, item) => acc + item.tokens, 0) ?? 0;
	assert.ok(
		Math.abs(breakdownSum - 32_000) <= 4,
		`breakdown must rescale to the remaining context, got ${breakdownSum}`
	);

	// Manual /compact runs under a fresh runId (r2) while state.usage still holds r1.
	state = applyBridgeEvent(state, {
		type: 'context_pruned',
		runId: 'r2',
		prunedIds: ['c'],
		reason: 'manual',
		remainingTokens: 16_000
	});
	const afterManual = contextUsage(state);
	assert.equal(afterManual?.usedTokens, 16_000);
	assert.equal(afterManual?.percent, 13);
});

test('starting a new turn in the same session keeps previous context usage until new usage_reported arrives', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c1',
		clientMessageId: 'c1',
		text: 'hello'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'r1',
		clientMessageId: 'c1'
	});
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 'r1',
		buckets: {
			input: 48_000,
			output: 800,
			context_used: 48_000,
			context_window: 128_000
		}
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'r1', success: true});

	// Next user turn starts (turn_started + input_accepted) before LLM responds.
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c2',
		clientMessageId: 'c2',
		text: 'follow up'
	});
	assert.equal(contextUsage(state, {modelContextWindow: 128_000})?.usedTokens, 48_000);

	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'r2',
		clientMessageId: 'c2'
	});
	const whileWaiting = contextUsage(state, {modelContextWindow: 128_000});
	assert.equal(whileWaiting?.usedTokens, 48_000);
	assert.equal(whileWaiting?.percent, 38);

	// New usage_reported overwrites once the second turn's LLM call settles.
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r2',
		turnId: 'r2',
		buckets: {
			input: 56_000,
			output: 900,
			context_used: 56_000,
			context_window: 128_000
		}
	});
	assert.equal(contextUsage(state, {modelContextWindow: 128_000})?.usedTokens, 56_000);
});

test('Method-A prompt cache tracking infers warmed -> hit streak -> rebuilt across turns', () => {
	let state = createTranscriptState();

	// Turn 1: initial cache warm-up
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 't1',
		buckets: {input: 20_000, output: 500, cache_read: 16_000}
	});
	const u1 = contextUsage(state);
	assert.equal(u1?.cacheStatus, 'warmed');
	assert.equal(u1?.cacheHitStreak, 1);
	assert.equal(typeof u1?.cacheStartedAt, 'number');
	assert.equal(typeof u1?.lastCacheHitAt, 'number');

	// Turn 2: prefix grows, cache hit continues
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r2',
		turnId: 't2',
		buckets: {input: 25_000, output: 600, cache_read: 20_000}
	});
	const u2 = contextUsage(state);
	assert.equal(u2?.cacheStatus, 'hit');
	assert.equal(u2?.cacheHitStreak, 2);
	assert.equal(u2?.cacheStartedAt, u1?.cacheStartedAt);

	// Turn 3: cache_read drops sharply (e.g., TTL expired or prefix mutated) -> rebuilt
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r3',
		turnId: 't3',
		buckets: {input: 28_000, output: 400, cache_read: 2_000}
	});
	const u3 = contextUsage(state);
	assert.equal(u3?.cacheStatus, 'rebuilt');
	assert.equal(u3?.cacheHitStreak, 1);
	assert.equal(u3?.prevCacheReadTokens, 20_000);

	// Turn 4: complete cache miss after prior cache -> rebuilt with streak 0
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r4',
		turnId: 't4',
		buckets: {input: 30_000, output: 400, cache_read: 0}
	});
	const u4 = contextUsage(state);
	assert.equal(u4?.cacheStatus, 'rebuilt');
	assert.equal(u4?.cacheHitStreak, 0);
	assert.equal(u4?.prevCacheReadTokens, 2_000);
});


