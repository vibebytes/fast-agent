import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState} from './index.js';
import {childTranscriptText, contextPruneNotice, usageFooter} from './transcript/usage.js';

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
	assert.equal(contextPruneNotice(createTranscriptState(), CAPS_ON), null);
});

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
