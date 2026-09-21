/** SessionController tests — Follow-up queue. Loaded by SessionController.test.ts. */
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

test('SubmitUserMessage blocked while approval pending; queue blocked too', () => {
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
	const _bind4 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind4.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'approval_requested',
		eventSeq: 1,
		runId: 'run-1',
		id: 'ap1',
		tool: 'shell',
		description: 'x'
	}));
	assert.equal(controller.canSendMessage(), false);
	assert.equal(controller.sendMessage('hi'), false);
	assert.equal(controller.canEnqueue(), false);
});
test('running turn submits Follow-up; queue only from follow_up_changed (E4)', () => {
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
	const _bind5 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind5.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'first'}));
	assert.equal(controller.sendMessage('second'), true);
	assert.equal(controller.getActiveTask()?.queue.length, 0, 'host does not enqueue');
	const submits = sent.filter(c => c.type === 'SubmitUserMessage');
	assert.equal(submits.length, 1);
	if (submits[0]?.type === 'SubmitUserMessage') {
		assert.equal(submits[0].text, 'second');
	}

	controller.handleEvent(
		withSid('sess', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-1', text: 'second', order: 0}])
		})
	);
	assert.equal(controller.getActiveTask()?.queue.length, 1);
	assert.equal(controller.getActiveTask()?.queue[0]?.text, 'second');

	sent.length = 0;
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(
		sent.filter(c => c.type === 'SubmitUserMessage').length,
		0,
		'no host auto-dequeue after E4'
	);
});
test('queue CRUD routes FollowUp* commands; projection is follow_up_changed (E4)', () => {
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
	controller.acceptNewSession('sess-q', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-q', clientId: 'cli'});
	controller.handleEvent(
		withSid('sess-q', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([
				{id: 'fu-1', text: 'placeholder', order: 0},
				{id: 'fu-2', text: 'second', order: 1}
			])
		})
	);
	assert.equal(controller.getActiveTask()?.queue.length, 2);

	sent.length = 0;
	assert.equal(controller.editQueueItem('fu-1', '/explain-code look'), true);
	assert.ok(
		sent.some(
			c => c.type === 'FollowUpUpdate' && c.itemId === 'fu-1' && c.text === '/explain-code look'
		)
	);

	sent.length = 0;
	assert.equal(controller.reorderQueue(1, 0), true);
	assert.ok(sent.some(c => c.type === 'FollowUpReorder' && c.fromIndex === 1 && c.toIndex === 0));

	sent.length = 0;
	assert.equal(controller.setQueuePaused(true), true);
	assert.ok(sent.some(c => c.type === 'FollowUpPause' && c.paused === true));

	sent.length = 0;
	assert.equal(controller.interruptQueueItem('fu-1'), true);
	assert.equal(sent.filter(c => c.type === 'FollowUpRemove').length, 0);
	assert.ok(
		sent.some(
			c =>
				c.type === 'InterruptWithMessage' &&
				c.text === 'placeholder' &&
				c.itemId === 'fu-1'
		)
	);
});

test('interruptQueueItem sends the Composer-selected model like submitUserText', () => {
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
	controller.acceptNewSession('sess-model', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-model', clientId: 'cli'});
	controller.applyProviderCatalog([
		{
			id: 'zhipu/glm-5.3-flash',
			display: 'GLM-5.3-Flash',
			aliases: ['glm-5.3-flash'],
			current: true,
			supportsThinking: false,
			supportedEfforts: []
		}
	]);
	controller.selectModel('zhipu/glm-5.3-flash');
	controller.handleEvent(
		withSid('sess-model', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-1', text: 'rewrite', order: 0}])
		})
	);

	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type !== 'SubmitUserMessage') throw new Error('expected SubmitUserMessage');
	assert.equal(submit.useModel, 'zhipu/glm-5.3-flash');

	sent.length = 0;
	assert.equal(controller.interruptQueueItem('fu-1'), true);
	const interrupt = sent.find(c => c.type === 'InterruptWithMessage');
	assert.ok(interrupt);
	if (interrupt?.type !== 'InterruptWithMessage') throw new Error('expected InterruptWithMessage');
	assert.equal(interrupt.useModel, submit.useModel);
	assert.equal(interrupt.effort, submit.effort);
	assert.equal(interrupt.thinking, submit.thinking);
});

