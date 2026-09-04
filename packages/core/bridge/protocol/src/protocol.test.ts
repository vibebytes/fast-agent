import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from './protocol.js';

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

test('bridgeEventSchema accepts commands_available badge', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'commands_available',
		commands: [{
			name: 'explain-code',
			description: 'Explain',
			usage: '/explain-code',
			available: true,
			availability: 'ready',
			badge: '个人'
		}]
	});
	assert.equal(parsed.type, 'commands_available');
	if (parsed.type === 'commands_available') {
		assert.equal(parsed.commands[0]?.badge, '个人');
	}
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
		}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(restored.type, 'session_restored');
	assert.equal(restored.turns[0]?.userText, 'hello');
	if (restored.type === 'session_restored') {
		assert.equal(restored.hasMoreOlder, false);
		assert.equal(restored.totalTurnCount, 1);
	}

	const withSteps = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_0',
			userText: 'research',
			assistantText: 'done',
			thinking: 'first then second',
			tools: [
				{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'},
				{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}
			],
			steps: [
				{reasoning: 'first', tools: [{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}], text: 'looking'},
				{reasoning: 'second', tools: [{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}], text: 'done'}
			]
		}]
	});
	assert.equal(withSteps.type, 'session_restored');
	assert.equal(withSteps.turns[0]?.steps?.length, 2);
	assert.equal(withSteps.turns[0]?.steps?.[0]?.reasoning, 'first');
	assert.equal(withSteps.turns[0]?.steps?.[1]?.text, 'done');

	const failedTurn = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 'abc-123',
		turns: [{
			turnId: 'restored_fail',
			userText: 'hi',
			assistantText: 'boom',
			failed: true
		}]
	});
	assert.equal(failedTurn.turns[0]?.failed, true);

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

test('session_restored steps accept optional plan snapshot', () => {
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 's1',
		turns: [{
			turnId: 't0',
			userText: 'plan it',
			assistantText: '',
			steps: [{
				tools: [{id: 'u1', tool: 'upsert_plan', status: 'success', summary: '{"ok":true,"plan_id":"p1"}'}],
				plan: {
					planId: 'p1',
					name: 'Auth',
					overview: 'Login flow',
					todos: [{id: 'a', content: 'routes', status: 'pending'}],
					body: 'Details'
				}
			}]
		}]
	});
	assert.equal(restored.type, 'session_restored');
	if (restored.type === 'session_restored') {
		assert.equal(restored.turns[0]?.steps?.[0]?.plan?.planId, 'p1');
	}
});

