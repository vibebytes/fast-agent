import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState} from './index.js';
import {applyGoalPush, goalCardFromPush} from './goalCard.js';
import {CHILD_TRANSCRIPT_MAX, CONTEXT_PRUNE_MAX} from './transcript/delta.js';

test('usage_reported stores buckets and raw for the run', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r1',
		turnId: 't1',
		buckets: {input: 120, output: 40, cached: 80},
		raw: {model: 'gpt-5'}
	});
	assert.equal(state.usage?.runId, 'r1');
	assert.equal(state.usage?.turnId, 't1');
	assert.deepEqual(state.usage?.buckets, {input: 120, output: 40, cached: 80});
	assert.deepEqual(state.usage?.raw, {model: 'gpt-5'});
});

test('usage_reported ignores blank runId and drops non-numeric buckets', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: '  ',
		buckets: {input: 1}
	});
	assert.equal(state.usage, undefined);
	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'r2',
		buckets: {input: 5, bogus: Number.NaN}
	});
	assert.deepEqual(state.usage?.buckets, {input: 5});
});

test('context_pruned appends notices and caps the retained list', () => {
	let state = createTranscriptState();
	for (let i = 0; i < CONTEXT_PRUNE_MAX + 5; i++) {
		state = applyBridgeEvent(state, {
			type: 'context_pruned',
			runId: 'r1',
			prunedIds: [`id-${i}`],
			reason: 'window',
			remainingTokens: 1000 + i
		});
	}
	assert.equal(state.contextPrunes?.length, CONTEXT_PRUNE_MAX);
	const last = state.contextPrunes?.at(-1);
	assert.deepEqual(last?.prunedIds, [`id-${CONTEXT_PRUNE_MAX + 4}`]);
	assert.equal(last?.remainingTokens, 1000 + CONTEXT_PRUNE_MAX + 4);
});

test('context_pruned with empty prunedIds is a no-op', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'context_pruned',
		runId: 'r1',
		prunedIds: [],
		reason: 'window'
	});
	assert.equal(state.contextPrunes, undefined);
});

test('child_transcript_delta accumulates per child and drops stale seq', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
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
	assert.equal(state.childTranscripts?.c1.text, 'hello world');
	assert.equal(state.childTranscripts?.c1.lastSeq, 2);
	// Stale / duplicate seq below the watermark is dropped.
	state = applyBridgeEvent(state, {
		type: 'child_transcript_delta',
		childSessionId: 'c1',
		childSeq: 1,
		entryKind: 'assistant',
		payloadJson: 'STALE'
	});
	assert.equal(state.childTranscripts?.c1.text, 'hello world');
});

test('child_transcript_delta keeps only the trailing window', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_transcript_delta',
		childSessionId: 'c1',
		childSeq: 1,
		entryKind: 'assistant',
		payloadJson: 'x'.repeat(CHILD_TRANSCRIPT_MAX + 500)
	});
	assert.equal(state.childTranscripts?.c1.text.length, CHILD_TRANSCRIPT_MAX);
});

test('goal_delta remove retires the matching chat-flow Goal card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		runId: 'r1',
		goalId: 'g1',
		agentId: 'a1',
		name: '分析师'
	});
	assert.equal(state.goalFlow?.goalId, 'g1');
	state = applyBridgeEvent(state, {
		type: 'goal_delta',
		goalId: 'g1',
		operation: 'remove',
		payloadJson: '{}'
	});
	assert.equal(state.goalFlow, undefined);
});

test('goal_delta for a different goal leaves the card intact', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		runId: 'r1',
		goalId: 'g1',
		agentId: 'a1',
		name: '分析师'
	});
	state = applyBridgeEvent(state, {
		type: 'goal_delta',
		goalId: 'g2',
		operation: 'remove',
		payloadJson: '{}'
	});
	assert.equal(state.goalFlow?.goalId, 'g1');
});

test('goal_delta then goal_updated keeps live members and follows the snapshot terminal phase', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		runId: 'run-impl',
		goalId: 'g1',
		agentId: 'a1',
		name: '分析师'
	});
	state = applyBridgeEvent(state, {
		type: 'goal_delta',
		goalId: 'g1',
		operation: 'step_finished',
		payloadJson: '{"stepId":"impl"}'
	});
	assert.equal(state.goalFlow?.members[0]?.runId, 'run-impl');
	// Snapshot arrives after the increment: live members survive, snapshot drives the phase.
	state = applyGoalPush(
		state,
		goalCardFromPush({goalId: 'g1', phase: 'finished', status: 'passed'}),
		'finished'
	);
	assert.equal(state.goalFlow?.members[0]?.runId, 'run-impl');
	assert.equal(state.goalFlow?.members[0]?.name, '分析师');
});

test('projection delta events never touch the event-river surfaces (invariant 5)', () => {
	const base = createTranscriptState();
	const events = [
		{type: 'usage_reported', runId: 'r1', turnId: 't1', buckets: {input: 1}},
		{type: 'context_pruned', runId: 'r1', prunedIds: ['x'], reason: 'window'},
		{type: 'child_transcript_delta', childSessionId: 'c1', childSeq: 1, entryKind: 'assistant', payloadJson: 'hi'},
		{type: 'goal_delta', goalId: 'g1', operation: 'step_started', payloadJson: '{}'}
	] as const;
	for (const event of events) {
		const next = applyBridgeEvent(base, event as never);
		assert.equal(next.entries, base.entries, `${event.type} must not append transcript entries`);
		assert.equal(next.chrome, base.chrome, `${event.type} must not move run chrome`);
		assert.equal(next.subagents, base.subagents, `${event.type} must not paint subagent cards`);
		assert.equal(next.goalFlow, base.goalFlow, `${event.type} must not seed goalFlow`);
		assert.equal(next.childWork, base.childWork, `${event.type} must not touch child work`);
		assert.equal(next.liveProcs, base.liveProcs, `${event.type} must not touch live procs`);
		assert.equal(next.liveTasks, base.liveTasks, `${event.type} must not touch live tasks`);
	}
});
