/** protocol.test — sessionLive. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts message_patched for Session Plan', () => {
	const create = bridgeEventSchema.parse({
		type: 'message_patched',
		eventSeq: 1,
		sessionId: 's1',
		planId: 'plan-1',
		action: 'create',
		name: 'Ship auth',
		overview: 'Add login',
		todos: [{id: 't1', content: 'wire routes', status: 'pending'}],
		body: '## Approach\n…'
	});
	assert.equal(create.type, 'message_patched');
	if (create.type === 'message_patched') {
		assert.equal(create.planId, 'plan-1');
		assert.equal(create.action, 'create');
		assert.equal(create.todos?.[0]?.status, 'pending');
	}

	const byMessageId = bridgeEventSchema.parse({
		type: 'message_patched',
		eventSeq: 2,
		messageId: 'plan-2',
		action: 'update',
		todos: [{id: 't1', content: 'wire routes', status: 'completed'}]
	});
	assert.equal(byMessageId.type, 'message_patched');
	if (byMessageId.type === 'message_patched') {
		assert.equal(byMessageId.messageId, 'plan-2');
	}

	const viaJson = bridgeEventSchema.parse({
		type: 'message_patched',
		eventSeq: 3,
		planId: 'plan-3',
		action: 'replace',
		payloadJson: JSON.stringify({
			name: 'N',
			overview: 'O',
			todos: [],
			body: 'B'
		})
	});
	assert.equal(viaJson.type, 'message_patched');
});

test('bridgeEventSchema rejects malformed events with missing required fields', () => {
	assert.throws(() => bridgeEventSchema.parse({
		type: 'tool_output',
		id: 'tool_1',
		tool: 'shell',
		stream: 'stdout'
	}));

	assert.throws(() => bridgeEventSchema.parse({
		type: 'unknown_event',
		text: 'noop'
	}));
});

test('bridgeEventSchema carries runId on approval and question events for routing', () => {
	const approval = bridgeEventSchema.parse({
		type: 'approval_requested', eventSeq: 1, runId: 'run_9', turnId: 'turn_9', id: 'ap_1', tool: 'shell', description: 'rm -rf', context: 'danger'
	});
	assert.equal(approval.type === 'approval_requested' ? approval.runId : undefined, 'run_9');

	const noted = bridgeEventSchema.parse({
		type: 'approval_requested', eventSeq: 2, runId: 'run_9', turnId: 'turn_9', id: 'ap_2', tool: 'write_file',
		description: 'write', context: '/tmp/a', note: 'outside the session workspace'
	});
	assert.equal(noted.type === 'approval_requested' ? noted.note : undefined, 'outside the session workspace');

	const question = bridgeEventSchema.parse({
		type: 'question_requested', eventSeq: 3, runId: 'run_9', turnId: 'turn_9', id: 'q_1', question: 'Where?', options: [{id: 'a', label: 'A'}]
	});
	assert.equal(question.type === 'question_requested' ? question.runId : undefined, 'run_9');

	const batch = bridgeEventSchema.parse({
		type: 'question_batch_requested',
		eventSeq: 4,
		runId: 'run_9',
		rpcId: 'rpc-1',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	});
	assert.equal(batch.type === 'question_batch_requested' ? batch.rpcId : undefined, 'rpc-1');
	const resolved = bridgeEventSchema.parse({
		type: 'question_batch_resolved', eventSeq: 5, runId: 'run_9', rpcId: 'rpc-1', outcome: 'answered'
	});
	assert.equal(resolved.type === 'question_batch_resolved' ? resolved.outcome : undefined, 'answered');
});

test('bridgeEventSchema accepts large assistant payloads and preserves ordering fields', () => {
	const largeText = '数据'.repeat(12000);
	const turnStarted = bridgeEventSchema.parse({
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'turn-42',
		clientMessageId: 'client-42',
		text: 'hello'
	});
	const assistantDelta = bridgeEventSchema.parse({
		type: 'assistant_delta',
		eventSeq: 2,
		turnId: 'turn-42',
		text: largeText
	});

	assert.equal(turnStarted.type, 'turn_started');
	assert.equal(turnStarted.turnId, 'turn-42');
	assert.equal(assistantDelta.type, 'assistant_delta');
	assert.equal(assistantDelta.text.length, largeText.length);
});

test('turn_started accepts optional supersedes provenance', () => {
	const event = bridgeEventSchema.parse({
		type: 'turn_started',
		turnId: 'new-run',
		text: '',
		supersedes: 'old-run',
		supersedesFailed: true
	});
	assert.equal(event.type, 'turn_started');
	if (event.type === 'turn_started') {
		assert.equal(event.supersedes, 'old-run');
		assert.equal(event.supersedesFailed, true);
	}
});