test('bridgeEventSchema accepts session_history_page for older Turn prepend', () => {
	const page = bridgeEventSchema.parse({
		type: 'session_history_page',
		sessionId: 'abc-123',
		beforeTurnId: 'restored_20',
		hasMoreOlder: true,
		totalTurnCount: 40,
		turns: [{
			turnId: 'restored_0',
			userText: 'older',
			assistantText: 'reply',
			tools: []
		}]
	});
	assert.equal(page.type, 'session_history_page');
	if (page.type === 'session_history_page') {
		assert.equal(page.beforeTurnId, 'restored_20');
		assert.equal(page.hasMoreOlder, true);
		assert.equal(page.totalTurnCount, 40);
		assert.equal(page.turns[0]?.turnId, 'restored_0');
	}
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
	assert.equal(bridgeEventSchema.parse({type: 'run_exhausted', runId: 'run_1', reason: 'max turns', eventSeq: 3}).type, 'run_exhausted');
	assert.equal(
		bridgeEventSchema.parse({type: 'llm_network_wait', runId: 'run_1', phase: 'retrying', attempt: 1, maxAttempts: 2, eventSeq: 4})
			.type,
		'llm_network_wait'
	);
	assert.equal(bridgeEventSchema.parse({type: 'run_cancelled', runId: 'run_1', reason: 'stop', eventSeq: 5}).type, 'run_cancelled');
	assert.equal(bridgeEventSchema.parse({type: 'turn_cancelled', reason: 'user cancel', eventSeq: 6}).type, 'turn_cancelled');
	assert.equal(bridgeEventSchema.parse({type: 'turn_finished', success: true, eventSeq: 7}).type, 'turn_finished');
	assert.equal(
		bridgeEventSchema.parse({type: 'turn_finished', success: false, reason: 'insufficient_quota', eventSeq: 8}).type,
		'turn_finished'
	);
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

test('subagent_* events parse', () => {
	const started = bridgeEventSchema.parse({
		type: 'subagent_started',
		eventSeq: 1,
		runId: 'r1',
		childSessionId: 'child-1',
		mode: 'one-shot',
		label: 'explore'
	});
	assert.equal(started.type === 'subagent_started' ? started.childSessionId : undefined, 'child-1');
	const updated = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'inactive'
	});
	assert.equal(updated.type === 'subagent_updated' ? updated.activity : undefined, 'inactive');
	assert.equal(updated.type === 'subagent_updated' ? updated.preview : 'missing', undefined);
	const withPreview = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'running',
		preview: 'read_file a',
		unknownField: true
	});
	assert.equal(withPreview.type === 'subagent_updated' ? withPreview.preview : undefined, 'read_file a');
	const emptyPreview = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'running',
		preview: ''
	});
	assert.equal(emptyPreview.type === 'subagent_updated' ? emptyPreview.preview : undefined, '');
	const finished = bridgeEventSchema.parse({
		type: 'subagent_finished',
		eventSeq: 3,
		childSessionId: 'child-1',
		status: 'completed'
	});
	assert.equal(finished.type === 'subagent_finished' ? finished.status : undefined, 'completed');
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 's1',
		turns: []
	});
	assert.equal(restored.type, 'session_restored');
	assert.equal('subagents' in restored, false);
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

test('bridgeEventSchema accepts GetBridgePairing command_result pairing payload', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: 'ok',
		status: 'success',
		pairing: {
			available: true,
			host: '192.168.1.8',
			port: 1979,
			serverUrl: 'wss://192.168.1.8:1979/bridge',
			token: 'tok',
			fingerprint: 'sha256:' + 'ab'.repeat(32),
			pairUri: 'fast-bridge://pair?url=x&token=y&fingerprint=z'
		}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.pairing?.available, true);
		assert.equal(parsed.pairing?.port, 1979);
		assert.equal(parsed.pairing?.reason, undefined);
	}
	const off = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: 'NoWss',
		status: 'success',
		pairing: {available: false, reason: 'no_wss'}
	});
	assert.equal(off.type, 'command_result');
	if (off.type === 'command_result') {
		assert.equal(off.pairing?.available, false);
		assert.equal(off.pairing?.reason, 'no_wss');
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

test('bridgeEventSchema accepts SubmitUserMessage command_result with queued status', () => {
	// Engine queues follow-ups while a turn is already running (CommandLoop).
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SubmitUserMessage',
		message: 'followUpId=019fb96c-ddcc-73f4-b2f0-5d6ea15e8ccf',
		status: 'queued',
		sessionId: '019fb8f8-cd2e-7b28-a49e-0cab91e4e3b2'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'queued');
	}
});

test('bridgeEventSchema accepts SubmitUserMessage command_result with steered status', () => {
	// DSH busy insert (session.prompt mode=steer). Exact payload Fast IDE rejected as Invalid engine event.
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SubmitUserMessage',
		message: '01a00207-efca-731e-be97-c35dd063ba9b:bdc90e91-e72b-4e01-ba66-0cb3d9ccf1e9',
		status: 'steered',
		sessionId: '01a00207-efca-731e-be97-c35dd063ba9b'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'steered');
	}
});

