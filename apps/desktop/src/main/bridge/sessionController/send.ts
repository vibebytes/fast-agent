/** SessionController tests — send / composer / transcript. Loaded by SessionController.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	chromeAwaitingSettlement,
	chromeFromServer,
	chromeRunId,
	createTranscriptState,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from '../SessionController.js';
import {assertSkillCommandPinned} from '../skillSlashContract.js';
import {cueController, withSid} from './kit.js';

test('transcript projection appends user turn and streams reasoning/assistant', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'hello'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'think '});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'more'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: ' there'});
	state = applyBridgeEvent(state, {type: 'final_answer', turnId: 't1', text: 'hi there'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});

	assert.equal(state.entries.length, 2);
	assert.equal(state.entries[0]?.role, 'user');
	assert.equal(state.entries[0]?.text, 'hello');
	assert.equal(state.entries[1]?.role, 'assistant');
	assert.equal(state.entries[1]?.reasoning, 'think more');
	assert.equal(state.entries[1]?.text, 'hi there');
	assert.equal(state.entries[1]?.status, 'done');
});

test('real Engine turnId remap: client id then server run id still streams', () => {
	// Captured from fast-agent bridge: turn_started uses clientMessageId; deltas use run id.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'msg-1',
		clientMessageId: 'msg-1',
		text: '只回复一个字：好'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'msg-1',
		clientMessageId: 'msg-1'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: '019f-real-run',
		clientMessageId: 'msg-1'
	});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: '019f-real-run',
		text: '用户要求只回复'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-real-run',
		text: '好'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: '019f-real-run',
		success: true
	});

	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.turnId, '019f-real-run');
	assert.equal(assistant?.reasoning, '用户要求只回复');
	assert.equal(assistant?.text, '好');
	assert.equal(assistant?.status, 'done');
});

test('deltas with remapped turnId still apply if input_accepted was missed', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'msg-1',
		clientMessageId: 'msg-1',
		text: 'hi'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'server-run-id',
		text: 'hello'
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, 'hello');
});
test('createTranscriptState ignores heartbeat/ack for transcript entries', () => {
	let state: TranscriptState = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'Heartbeat', sessionId: 's', atMillis: 1});
	state = applyBridgeEvent(state, {type: 'Ack', sessionId: 's', clientId: 'c', lastEventSeq: 1});
	assert.equal(state.entries.length, 0);
});

test('transcript projection tracks tools approvals and questions', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'run'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'tool1',
		tool: 'shell',
		args: {command: 'ls'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: 't1',
		id: 'tool1',
		tool: 'shell',
		stream: 'stdout',
		text: 'a.txt\n'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'tool1',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		runId: 'run-1',
		turnId: 't1',
		id: 'ap1',
		tool: 'shell',
		description: 'rm -rf /',
		risk: 'high'
	});
	state = applyBridgeEvent(state, {
		type: 'question_requested',
		runId: 'run-1',
		id: 'q1',
		question: 'Which env?',
		options: [{id: 'prod', label: 'Prod'}, {id: 'dev', label: 'Dev'}]
	});

	const tools = state.entries[1]?.tools ?? [];
	assert.equal(tools[0]?.tool, 'shell');
	assert.equal(tools[0]?.output, 'a.txt');
	assert.equal(tools[0]?.status, 'success');
	assert.equal(state.approvals[0]?.id, 'ap1');
	assert.equal(state.questions[0]?.id, 'q1');
	assert.equal(chromeRunId(state.chrome), 'run-1');
});
test('SessionController emits DecideApproval AnswerQuestion CancelAssociated', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'cid'
	});

	const _bind3 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind3.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'x', eventSeq: 1}));
	controller.handleEvent(withSid('sess', {
		type: 'approval_requested',
		eventSeq: 2,
		runId: 'run-9',
		id: 'ap1',
		tool: 'shell',
		description: 'danger'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'question_requested',
		eventSeq: 3,
		runId: 'run-9',
		id: 'q1',
		question: 'pick',
		options: [{id: 'a', label: 'A'}]
	} as BridgeEvent));

	sent.length = 0;
	assert.equal(controller.decideApproval('ap1', true, 'always'), true);
	const decision = sent.find(c => c.type === 'DecideApproval');
	assert.ok(decision && decision.type === 'DecideApproval');
	assert.equal(decision.approvalId, 'ap1');
	assert.equal(decision.runId, 'run-9');
	assert.equal(decision.approved, true);
	assert.equal(decision.reason, 'always');

	sent.length = 0;
	assert.equal(controller.answerQuestionBatch('missing', {cancelled: true}), false);
	controller.handleEvent(withSid('sess', {
		type: 'question_batch_requested',
		eventSeq: 4,
		runId: 'run-9',
		rpcId: 'rpc-1',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	} as BridgeEvent));
	assert.equal(controller.answerQuestionBatch('rpc-1', {answers: [{id: 'q1', selected: ['Yes']}]}), true);
	const batch = sent.find(c => c.type === 'AnswerQuestionBatch');
	assert.ok(batch && batch.type === 'AnswerQuestionBatch');
	assert.equal(batch.rpcId, 'rpc-1');
	assert.deepEqual(batch.answers, [{id: 'q1', selected: ['Yes']}]);

	sent.length = 0;
	assert.equal(controller.answerQuestion('q1', 'a'), true);
	const answer = sent.find(c => c.type === 'AnswerQuestion');
	assert.ok(answer && answer.type === 'AnswerQuestion');
	assert.equal(answer.questionId, 'q1');
	assert.equal(answer.selectedOptionId, 'a');
	assert.equal(answer.customText, undefined);

	sent.length = 0;
	assert.equal(controller.cancelRun('stop'), true);
	const cancel = sent.find(c => c.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(cancel.reason, 'stop');
});
test('send and implicit mode changes reject a stale expected Task', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-affine-${++n}`;
		})()
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	sent.length = 0;

	assert.equal(controller.sendMessage('belongs to A', undefined, a.id), false);
	assert.equal(controller.setRunMode('plan', a.id), false);
	assert.equal(sent.some(c => c.type === 'SubmitUserMessage' || c.type === 'SetMode'), false);
	assert.equal(controller.consumeHelpNotice(), 'errors.send.task_changed');

	controller.selectTask(a.id);
	assert.equal(controller.sendMessage('belongs to A', undefined, a.id), true);
	assert.equal(sent.some(c => c.type === 'SubmitUserMessage'), true);
});
test('SubmitUserMessage passthrough mentions; busy submit keeps chips', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	const chip = {
		kind: 'skill',
		locator: 'plan',
		displayName: 'Plan',
		ref: '@skill/plan'
	};
	assert.equal(controller.sendMessage('use @skill/plan', [chip]), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.deepEqual(submit.mentions, [chip]);
	}

	sent.length = 0;
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'first'}));
	assert.equal(controller.sendMessage('queued @skill/plan', [chip]), true);
	const busySubmit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(busySubmit?.type === 'SubmitUserMessage');
	if (busySubmit?.type === 'SubmitUserMessage') {
		assert.deepEqual(busySubmit.mentions, [chip]);
	}
});

test('requestMentionSuggest sends MentionSuggest for attached session', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'id-1'
	});
	assert.equal(controller.requestMentionSuggest('@sk', 'r1'), false);
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.equal(controller.requestMentionSuggest('@sk', 'r1'), true);
	const cmd = sent.find(c => c.type === 'MentionSuggest');
	assert.ok(cmd?.type === 'MentionSuggest');
	if (cmd?.type === 'MentionSuggest') {
		assert.equal(cmd.sessionId, 'sess');
		assert.equal(cmd.prefix, '@sk');
		assert.equal(cmd.requestId, 'r1');
		assert.equal(cmd.limit, 20);
	}
});
test('input_rejected composer_locked does not paint a second error card', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'run_failed',
		runId: 'run-1',
		error: 'Transport: DNS',
		sessionId: 'sess'
	});
	const errorsBefore =
		controller.getActiveTask()?.transcript.entries.filter(e => e.status === 'error').length ?? 0;
	controller.handleEvent({
		type: 'input_rejected',
		clientMessageId: 'cm-2',
		reason: 'composer_locked: waiting_question_or_approval',
		sessionId: 'sess'
	});
	const errorsAfter =
		controller.getActiveTask()?.transcript.entries.filter(e => e.status === 'error').length ?? 0;
	assert.equal(errorsAfter, errorsBefore, 'composer_locked must not become a 运行失败 card');
	assert.equal(controller.consumeHelpNotice(), 'errors.send.composer_locked');
});
test('homeless live chrome without a turn does not synthesize a ghost', () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-a', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli-test'});
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', text: 'late', eventSeq: 5} as BridgeEvent));
	const got = controller.listTasks()[0]!;
	assert.doesNotMatch(got.transcript.entries.map(e => e.text).join(''), /late/);
	assert.equal(got.lastEventSeq, 0);
});
