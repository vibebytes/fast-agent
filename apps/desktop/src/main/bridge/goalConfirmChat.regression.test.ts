import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {createTranscriptState, toTimelineItems} from '@fast-ide/session-view';
import {
	SessionController,
	goalKeepsBusy,
	paintAwaitingConfirm
} from './SessionController.js';

/**
 * Regression lock for Goal pre-start confirm (natural chat, not a card).
 *
 * User-visible contract:
 * 1. After /goal plan tools settle, 方案 +「请确认是否开始执行」is an assistant reply
 *    AFTER Process Stack — never orphan preamble above 「N 步」.
 * 2. awaiting_confirm is history: composer idle (send on, Stop off).
 * 3. Typing「确认」is ordinary chat (SubmitUserMessage), not host ConfirmGoal.
 */
function boot(): {controller: SessionController; sent: BridgeCommand[]} {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-hash-1',
		now: () => 1000,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('Goal confirm regression');
	controller.acceptNewSession('sess-1', task.id);
	controller.handleEvent({
		type: 'Attached',
		sessionId: 'sess-1',
		clientId: 'cli-test',
		replayFromSeq: 0
	} as BridgeEvent);
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [],
		hasMoreOlder: false,
		totalTurnCount: 0
	} as BridgeEvent);
	return {controller, sent};
}

function planTurn() {
	return {
		...createTranscriptState(),
		postRunTerminal: true as const,
		entries: [
			{id: 'u1', role: 'user' as const, text: '/goal 做官网', status: 'done' as const},
			{
				id: 'a-plan',
				role: 'assistant' as const,
				text: '',
				status: 'done' as const,
				tools: [
					{id: 'g-tool', tool: 'goal', args: {}, status: 'success' as const, output: ''}
				],
				segments: [
					{kind: 'thinking' as const, id: 'th', text: '规划'},
					{kind: 'tools' as const, id: 'seg-t', toolIds: ['g-tool']}
				]
			}
		]
	};
}

test('awaiting_confirm: confirm reply is after Process Stack; Stop stays off; 确认 is chat', () => {
	const {controller, sent} = boot();
	const task = controller.getActiveTask()!;
	task.transcript = planTurn();

	controller.handleEvent({
		type: 'goal_updated',
		sessionId: 'sess-1',
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		name: 'FAST官网构建',
		statement: '在 site/ 用 React 搭官网',
		acceptance: '1. 可运行\n2. 能 build',
		membersJson: '[{"name":"前端开发"}]'
	} as BridgeEvent);

	const card = controller.getActiveTask()?.goalCard;
	assert.equal(card?.phase, 'awaiting_confirm');
	assert.equal(goalKeepsBusy(card), false, 'unconfirmed plan must not occupy the session');

	const gate = controller.gate();
	assert.equal(gate.runState, 'idle', 'Stop chrome is runState=running — must stay idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);

	const transcript = controller.getActiveTask()!.transcript;
	const planEntry = transcript.entries.find(e => e.id === 'a-plan');
	assert.equal(planEntry?.text.trim(), '', 'do not dump confirm onto the tool turn (orphan preamble)');

	const items = toTimelineItems(transcript).filter(i => i.kind !== 'user');
	const stackAt = items.findIndex(i => i.kind === 'processStack');
	const confirmAt = items.findIndex(
		i => i.kind === 'assistant' && i.text.includes('请确认是否开始执行')
	);
	assert.ok(stackAt >= 0, 'plan tools collapse to Process Stack');
	assert.ok(confirmAt >= 0, 'confirm ask must be a visible assistant message');
	assert.ok(confirmAt > stackAt, 'confirm must render below 「N 步」, not above it');
	assert.equal(
		JSON.stringify(items[stackAt]).includes('请确认是否开始执行'),
		false,
		'Process Stack must not swallow the confirm ask'
	);
	const reply = items[confirmAt];
	assert.ok(reply && reply.kind === 'assistant');
	assert.match(reply.text, /FAST官网构建|在 site/);
	assert.equal(items.at(-1)?.kind, 'assistant');

	const before = sent.length;
	assert.equal(controller.sendMessage('确认'), true);
	const cmds = sent.slice(before);
	assert.equal(cmds.some(c => c.type === 'ConfirmGoal'), false);
	assert.equal(cmds.some(c => c.type === 'SubmitUserMessage'), true);
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'awaiting_confirm');
});

test('paintAwaitingConfirm is idempotent and keeps confirm off the tool turn', () => {
	const card = {
		goalId: 'g1',
		phase: 'awaiting_confirm' as const,
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green'
	};
	const once = paintAwaitingConfirm(planTurn(), card);
	const twice = paintAwaitingConfirm(once, card);
	assert.equal(twice.entries.length, once.entries.length);
	assert.equal(twice.entries.find(e => e.id === 'a-plan')?.text.trim(), '');
	const confirm = twice.entries.filter(e => e.role === 'assistant' && e.text.includes('请确认'));
	assert.equal(confirm.length, 1);
	assert.notEqual(confirm[0]?.id, 'a-plan');
});