test('bridgeEventSchema accepts workspace_meta with Default Project and empty sessions', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [{
			id: 'default-project',
			projectType: 'general',
			displayName: 'Default Project',
			status: 'active',
			isDefault: true,
			workspace: null
		}],
		sessionsByProjectId: {}
	});
	assert.equal(parsed.type, 'workspace_meta');
	if (parsed.type === 'workspace_meta') {
		assert.equal(parsed.projects[0]?.id, 'default-project');
		assert.equal(parsed.projects[0]?.isDefault, true);
		assert.deepEqual(parsed.sessionsByProjectId, {});
	}
});

test('command_result accepts Meta projectId and pathHash stamps', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'CreateProject',
		message: 'created p1',
		status: 'accepted',
		projectId: 'p1',
		workspaceId: 'meta-ws-1',
		pathHash: 'abcdef'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.projectId, 'p1');
		assert.equal(parsed.workspaceId, 'meta-ws-1');
		assert.equal(parsed.pathHash, 'abcdef');
	}
});

test('bridgeCommandSchema round-trips workspace FS host commands', () => {
	const cases = [
		{type: 'ListWorkspaceDir', requestId: 'r1', workspaceId: 'abcdef123456'},
		{
			type: 'ListWorkspaceDir',
			requestId: 'r2',
			workspaceId: 'abcdef123456',
			relativePath: 'src'
		},
		{
			type: 'GetWorkspaceFile',
			requestId: 'r3',
			workspaceId: 'abcdef123456',
			relativePath: 'README.md'
		},
		{
			type: 'SaveWorkspaceFile',
			requestId: 'r4',
			workspaceId: 'abcdef123456',
			relativePath: 'a.ts',
			content: 'export {}',
			mtime: 1_700_000_000_000,
			bytes: 11
		},
		{type: 'GitWorkspaceStatus', requestId: 'r5', workspaceId: 'abcdef123456'},
		{type: 'ListHostDir', requestId: 'r6'},
		{type: 'ListHostDir', requestId: 'r7', path: '/home/kai'},
		{type: 'CreateHostDir', requestId: 'r8', parent: '/home/kai', name: 'code'}
	] as const;
	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('command_result accepts fs payload and requestId', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetWorkspaceFile',
		message: '12 bytes',
		status: 'success',
		pathHash: 'abcdef123456',
		requestId: 'req-1',
		fs: {relativePath: 'a.ts', content: 'hi', mtime: 1, bytes: 2}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.requestId, 'req-1');
		assert.equal(parsed.fs?.relativePath, 'a.ts');
	}
});

test('DshCall command and command_result keep DSH error.code', () => {
	const cmd = bridgeCommandSchema.parse({
		type: 'DshCall',
		method: 'session.models',
		payload: {sessionId: 's1'},
		sessionId: 's1',
		requestId: 'r1'
	});
	assert.equal(cmd.type, 'DshCall');
	if (cmd.type === 'DshCall') {
		assert.equal(cmd.method, 'session.models');
		assert.equal(cmd.sessionId, 's1');
	}
	const err = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'DshCall',
		message: 'MISSING_CREDENTIAL',
		status: 'error',
		method: 'session.prompt',
		error: {code: 'MISSING_CREDENTIAL', message: 'no key', details: {ref: 'deepseek-official'}}
	});
	assert.equal(err.type, 'command_result');
	if (err.type === 'command_result') {
		assert.equal(err.method, 'session.prompt');
		assert.equal(err.error?.code, 'MISSING_CREDENTIAL');
		assert.equal((err.error as {details?: {ref?: string}} | undefined)?.details?.ref, 'deepseek-official');
	}
});

test('RerunRun command parses and rejects unknown fields', () => {
	const cmd = bridgeCommandSchema.parse({
		type: 'RerunRun',
		sessionId: 's1',
		runId: 'run_01JABC'
	});
	assert.equal(cmd.type, 'RerunRun');
	if (cmd.type === 'RerunRun') {
		assert.equal(cmd.sessionId, 's1');
		assert.equal(cmd.runId, 'run_01JABC');
	}
	assert.throws(() => bridgeCommandSchema.parse({type: 'RerunRun', sessionId: 's1'}));
});

