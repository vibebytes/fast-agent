/** protocol.test — river. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts AgentAttachProtocol control events with eventSeq', () => {
	const attached = bridgeEventSchema.parse({
		type: 'Attached', sessionId: 'sess-1', clientId: 'cli-1', lastEventSeq: 7, replayFromSeq: 3, eventSeq: 8
	});
	assert.equal(attached.type, 'Attached');
	assert.equal(attached.eventSeq, 8);

	const ack = bridgeEventSchema.parse({type: 'Ack', sessionId: 'sess-1', clientId: 'cli-1', lastEventSeq: 12});
	assert.equal(ack.type === 'Ack' ? ack.lastEventSeq : -1, 12);

	const heartbeat = bridgeEventSchema.parse({type: 'Heartbeat', sessionId: 'sess-1', atMillis: 1_700_000_000_000});
	assert.equal(heartbeat.type, 'Heartbeat');
});

test('incremental river events parse and stay live chrome (no eventSeq)', () => {
	const usage = bridgeEventSchema.parse({
		type: 'usage_reported',
		runId: 'run-1',
		turnId: 't1',
		buckets: {input: 10, output: 20},
		raw: {cacheRead: '5'}
	});
	assert.equal(usage.type === 'usage_reported' ? usage.buckets.output : undefined, 20);
	assert.equal(isLiveChrome({type: 'usage_reported', runId: 'run-1', buckets: {}}), true);

	const child = bridgeEventSchema.parse({
		type: 'child_transcript_delta',
		childSessionId: 'child-1',
		childSeq: 7,
		entryKind: 'assistant',
		payloadJson: '{"text":"hi"}'
	});
	assert.equal(child.type === 'child_transcript_delta' ? child.childSeq : undefined, 7);
	assert.equal(isLiveChrome({type: 'child_transcript_delta', childSessionId: 'c1', childSeq: 1, entryKind: 'assistant', payloadJson: '{}'}), true);

	const pruned = bridgeEventSchema.parse({
		type: 'context_pruned',
		runId: 'run-1',
		prunedIds: ['m1', 'm2'],
		remainingTokens: 4096,
		reason: 'window'
	});
	assert.equal(pruned.type === 'context_pruned' ? pruned.prunedIds.length : undefined, 2);
	assert.equal(isLiveChrome({type: 'context_pruned', runId: 'run-1', prunedIds: [], reason: 'window'}), true);

	const goal = bridgeEventSchema.parse({
		type: 'goal_delta',
		goalId: 'g1',
		operation: 'progress',
		payloadJson: '{"step":"a"}'
	});
	assert.equal(goal.type === 'goal_delta' ? goal.operation : undefined, 'progress');
	assert.equal(isLiveChrome({type: 'goal_delta', goalId: 'g1', operation: 'progress', payloadJson: '{}'}), true);
});

test('persist river events require a safe positive eventSeq', () => {
	assert.equal(bridgeEventSchema.parse({type: 'assistant_delta', text: 'x'}).type, 'assistant_delta');
	assert.throws(() => bridgeEventSchema.parse({type: 'assistant_delta', text: 'x', eventSeq: 0}));
	assert.throws(() => bridgeEventSchema.parse({type: 'assistant_delta', text: 'x', eventSeq: -1}));
	assert.throws(() => bridgeEventSchema.parse({type: 'assistant_delta', text: 'x', eventSeq: 1.5}));
	const ok = bridgeEventSchema.parse({type: 'assistant_delta', text: 'x', eventSeq: 1, unitId: '1:1'});
	assert.equal(ok.type, 'assistant_delta');
	if (ok.type === 'assistant_delta') assert.equal(ok.unitId, '1:1');
});

test('JsonCallbacks live persist types may omit eventSeq', () => {
	assert.equal(bridgeEventSchema.parse({
		type: 'tool_started', id: 't1', tool: 'read_file', args: {path: '/tmp/a.md'}
	}).type, 'tool_started');
	assert.equal(bridgeEventSchema.parse({
		type: 'tool_finished', id: 't1', tool: 'read_file', success: true, fields: {}
	}).type, 'tool_finished');
	assert.equal(bridgeEventSchema.parse({type: 'reasoning_delta', text: 'think'}).type, 'reasoning_delta');
	assert.equal(bridgeEventSchema.parse({
		type: 'subagent_updated', childSessionId: 'c1', activity: 'inactive'
	}).type, 'subagent_updated');
});

test('live UI and host events may omit eventSeq', () => {
	assert.equal(bridgeEventSchema.parse({
		type: 'proc_updated', procId: 'p1', status: 'running'
	}).type, 'proc_updated');
	assert.equal(bridgeEventSchema.parse({
		type: 'task_updated', taskId: 't1', kind: 'proc', status: 'running'
	}).type, 'task_updated');
	assert.equal(bridgeEventSchema.parse({
		type: 'background_task_output', procId: 'p1', text: 'out'
	}).type, 'background_task_output');
	assert.equal(bridgeEventSchema.parse({type: 'ready'}).type, 'ready');
	assert.equal(bridgeEventSchema.parse({
		type: 'gap', floor: 5, sessionId: 's1'
	}).type, 'gap');
	const g = bridgeEventSchema.parse({type: 'gap', floor: 9, high: 12, sessionId: 's1'});
	assert.equal(g.type, 'gap');
	if (g.type === 'gap') assert.equal(g.high, 12);
	assert.equal(bridgeEventSchema.parse({
		type: 'thinking_started', turn: 1, maxTurns: 50
	}).type, 'thinking_started');
});

test('goal chrome may omit eventSeq; ordinary persist turns still require it', () => {
	assert.equal(bridgeEventSchema.parse({
		type: 'turn_started', turnId: 'goal-g1-notice', messageType: 'goal_outcome', text: ''
	}).type, 'turn_started');
	assert.equal(bridgeEventSchema.parse({
		type: 'turn_started', turnId: 'goal-step-r1-conclusion', messageType: 'goal_step_conclusion', text: ''
	}).type, 'turn_started');
	assert.equal(bridgeEventSchema.parse({
		type: 'final_answer', turnId: 'goal-g1-notice', text: 'done'
	}).type, 'final_answer');
	assert.equal(bridgeEventSchema.parse({
		type: 'turn_finished', turnId: 'goal-g1-notice', success: true
	}).type, 'turn_finished');
	assert.equal(bridgeEventSchema.parse({
		type: 'agent_call_finished', agentId: 'exec', success: true, detail: 'goal finished'
	}).type, 'agent_call_finished');
	assert.equal(bridgeEventSchema.parse({
		type: 'turn_started',
		sessionId: '01a008e6-1974-79eb-be97-e984ba271ae4',
		turnId: '6b24d424-c2ec-473e-a3e8-a32dc641af73',
		clientMessageId: '6b24d424-c2ec-473e-a3e8-a32dc641af73',
		text: 'review 下这个设计文档'
	}).type, 'turn_started');
	assert.throws(() => bridgeEventSchema.parse({type: 'final_answer', text: 'hi'}));
	assert.throws(() => bridgeEventSchema.parse({
		type: 'agent_call_finished', agentId: 'exec', success: true
	}));
});

test('CommandLoop settle terminals may omit eventSeq (chat turn, not only goal notice)', () => {
	assert.equal(bridgeEventSchema.parse({type: 'turn_finished', success: true}).type, 'turn_finished');
	assert.equal(
		bridgeEventSchema.parse({type: 'turn_finished', turnId: 'run-9', success: true}).type,
		'turn_finished'
	);
	assert.equal(bridgeEventSchema.parse({type: 'turn_cancelled', reason: 'user cancel'}).type, 'turn_cancelled');
	assert.equal(
		bridgeEventSchema.parse({type: 'run_done', runId: 'run-9', success: true, summary: ''}).type,
		'run_done'
	);
	assert.equal(
		bridgeEventSchema.parse({type: 'run_failed', runId: 'run-9', error: 'busy'}).type,
		'run_failed'
	);
	assert.equal(
		bridgeEventSchema.parse({type: 'run_cancelled', runId: 'run-9', reason: 'user cancel'}).type,
		'run_cancelled'
	);
	assert.equal(
		bridgeEventSchema.parse({type: 'run_exhausted', runId: 'run-9', reason: 'max turns'}).type,
		'run_exhausted'
	);
	assert.equal(isLiveChrome({type: 'turn_finished', success: true}), true);
	assert.equal(isLiveChrome({type: 'run_done', runId: 'run-9', success: true, summary: ''}), true);
	assert.equal(isLiveChrome({type: 'run_failed', runId: 'run-9', error: 'busy'}), true);
	assert.equal(isLiveChrome({type: 'run_cancelled', runId: 'run-9', reason: 'user cancel'}), true);
	assert.equal(isLiveChrome({type: 'run_exhausted', runId: 'run-9', reason: 'max turns'}), true);
	assert.equal(isLiveChrome({type: 'subagent_started', childSessionId: 'c1', mode: 'continuable'}), true);
	assert.equal(isLiveChrome({type: 'subagent_updated', childSessionId: 'c1', activity: 'inactive'}), true);
	assert.equal(isLiveChrome({type: 'subagent_finished', childSessionId: 'c1', status: 'completed'}), true);
});

test('seq_skip requires eventSeq and ignores extra turn/agent fields', () => {
	const skip = bridgeEventSchema.parse({
		type: 'seq_skip',
		eventSeq: 2,
		sessionId: 's1',
		turnId: 't1',
		agentId: 'agent-1',
		depth: 1,
		agentRunId: 'run-child'
	});
	assert.equal(skip.type, 'seq_skip');
	assert.equal(skip.eventSeq, 2);
	assert.throws(() => bridgeEventSchema.parse({type: 'seq_skip'}));
	assert.throws(() => bridgeEventSchema.parse({type: 'seq_skip', eventSeq: 0}));
});

test('gap must not carry eventSeq; checkpoint requires it', () => {
	assert.throws(() => bridgeEventSchema.parse({type: 'gap', floor: 5, eventSeq: 1}));
	assert.throws(() => bridgeEventSchema.parse({type: 'checkpoint', unitId: '1:1', content: 'Hello'}));
	const ck = bridgeEventSchema.parse({type: 'checkpoint', unitId: '1:1', content: 'Hello', usage: 3, eventSeq: 4});
	assert.equal(ck.type, 'checkpoint');
	if (ck.type === 'checkpoint') {
		assert.equal(ck.unitId, '1:1');
		assert.equal(ck.content, 'Hello');
		assert.equal(ck.eventSeq, 4);
	}
});

// ── command_result route status validation ────────────────────────