test('interruptQueueItem seals the streaming turn like cancelRun', () => {
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
	controller.acceptNewSession('sess-intr', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-intr', clientId: 'cli'});
	controller.handleEvent(
		withSid('sess-intr', {
			type: 'turn_started',
			eventSeq: 1,
			turnId: 't1',
			clientMessageId: 't1',
			text: 'first'
		})
	);
	controller.handleEvent(
		withSid('sess-intr', {type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 2})
	);
	controller.handleEvent(
		withSid('sess-intr', {
			type: 'input_accepted',
			clientMessageId: 't1',
			turnId: 'run-1'
		})
	);
	controller.handleEvent(
		withSid('sess-intr', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-cut', text: 'cut in', order: 0}])
		})
	);

	sent.length = 0;
	assert.equal(controller.interruptQueueItem('fu-cut'), true);
	assert.ok(sent.some(c => c.type === 'InterruptWithMessage' && c.itemId === 'fu-cut'));
	const transcript = controller.getActiveTask()!.transcript;
	assert.equal(chromeAwaitingSettlement(transcript.chrome), true);
	const assistant = transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'cancelled');
});
test('queued follow-up suppresses the completion cue', () => {
	const {controller} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(
		withSid('sess', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-1', text: 'next', order: 0}])
		})
	);
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(controller.consumeCompletionCue(), null);
});
test('dsh_caps is stored; queue:false does not route QueueMessage; Fast ignores unknown type', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	assert.equal(controller.seedHostSlashCatalog(), true);
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-dsh', clientId: 'cli'});
	assert.doesNotThrow(() =>
		controller.handleEvent({type: 'dsh_budget', sessionId: 'sess-dsh'} as unknown as BridgeEvent)
	);
	controller.handleEvent({
		type: 'dsh_caps',
		sessionId: 'sess-dsh',
		queue: false,
		goal: false,
		budget: false,
		question: true,
		slash: true
	});
	assert.equal(controller.getActiveTask()?.dshCaps?.queue, false);
	controller.handleEvent({type: 'commands_available', commands: []});
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
	controller.handleEvent({
		type: 'dsh_queue',
		sessionId: 'sess-dsh',
		items: [{id: 'm1', placement: 'queued', text: 'later'}]
	});
	assert.equal(controller.removeQueueItem('m1'), false);
	assert.equal(sent.some(c => c.type === 'QueueMessage'), false);
	controller.handleEvent({
		type: 'dsh_caps',
		sessionId: 'sess-dsh',
		queue: true,
		goal: true,
		budget: false,
		question: true,
		slash: true
	});
	assert.equal(controller.removeQueueItem('m1'), true);
	assert.ok(sent.some(c => c.type === 'QueueMessage' && c.action === 'remove'));
	assert.equal(controller.dshSteer('nudge'), true);
	assert.ok(sent.some(c => c.type === 'SteerRun' && c.text === 'nudge'));
	assert.equal(controller.dshGoalAct('pause'), true);
	assert.ok(sent.some(c => c.type === 'EngineCall' && c.method === 'goal.pause'));
	controller.handleEvent({
		type: 'dsh_goal_changed',
		sessionId: 'sess-dsh',
		operation: 'create',
		phase: 'active',
		title: 'Ship',
		text: 'done'
	});
	assert.equal(controller.getActiveTask()?.dshGoal?.title, 'Ship');
	controller.handleEvent({type: 'dsh_queue', sessionId: 'sess-dsh', items: []});
	assert.deepEqual(controller.getActiveTask()?.dshQueue, []);
	sent.length = 0;
	controller.handleEvent(withSid('sess-dsh', {type: 'turn_started', turnId: 't1', text: 'first'}));
	assert.equal(controller.sendMessage('later'), true);
	assert.equal(sent.filter(c => c.type === 'SubmitUserMessage').length, 1);
	assert.equal(
		sent.some(c => c.type.startsWith('FollowUp')),
		false
	);
});