test('run_failed parses with and without structured fault', () => {
	const withFault = bridgeEventSchema.parse({
		type: 'run_failed',
		runId: 'run_01JABC',
		error: 'FaultCarrier: Declined: Connection prematurely closed',
		sessionId: 's1',
		fault: {
			kind: 'availability',
			remedy: 'retry_same',
			retryableAfterMs: 2000,
			attempts: 3,
			acceptedTurns: 2
		}
	});
	if (withFault.type === 'run_failed') {
		assert.equal(withFault.fault?.kind, 'availability');
		assert.equal(withFault.fault?.remedy, 'retry_same');
		assert.equal(withFault.fault?.retryableAfterMs, 2000);
		assert.equal(withFault.fault?.attempts, 3);
		assert.equal(withFault.fault?.acceptedTurns, 2);
	} else {
		assert.fail('expected run_failed');
	}

	const withoutFault = bridgeEventSchema.parse({
		type: 'run_failed',
		runId: 'run_01JABC',
		error: 'plain legacy failure'
	});
	if (withoutFault.type === 'run_failed') {
		assert.equal(withoutFault.error, 'plain legacy failure');
		assert.equal(withoutFault.fault, undefined);
	} else {
		assert.fail('expected run_failed');
	}
});

test('command_result git payload is optional and parses', () => {
	const withGit = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GitWorkspaceStatus',
		message: 'ok',
		status: 'success',
		requestId: 'r1',
		pathHash: 'abcdef123456',
		git: {
			available: true,
			branch: 'main',
			dirty: true,
			files: [{path: 'a.txt', kind: 'modified'}]
		}
	});
	assert.equal(withGit.type, 'command_result');
	if (withGit.type === 'command_result') {
		assert.equal(withGit.git?.available, true);
		assert.equal(withGit.git?.branch, 'main');
		assert.equal(withGit.git?.files?.[0]?.kind, 'modified');
	}
	const without = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'ListWorkspaceDir',
		message: 'ok',
		status: 'success',
		requestId: 'r2'
	});
	assert.equal(without.type, 'command_result');
	if (without.type === 'command_result') {
		assert.equal(without.git, undefined);
	}
});

test('workspace_file_changed event parses', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'workspace_file_changed',
		pathHash: 'abcdef123456',
		relativePath: 'a.ts',
		mtime: 42,
		origin: 'client',
		connectionId: 'conn-1'
	});
	assert.equal(parsed.type, 'workspace_file_changed');
});

