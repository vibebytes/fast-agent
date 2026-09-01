import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema} from './protocol.js';

test('bridgeEventSchema accepts commands_available with capability metadata', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'run',
			description: 'Execute an agent task',
			usage: '/run <agent> <input>',
			available: false,
			availability: 'capability_unavailable',
			capability: 'clusterTaskExecution'
		}]
	});

	assert.equal(parsed.type, 'commands_available');
	assert.equal(parsed.commands[0]?.availability, 'capability_unavailable');
});

test('bridgeEventSchema tolerates legacy commands_available null capability and compact availability', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'model',
			description: 'Show or switch model',
			usage: '/model [name]',
			available: true,
			availability: 'capabilityunavailable',
			capability: null
		}]
	});

	assert.equal(parsed.type, 'commands_available');
	assert.equal(parsed.commands[0]?.availability, 'capability_unavailable');
	assert.equal(parsed.commands[0]?.capability, undefined);
});

test('bridgeEventSchema accepts session_restored and sessions_list', () => {
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_0',
			userText: 'hello',
			assistantText: 'hi',
			thinking: 'plan',
			tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
			tokensUsed: 42
		}]
	});
	assert.equal(restored.type, 'session_restored');
	assert.equal(restored.turns[0]?.userText, 'hello');

	const listed = bridgeEventSchema.parse({
		type: 'sessions_list',
		sessions: [{
			id: 'abc-123',
			title: 'Fix bug',
			summary: 'Worked on auth',
			lastModified: '2026-06-09T08:00:00Z',
			messageCount: 4,
			cwd: '/tmp/project',
			isCurrent: true
		}]
	});
	assert.equal(listed.type, 'sessions_list');
	assert.equal(listed.sessions[0]?.isCurrent, true);
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

test('bridgeEventSchema accepts run lifecycle events', () => {
	assert.equal(bridgeEventSchema.parse({type: 'run_done', runId: 'run_1', success: true, summary: 'done', eventSeq: 1}).type, 'run_done');
	assert.equal(bridgeEventSchema.parse({type: 'run_failed', runId: 'run_1', error: 'boom', eventSeq: 2}).type, 'run_failed');
	assert.equal(bridgeEventSchema.parse({type: 'run_cancelled', runId: 'run_1', reason: 'stop', eventSeq: 3}).type, 'run_cancelled');
});

test('bridgeEventSchema carries runId on approval and question events for routing', () => {
	const approval = bridgeEventSchema.parse({
		type: 'approval_requested', eventSeq: 1, runId: 'run_9', turnId: 'turn_9', id: 'ap_1', tool: 'shell', description: 'rm -rf', context: 'danger'
	});
	assert.equal(approval.type === 'approval_requested' ? approval.runId : undefined, 'run_9');

	const question = bridgeEventSchema.parse({
		type: 'question_requested', eventSeq: 2, runId: 'run_9', turnId: 'turn_9', id: 'q_1', question: 'Where?', options: [{id: 'a', label: 'A'}]
	});
	assert.equal(question.type === 'question_requested' ? question.runId : undefined, 'run_9');
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

// ── command_result route status validation ────────────────────────

test('bridgeEventSchema accepts command_result with all route statuses from SessionEntity', () => {
	const routeStatuses = ['decided', 'answered', 'accepted', 'rejected', 'cancelled', 'paused', 'resumed', 'triggered'] as const;
	for (const status of routeStatuses) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name: 'DecideApproval',
			message: `status=${status}`,
			status
		});
		assert.equal(parsed.type, 'command_result');
		if (parsed.type === 'command_result') {
			assert.equal(parsed.status, status);
		}
	}
});

test('bridgeEventSchema accepts command_result with classic statuses', () => {
	for (const status of ['success', 'unavailable', 'error'] as const) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name: 'model',
			message: 'Current model: default',
			status
		});
		assert.equal(parsed.type, 'command_result');
	}
});

test('bridgeEventSchema accepts command_result without status (optional)', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'help',
		message: '/help — Show help'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, undefined);
	}
});

test('bridgeEventSchema rejects command_result with unknown status', () => {
	assert.throws(() => bridgeEventSchema.parse({
		type: 'command_result',
		name: 'test',
		message: 'test',
		status: 'bogus_status'
	}));
});

test('bridgeEventSchema accepts DecideApproval command_result as emitted by Scala bridge', () => {
	const event = {
		type: 'command_result',
		name: 'DecideApproval',
		message: 'status=Running',
		status: 'decided'
	};
	const parsed = bridgeEventSchema.parse(event);
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.name, 'DecideApproval');
		assert.equal(parsed.status, 'decided');
		assert.equal(parsed.message, 'status=Running');
	}
});

test('bridgeEventSchema accepts AnswerQuestion command_result with answered status', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'AnswerQuestion',
		message: 'status=Completed',
		status: 'answered'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'answered');
	}
});

test('bridgeEventSchema accepts CancelRun/SetMode command_result with their respective statuses', () => {
	const cases = [
		{name: 'CancelRun', status: 'cancelled'},
		{name: 'SetMode', status: 'accepted'},
		{name: 'SetMode', status: 'rejected'},
		{name: 'PauseRun', status: 'paused'},
		{name: 'ResumeRun', status: 'resumed'},
		{name: 'TriggerAgent', status: 'triggered'}
	] as const;

	for (const {name, status} of cases) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name,
			message: `${name} result`,
			status
		});
		assert.equal(parsed.type, 'command_result');
	}
});