test('bridgeCommandSchema round-trips Goal host commands', () => {
	const cases = [
		{type: 'ConfirmGoal', goalId: 'g1'},
		{type: 'ConfirmGoal', goalId: 'g1', patchJson: '{"acceptance":"tests pass"}'},
		{type: 'PatchGoal', goalId: 'g1', patchJson: '{"statement":"new"}'},
		{type: 'SteerGoal', goalId: 'g1', note: 'prefer streaming API'},
		{type: 'GoalStatus', goalId: 'g1', tenantId: 'default'},
		{type: 'PauseGoal', goalId: 'g1'},
		{type: 'ResumeGoal', goalId: 'g1'},
		{type: 'CancelGoal', goalId: 'g1'},
		{type: 'EscalateResume', goalId: 'g1'},
		{type: 'EscalateFail', goalId: 'g1'}
	] as const;

	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('goal_updated event parses across phases', () => {
	const attachHydrate = bridgeEventSchema.parse({
		type: 'goal_updated',
		sessionId: '01a003a0-c660-7728-9177-5b8a255b0959',
		goalId: '01a003a2-3f4d-726d-aa85-523e5b2ff059',
		phase: 'finished',
		status: 'passed',
		name: '算力企业机会与切入点研讨',
		statement: '基于提供的材料组建多角色团队研讨',
		acceptance: '1. 交付一份可正常打开的HTML文件。2. 结论务实精炼。'
	});
	assert.equal(attachHydrate.type, 'goal_updated');
	if (attachHydrate.type === 'goal_updated') {
		assert.equal(attachHydrate.eventSeq, undefined);
		assert.equal(attachHydrate.phase, 'finished');
	}

	const awaiting = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green',
		workflowJson: '{"kind":"pipeline","nodes":[]}',
		membersJson: '[{"name":"dev","role":"executor"}]',
		budgetJson: '{"max_rejects":3}',
		loopAgentId: 'line-1'
	});
	assert.equal(awaiting.type, 'goal_updated');
	if (awaiting.type === 'goal_updated') {
		assert.equal(awaiting.phase, 'awaiting_confirm');
		assert.equal(awaiting.goalId, 'g1');
	}

	const finished = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'finished',
		status: 'passed',
		resultSummary: 'Goal passed'
	});
	assert.equal(finished.type, 'goal_updated');

	const escalated = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'escalated',
		status: 'blocked',
		escalateActions: ['Resume', 'Fail'],
		reason: 'budget exhausted'
	});
	assert.equal(escalated.type, 'goal_updated');

	const paused = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'paused',
		status: 'paused'
	});
	assert.equal(paused.type, 'goal_updated');
	if (paused.type === 'goal_updated') assert.equal(paused.phase, 'paused');

	const withProgress = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepIds: ['writer'],
		progressJson: '{"completed_steps":["researcher"],"reject_count":0}'
	});
	assert.equal(withProgress.type, 'goal_updated');
	if (withProgress.type === 'goal_updated') {
		assert.deepEqual(withProgress.currentStepIds, ['writer']);
		assert.ok(withProgress.progressJson?.includes('researcher'));
	}

	const parallel = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepIds: ['bull', 'bear', 'risk'],
		activeRunIds: ['r1', 'r2', 'r3']
	});
	assert.equal(parallel.type, 'goal_updated');
	if (parallel.type === 'goal_updated') {
		assert.deepEqual(parallel.currentStepIds, ['bull', 'bear', 'risk']);
		assert.deepEqual(parallel.activeRunIds, ['r1', 'r2', 'r3']);
	}

	const legacyCsv = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepId: 'bull,bear,risk'
	});
	assert.equal(legacyCsv.type, 'goal_updated');
	if (legacyCsv.type === 'goal_updated') {
		assert.equal(legacyCsv.currentStepId, 'bull,bear,risk');
	}
});

test('wireIdList dual-reads JSON array, CSV, and empty', () => {
	assert.deepEqual(wireIdList(['bull', 'bear', 'bull']), ['bear', 'bull']);
	assert.deepEqual(wireIdList('bull, bear'), ['bear', 'bull']);
	assert.deepEqual(wireIdList(''), []);
	assert.deepEqual(pickIdList(['a'], 'b,c'), ['a']);
	assert.deepEqual(pickIdList(undefined, 'b,c'), ['b', 'c']);
});

test('command_result carries the Goal snapshot for card refresh (PatchGoal/ConfirmGoal)', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'PatchGoal',
		message: 'patched g1',
		status: 'accepted',
		sessionId: 's1',
		goal: {
			id: 'g1',
			status: 'awaiting_confirm',
			statement: 'ship widget v2',
			acceptance: 'tests green',
			originSessionId: 's1',
			workflowJson: '{"kind":"pipeline","nodes":[]}',
			budgetJson: '{"max_rejects":5}',
			membersJson: '[{"name":"dev","role":"executor","model":"gpt"}]',
			loopAgentId: 'line-1',
			escalateActions: []
		}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.goal?.id, 'g1');
		assert.equal(parsed.goal?.statement, 'ship widget v2');
		assert.equal(parsed.goal?.membersJson, '[{"name":"dev","role":"executor","model":"gpt"}]');
	}
});

test('bridgeCommandSchema round-trips Meta host commands', () => {
	const cases = [
		{type: 'GetWorkspaceMeta'},
		{type: 'GetWorkspaceMeta', tenantId: 'default', appId: 'default-app'},
		{type: 'CreateProject', projectType: 'coding', rootPath: '/tmp/p', displayName: 'P'},
		{type: 'CreateSession', projectId: 'default-project', title: 'Task', startupMode: 'plan', taskId: 'task-1'},
		{type: 'UpdateProjectStatus', projectId: 'p1', status: 'closed'},
		{type: 'SetProjectDisplayName', projectId: 'p1', displayName: 'Renamed'}
	] as const;

	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('CONTRACT: Bridge command accepts sessionId for SkillSlash multi-Attach pin', () => {
	const pinned = parseBridgeCommand({
		type: 'command',
		name: 'explain-code',
		args: 'look',
		sessionId: 'sess-task'
	});
	assert.equal(pinned.type, 'command');
	if (pinned.type === 'command') {
		assert.equal(pinned.sessionId, 'sess-task');
	}
	const bare = parseBridgeCommand({type: 'command', name: 'skills', args: ''});
	assert.equal(bare.type, 'command');
	if (bare.type === 'command') {
		assert.equal(bare.sessionId, undefined);
	}
});

test('command accepts optional generateTitle (aligned with SubmitUserMessage)', () => {
	const omitted = parseBridgeCommand({type: 'command', name: 'explain-code', args: '', sessionId: 's'});
	assert.equal(omitted.type, 'command');
	if (omitted.type === 'command') {
		assert.equal(omitted.generateTitle, undefined);
	}
	const on = parseBridgeCommand({
		type: 'command',
		name: 'explain-code',
		args: 'look',
		sessionId: 's',
		generateTitle: true
	});
	assert.equal(on.type, 'command');
	if (on.type === 'command') {
		assert.equal(on.generateTitle, true);
	}
});

test('bridgeCommandSchema rejects unknown Meta-ish types', () => {
	assert.throws(() => parseBridgeCommand({type: 'GetWorkspaceMetaX'}));
});

test('SubmitUserMessage accepts optional generateTitle (omit / false / true)', () => {
	const base = {
		type: 'SubmitUserMessage' as const,
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'fix auth login'
	};
	const omitted = bridgeCommandSchema.parse(base);
	assert.equal(omitted.type, 'SubmitUserMessage');
	if (omitted.type === 'SubmitUserMessage') {
		assert.equal(omitted.generateTitle, undefined);
	}

	const off = bridgeCommandSchema.parse({...base, generateTitle: false});
	assert.equal(off.type, 'SubmitUserMessage');
	if (off.type === 'SubmitUserMessage') {
		assert.equal(off.generateTitle, false);
	}

	const on = bridgeCommandSchema.parse({...base, generateTitle: true});
	assert.equal(on.type, 'SubmitUserMessage');
	if (on.type === 'SubmitUserMessage') {
		assert.equal(on.generateTitle, true);
	}
});

test('SubmitUserMessage accepts optional mode', () => {
	const base = {
		type: 'SubmitUserMessage' as const,
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'hello'
	};
	const omitted = bridgeCommandSchema.parse(base);
	assert.equal(omitted.type, 'SubmitUserMessage');
	if (omitted.type === 'SubmitUserMessage') {
		assert.equal(omitted.mode, undefined);
	}
	const withMode = bridgeCommandSchema.parse({...base, mode: 'plan'});
	assert.equal(withMode.type, 'SubmitUserMessage');
	if (withMode.type === 'SubmitUserMessage') {
		assert.equal(withMode.mode, 'plan');
	}
});

test('dsh_caps requires all five capability keys', () => {
	const base = {
		type: 'dsh_caps' as const,
		sessionId: 's1',
		queue: true,
		goal: true,
		budget: false,
		question: true,
		slash: true
	};
	assert.equal(bridgeEventSchema.parse(base).type, 'dsh_caps');
	assert.throws(() => bridgeEventSchema.parse({type: 'dsh_caps', sessionId: 's1', queue: true}));
	assert.throws(() => bridgeEventSchema.parse({...base, eventSeq: 1}));
});

test('SubmitUserMessage images are optional; DshSteer and DshQueue decode', () => {
	const submit = bridgeCommandSchema.parse({
		type: 'SubmitUserMessage',
		sessionId: 's1',
		clientMessageId: 'c1',
		text: 'hi'
	});
	assert.equal(submit.type, 'SubmitUserMessage');
	if (submit.type === 'SubmitUserMessage') {
		assert.equal(submit.images, undefined);
	}
	assert.equal(
		bridgeCommandSchema.parse({type: 'DshSteer', sessionId: 's1', text: 'nudge'}).type,
		'DshSteer'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'DshQueue', sessionId: 's1', itemId: 'm1', action: 'remove'}).type,
		'DshQueue'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'Steer', sessionId: 's1', text: 'nudge'}).type,
		'Steer'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'Queue', sessionId: 's1', itemId: 'm1', action: 'remove'}).type,
		'Queue'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'Call', method: 'settings.describe', requestId: 'r1'}).type,
		'Call'
	);
	assert.equal(
		bridgeCommandSchema.parse({type: 'SetEngine', sessionId: 's1', engineId: 'dsh'}).type,
		'SetEngine'
	);
});

test('command_result accepts structured title for SetSessionTitle', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Fix auth login"',
		status: 'success',
		sessionId: 's1',
		title: 'Fix auth login'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.title, 'Fix auth login');
		assert.equal(parsed.sessionId, 's1');
	}
});

test('background process bridge events and KillProc command', () => {
	const completed = bridgeEventSchema.parse({
		type: 'background_task_completed',
		procId: 'p1',
		runId: 'r1',
		exitCode: 0,
		shouldWake: true,
		command: 'sleep 1'
	});
	assert.equal(completed.type, 'background_task_completed');

	const proc = bridgeEventSchema.parse({
		type: 'proc_updated',
		procId: 'p1',
		status: 'running',
		command: 'sleep 1'
	});
	assert.equal(proc.type, 'proc_updated');

	// Engine historically emitted JSON null for absent Option[String].
	const procNullReason = bridgeEventSchema.parse({
		type: 'proc_updated',
		sessionId: 's1',
		turnId: 't1',
		eventSeq: 211,
		procId: 'p1',
		status: 'running',
		runId: 'r1',
		command: 'echo $TMPDIR',
		outFile: '/tmp/p1.log',
		reason: null
	});
	assert.equal(procNullReason.type, 'proc_updated');
	if (procNullReason.type === 'proc_updated') {
		assert.equal(procNullReason.reason ?? null, null);
	}

	const output = bridgeEventSchema.parse({
		type: 'background_task_output',
		procId: 'p1',
		text: 'chunk\n'
	});
	assert.equal(output.type, 'background_task_output');

	const wake = bridgeEventSchema.parse({
		type: 'will_wake',
		procId: 'p1',
		shouldWake: true,
		reason: 'user_stopped'
	});
	assert.equal(wake.type, 'will_wake');

	const suppressed = bridgeEventSchema.parse({
		type: 'background_wake_suppressed',
		procId: 'p1',
		reason: 'wait_consumed'
	});
	assert.equal(suppressed.type, 'background_wake_suppressed');

	const batch = bridgeCommandSchema.parse({
		type: 'AnswerQuestionBatch',
		sessionId: 's1',
		rpcId: 'rpc-1',
		answers: [{id: 'q1', selected: ['Yes']}]
	});
	assert.equal(batch.type, 'AnswerQuestionBatch');
	if (batch.type === 'AnswerQuestionBatch') {
		assert.equal(batch.rpcId, 'rpc-1');
		assert.deepEqual(batch.answers, [{id: 'q1', selected: ['Yes']}]);
	}
	const cancelled = bridgeCommandSchema.parse({
		type: 'AnswerQuestionBatch',
		sessionId: 's1',
		rpcId: 'rpc-1',
		cancelled: true
	});
	assert.equal(cancelled.type, 'AnswerQuestionBatch');
	if (cancelled.type === 'AnswerQuestionBatch') {
		assert.equal(cancelled.cancelled, true);
	}

	const kill = bridgeCommandSchema.parse({
		type: 'KillProc',
		sessionId: 's1',
		procId: 'p1',
		reason: 'user_stopped'
	});
	assert.equal(kill.type, 'KillProc');
	if (kill.type === 'KillProc') {
		assert.equal(kill.procId, 'p1');
		assert.equal(kill.reason, 'user_stopped');
	}
});

test('bridgeCommandSchema accepts Hello / EnsureProject / ClientHeartbeat / Shutdown', () => {
	const hello = bridgeCommandSchema.parse({
		type: 'Hello',
		protocolVersion: 1,
		clientId: 'fast-ink-1',
		clientKind: 'fast-ink',
		cwd: '/tmp/ws',
		authToken: 'tok',
		pid: 42
	});
	assert.equal(hello.type, 'Hello');

	const ensure = bridgeCommandSchema.parse({
		type: 'EnsureProject',
		path: '/tmp/ws',
		projectType: 'coding'
	});
	assert.equal(ensure.type, 'EnsureProject');

	const hb = bridgeCommandSchema.parse({
		type: 'ClientHeartbeat',
		clientId: 'fast-ink-1',
		atMillis: 1
	});
	assert.equal(hb.type, 'ClientHeartbeat');

	const shutdown = bridgeCommandSchema.parse({type: 'Shutdown', force: false});
	assert.equal(shutdown.type, 'Shutdown');

	const status = bridgeCommandSchema.parse({type: 'GetDaemonStatus'});
	assert.equal(status.type, 'GetDaemonStatus');

	const pairing = bridgeCommandSchema.parse({type: 'GetBridgePairing'});
	assert.equal(pairing.type, 'GetBridgePairing');

	const bye = bridgeCommandSchema.parse({type: 'Goodbye', clientId: 'c1', reason: 'client_exit'});
	assert.equal(bye.type, 'Goodbye');
});

test('bridgeEventSchema accepts HelloOk / HelloReject / daemon_shutting_down', () => {
	const ok = bridgeEventSchema.parse({
		type: 'HelloOk',
		protocolVersion: 1,
		engineEpoch: 'e1',
		daemonPid: 9,
		serverTimeMillis: 1,
		engineId: '0.3.1 temurin-17-darwin-arm64 2026-09-02T08:50:00.000Z'
	});
	assert.equal(ok.type, 'HelloOk');
	if (ok.type === 'HelloOk') assert.equal(ok.engineId?.startsWith('0.3.1 '), true);

	const reject = bridgeEventSchema.parse({
		type: 'HelloReject',
		code: 'UNAUTHORIZED',
		message: 'bad token'
	});
	assert.equal(reject.type, 'HelloReject');

	const down = bridgeEventSchema.parse({type: 'daemon_shutting_down'});
	assert.equal(down.type, 'daemon_shutting_down');
});

test('bridgeEventSchema accepts child_work_changed lifecycle rows', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'child_work_changed',
		sessionId: 'sess-1',
		kind: 'goal',
		id: 'goal:g1',
		title: '每日巡检',
		status: 'running'
	});
	assert.equal(parsed.type, 'child_work_changed');
	if (parsed.type === 'child_work_changed') {
		assert.equal(parsed.kind, 'goal');
		assert.equal(parsed.id, 'goal:g1');
	}

	const withParent = bridgeEventSchema.parse({
		type: 'child_work_changed',
		sessionId: 'sess-1',
		kind: 'run',
		id: 'run:r2',
		parentRef: 'run:r1',
		title: 'subagent',
		status: 'succeeded',
		summary: 'done',
		outputPreview: 'tool tail…'
	});
	assert.equal(withParent.type, 'child_work_changed');
	if (withParent.type === 'child_work_changed') {
		assert.equal(withParent.outputPreview, 'tool tail…');
	}
});
