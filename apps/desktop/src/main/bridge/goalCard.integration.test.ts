import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {createTranscriptState, toTimelineItems} from '@fast-ide/session-view';
import {SessionController, goalFlowSeed, paintAwaitingConfirm} from './SessionController.js';

/**
 * ②′ Goal card lifecycle in the IDE main process — same semantics as the TUI card:
 * goal_updated drives the card; card actions send Bridge Goal commands; chat text is
 * never intercepted as confirm.
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
	const task = controller.createTask('Goal task');
	// Hub-side bind (CreateSession command_result → acceptNewSession) + Attach ack.
	controller.acceptNewSession('sess-1', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-1', clientId: 'cli-test', replayFromSeq: 0} as BridgeEvent);
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [],
		hasMoreOlder: false,
		totalTurnCount: 0
	} as BridgeEvent);
	return {controller, sent};
}

function goalUpdated(overrides: Record<string, unknown> = {}): BridgeEvent {
	return {
		type: 'goal_updated',
		sessionId: 'sess-1',
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green',
		membersJson: '[{"name":"dev","role":"executor"},{"name":"qa","role":"verifier"}]',
		...overrides
	} as BridgeEvent;
}

test('goal_updated awaiting_confirm opens the confirm card on the owning task', () => {
	const {controller} = boot();
	controller.handleEvent(goalUpdated());
	const card = controller.getActiveTask()?.goalCard;
	assert.equal(card?.phase, 'awaiting_confirm');
	assert.equal(card?.goalId, 'g1');
	assert.equal(card?.statement, 'ship widget');
});

test('paintAwaitingConfirm fills empty settled chat with plan + 请确认', () => {
	const settled = {
		...createTranscriptState(),
		postRunTerminal: true,
		entries: [{id: 'a1', role: 'assistant' as const, text: '', status: 'done' as const}]
	};
	const next = paintAwaitingConfirm(settled, {
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green',
		membersJson: '[{"name":"分析师"}]'
	});
	assert.match(next.entries[0]!.text, /ship widget/);
	assert.match(next.entries[0]!.text, /tests green/);
	assert.match(next.entries[0]!.text, /分析师/);
	assert.match(next.entries[0]!.text, /请确认是否开始执行/);
});

test('paintAwaitingConfirm does not overwrite model confirmation prose', () => {
	const hasText = {
		...createTranscriptState(),
		postRunTerminal: true,
		entries: [
			{id: 'a1', role: 'assistant' as const, text: '方案已写好，请确认。', status: 'done' as const}
		]
	};
	const next = paintAwaitingConfirm(hasText, {
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship'
	});
	assert.equal(next.entries[0]!.text, '方案已写好，请确认。');
});

test('paintAwaitingConfirm appends a reply after the tool turn — not orphan preamble', () => {
	const card = {
		goalId: 'g1',
		phase: 'awaiting_confirm' as const,
		status: 'awaiting_confirm',
		name: 'FAST官网构建',
		statement: '在 site/ 用 React 搭官网',
		acceptance: '1. 可运行\n2. 能 build',
		membersJson: '[{"name":"前端开发"}]'
	};
	const dumped = {
		...createTranscriptState(),
		postRunTerminal: true,
		entries: [
			{
				id: 'u1',
				role: 'user' as const,
				text: '/goal 做官网',
				status: 'done' as const
			},
			{
				id: 'a1',
				role: 'assistant' as const,
				text: '目标：FAST官网构建\n请确认是否开始执行（回复「开始」或「确认」即可）。',
				status: 'done' as const,
				tools: [
					{
						id: 'g-tool',
						tool: 'goal',
						args: {},
						status: 'success' as const,
						output: ''
					}
				],
				segments: [
					{kind: 'thinking' as const, id: 'th', text: '规划'},
					{kind: 'tools' as const, id: 'seg-t', toolIds: ['g-tool']}
				]
			}
		]
	};
	const next = paintAwaitingConfirm(dumped, card);
	assert.equal(next.entries[1]!.text, '');
	const reply = next.entries[2]!;
	assert.equal(reply.id, 'assistant-awaiting-g1');
	assert.match(reply.text, /请确认是否开始执行/);
	assert.match(reply.text, /FAST官网构建/);
	const kinds = toTimelineItems(next)
		.filter(i => i.kind !== 'user')
		.map(i => i.kind);
	assert.deepEqual(kinds, ['processStack', 'assistant']);
	const confirm = toTimelineItems(next).find(i => i.kind === 'assistant');
	assert.ok(confirm && confirm.kind === 'assistant');
	assert.match(confirm.text, /请确认是否开始执行/);
	const again = paintAwaitingConfirm(next, card);
	assert.equal(again.entries.length, next.entries.length);
});

test('paintAwaitingConfirm leaves a tool-turn assistant segment as the confirm reply', () => {
	const settled = {
		...createTranscriptState(),
		postRunTerminal: true,
		entries: [
			{id: 'u1', role: 'user' as const, text: '/goal', status: 'done' as const},
			{
				id: 'a1',
				role: 'assistant' as const,
				text: '方案如下，请确认是否开始执行。',
				status: 'done' as const,
				tools: [{id: 'g1', tool: 'goal', args: {}, status: 'success' as const, output: ''}],
				segments: [
					{kind: 'tools' as const, id: 'seg-t', toolIds: ['g1']},
					{
						kind: 'assistant' as const,
						id: 'seg-a',
						text: '方案如下，请确认是否开始执行。'
					}
				]
			}
		]
	};
	const next = paintAwaitingConfirm(settled, {
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship'
	});
	assert.equal(next.entries.length, 2);
	assert.equal(next.entries[1]!.text, '方案如下，请确认是否开始执行。');
});

test('paintAwaitingConfirm keeps tool-turn preamble and still appends confirm', () => {
	const settled = {
		...createTranscriptState(),
		postRunTerminal: true,
		entries: [
			{id: 'u1', role: 'user' as const, text: '/goal', status: 'done' as const},
			{
				id: 'a1',
				role: 'assistant' as const,
				text: '我先读 skill',
				status: 'done' as const,
				tools: [
					{id: 's1', tool: 'skill_view', args: {}, status: 'success' as const, output: ''}
				],
				segments: [{kind: 'tools' as const, id: 'seg-t', toolIds: ['s1']}]
			}
		]
	};
	const next = paintAwaitingConfirm(settled, {
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget'
	});
	assert.equal(next.entries[1]!.text, '我先读 skill');
	assert.match(next.entries[2]!.text, /请确认是否开始执行/);
});

test('goal_updated awaiting_confirm after chat settle paints confirm prose; gate stays idle', () => {
	const {controller} = boot();
	const task = controller.getActiveTask()!;
	task.transcript = {
		...task.transcript,
		postRunTerminal: true,
		entries: [{id: 'a1', role: 'assistant', text: '', status: 'done'}]
	};
	controller.handleEvent(goalUpdated());
	const text =
		controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant')?.text ?? '';
	assert.match(text, /ship widget/);
	assert.match(text, /请确认是否开始执行/);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.gate().canCancel, false);
	assert.equal(controller.gate().canSubmitNow, true);
});

test('goal_updated awaiting_confirm after a tool turn appends confirm below Process Stack', () => {
	const {controller} = boot();
	const task = controller.getActiveTask()!;
	task.transcript = {
		...task.transcript,
		postRunTerminal: true,
		entries: [
			{id: 'u1', role: 'user', text: '/goal ship', status: 'done'},
			{
				id: 'a1',
				role: 'assistant',
				text: '',
				status: 'done',
				tools: [{id: 'g-tool', tool: 'goal', args: {}, status: 'success', output: ''}],
				segments: [
					{kind: 'thinking', id: 'th', text: '规划'},
					{kind: 'tools', id: 'seg-t', toolIds: ['g-tool']}
				]
			}
		]
	};
	controller.handleEvent(goalUpdated());
	const entries = controller.getActiveTask()?.transcript.entries ?? [];
	assert.equal(entries[1]?.text, '');
	const reply = entries.find(e => e.id === 'assistant-awaiting-g1');
	assert.ok(reply);
	assert.match(reply.text, /请确认是否开始执行/);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.gate().canSubmitNow, true);
	const kinds = toTimelineItems(controller.getActiveTask()!.transcript)
		.filter(i => i.kind !== 'user')
		.map(i => i.kind);
	assert.ok(kinds.includes('assistant'));
	assert.equal(kinds.at(-1), 'assistant');
	const confirm = toTimelineItems(controller.getActiveTask()!.transcript)
		.filter(i => i.kind === 'assistant')
		.at(-1);
	assert.ok(confirm && confirm.kind === 'assistant');
	assert.match(confirm.text, /请确认是否开始执行/);
});

test('confirmGoal sends ConfirmGoal with optional patchJson (one gesture: patch→freeze→start)', () => {
	const {controller, sent} = boot();
	controller.handleEvent(goalUpdated());
	assert.equal(controller.confirmGoal('{"acceptance":"stricter"}'), true);
	const cmd = sent.find(c => c.type === 'ConfirmGoal');
	assert.ok(cmd && cmd.type === 'ConfirmGoal');
	if (cmd.type === 'ConfirmGoal') {
		assert.equal(cmd.goalId, 'g1');
		assert.equal(cmd.patchJson, '{"acceptance":"stricter"}');
	}
});

test('accepted ConfirmGoal result keeps the card as started and paints the outcome', () => {
	const {controller} = boot();
	controller.handleEvent(goalUpdated());
	controller.handleEvent({
		type: 'command_result',
		name: 'ConfirmGoal',
		message: 'confirmed+started g1',
		status: 'accepted',
		sessionId: 'sess-1',
		goal: {
			id: 'g1',
			status: 'running',
			statement: 'ship widget',
			acceptance: 'tests green'
		}
	} as BridgeEvent);
	const task = controller.getActiveTask();
	assert.equal(task?.goalCard?.phase, 'started');
	assert.equal(task?.goalCard?.status, 'running');
	assert.equal(task?.goalCard?.goalId, 'g1');
	assert.ok(task?.transcript.entries.some(e => e.text?.includes('confirmed+started')));
	assert.equal(task?.transcript.postRunTerminal, false, 'Goal track must lift Chat straggler guard');
	// Busy A′: Goal owns chrome; composer stays open for steer (not CancelRun).
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.gate().canSubmitNow, true);
	assert.equal(controller.gate().canCancel, false);
});

test('Goal running: main composer sendMessage routes to SubmitUserMessage (Follow-up; not SteerGoal)', () => {
	const {controller, sent} = boot();
	controller.handleEvent(goalUpdated({phase: 'started', status: 'running'}));
	sent.length = 0;
	assert.equal(controller.sendMessage('注意用流式接口'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit && submit.type === 'SubmitUserMessage');
	assert.equal(sent.some(c => c.type === 'SteerGoal'), false);
});

test('after ConfirmGoal, Goal step turn_started + tool events paint into the transcript', () => {
	const {controller} = boot();
	controller.handleEvent(goalUpdated());
	// Simulate prior Chat turn settle (SkillSlash / plan) arming the straggler guard.
	const task0 = controller.getActiveTask()!;
	task0.transcript = {...task0.transcript, postRunTerminal: true};
	controller.handleEvent({
		type: 'command_result',
		name: 'ConfirmGoal',
		message: 'confirmed+started g1',
		status: 'accepted',
		sessionId: 'sess-1',
		goal: {id: 'g1', status: 'running', statement: 'ship widget'}
	} as BridgeEvent);
	controller.handleEvent({
		type: 'turn_started',
		turnId: 'run-step-1',
		clientMessageId: 'run-step-1',
		text: '',
		sessionId: 'sess-1'
	} as BridgeEvent);
	controller.handleEvent({
		type: 'assistant_delta',
		turnId: 'run-step-1',
		text: 'drafting…',
		sessionId: 'sess-1'
	} as BridgeEvent);
	controller.handleEvent({
		type: 'tool_started',
		turnId: 'run-step-1',
		id: 'tc-w',
		tool: 'write_file',
		args: {path: '/tmp/jd.md'},
		sessionId: 'sess-1'
	} as BridgeEvent);
	const task = controller.getActiveTask();
	const assistant = task?.transcript.entries.find(
		e => e.role === 'assistant' && e.turnId === 'run-step-1'
	);
	assert.ok(assistant, 'Goal step must open an assistant row');
	assert.equal(assistant?.status, 'streaming');
	assert.ok(assistant?.text?.includes('drafting'));
	assert.ok(assistant?.tools?.some(t => t.tool === 'write_file'));
});

test('card follows started → escalated → finished pushes; escalate actions send Bridge commands', () => {
	const {controller, sent} = boot();
	controller.handleEvent(goalUpdated({phase: 'started', status: 'running'}));
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'started');

	assert.equal(controller.steerGoal('注意用流式接口'), true);
	const steer = sent.find(c => c.type === 'SteerGoal');
	assert.ok(steer && steer.type === 'SteerGoal' && steer.note === '注意用流式接口');

	controller.handleEvent(
		goalUpdated({phase: 'escalated', status: 'blocked', escalateActions: ['Resume', 'Fail'], reason: 'budget'})
	);
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'escalated');
	assert.equal(controller.escalateGoal('resume'), true);
	assert.ok(sent.some(c => c.type === 'EscalateResume'));

	controller.handleEvent(goalUpdated({phase: 'finished', status: 'passed', resultSummary: 'Goal passed'}));
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'finished');
	assert.equal(controller.dismissGoalCard(), true);
	assert.equal(controller.getActiveTask()?.goalCard, undefined);
});

test('accepted PatchGoal result refreshes the confirm card draft (review fix: stale card)', () => {
	const {controller} = boot();
	controller.handleEvent(goalUpdated());
	controller.handleEvent({
		type: 'command_result',
		name: 'PatchGoal',
		message: 'patched g1',
		status: 'accepted',
		sessionId: 'sess-1',
		goal: {
			id: 'g1',
			status: 'awaiting_confirm',
			statement: 'ship widget v2',
			acceptance: 'stricter',
			membersJson: '[{"name":"dev","role":"executor","model":"gpt"}]',
			budgetJson: '{"max_rejects":5}'
		}
	} as BridgeEvent);
	const card = controller.getActiveTask()?.goalCard;
	assert.equal(card?.phase, 'awaiting_confirm');
	assert.equal(card?.statement, 'ship widget v2');
	assert.equal(card?.acceptance, 'stricter');
	assert.ok(card?.membersJson?.includes('"model":"gpt"'));
});

test('paused push shows the paused banner; resumeGoal sends ResumeGoal only when paused', () => {
	const {controller, sent} = boot();
	controller.handleEvent(goalUpdated({phase: 'started', status: 'running'}));
	// Not paused yet — resume is a no-op.
	assert.equal(controller.resumeGoal(), false);

	controller.handleEvent(goalUpdated({phase: 'paused', status: 'paused'}));
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'paused');
	assert.equal(controller.resumeGoal(), true);
	const resume = sent.find(c => c.type === 'ResumeGoal');
	assert.ok(resume && resume.type === 'ResumeGoal' && resume.goalId === 'g1');
});

test('chat「确认」is ordinary SubmitUserMessage — never a host ConfirmGoal (card gate)', () => {
	const {controller, sent} = boot();
	controller.handleEvent(goalUpdated());
	const before = sent.length;
	assert.equal(controller.sendMessage('确认'), true);
	const newCmds = sent.slice(before);
	assert.equal(newCmds.some(c => c.type === 'ConfirmGoal'), false);
	assert.equal(newCmds.some(c => c.type === 'SubmitUserMessage'), true);
	// Card still pinned — gate untouched by chat.
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'awaiting_confirm');
});

test('CancelGoal failure (goal already terminal) clears the card so the Stop affordance disappears', () => {
	const {controller} = boot();
	// Goal was running; a late GoalUpdated(finished) never arrived, so the card is stuck on 'started'.
	controller.handleEvent(goalUpdated({phase: 'started', status: 'running'}));
	assert.equal(controller.getActiveTask()?.goalCard?.phase, 'started');
	// Busy A′: composer paints running chrome with a Goal Stop button.
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.gate().canCancel, false);

	// User clicks Stop → CancelGoal → backend rejects (goal already cancelled).
	controller.handleEvent({
		type: 'command_result',
		name: 'CancelGoal',
		message: 'cannot cancelled from status=cancelled',
		status: 'error',
		sessionId: 'sess-1'
	} as BridgeEvent);

	// Card cleared → goalKeepsBusy false → composer returns to idle (no Stop button).
	assert.equal(controller.getActiveTask()?.goalCard, undefined);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.gate().canCancel, false);
});

test('goalFlowSeed treats currentStepIds as parallel running members', () => {
	const seeded = goalFlowSeed({
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		workflowJson: JSON.stringify({
			kind: 'dag',
			nodes: [
				{id: 'bull', use: '多方辩手'},
				{id: 'bear', use: '空方辩手'},
				{id: 'risk', use: '风控辩手'},
				{id: 'verify', use: '质检', depends_on: ['bull', 'bear', 'risk']}
			]
		}),
		currentStepIds: ['bull', 'bear', 'risk']
	});
	assert.deepEqual(
		seeded.members.map(m => [m.name, m.status]),
		[
			['多方辩手', 'running'],
			['空方辩手', 'running'],
			['风控辩手', 'running']
		]
	);
});

test('goalFlowSeed: completed_steps + remaining currentStepIds', () => {
	const seeded = goalFlowSeed({
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		workflowJson: JSON.stringify({
			kind: 'dag',
			nodes: [
				{id: 'bull', use: '多方辩手'},
				{id: 'bear', use: '空方辩手'},
				{id: 'risk', use: '风控辩手'},
				{id: 'verify', use: '质检', depends_on: ['bull', 'bear', 'risk']}
			]
		}),
		currentStepIds: ['bear', 'risk'],
		progressJson: JSON.stringify({completed_steps: ['bull']})
	});
	assert.deepEqual(
		seeded.members.map(m => [m.name, m.status]),
		[
			['多方辩手', 'success'],
			['空方辩手', 'running'],
			['风控辩手', 'running']
		]
	);
});

test('goal_updated dual-reads legacy CSV currentStepId into currentStepIds', () => {
	const {controller} = boot();
	controller.handleEvent(
		goalUpdated({
			phase: 'started',
			status: 'running',
			currentStepId: 'bull,bear,risk'
		})
	);
	assert.deepEqual(controller.getActiveTask()?.goalCard?.currentStepIds, [
		'bear',
		'bull',
		'risk'
	]);
});

test('goal_updated finished after a live Goal offers a completion cue', () => {
	const {controller} = boot();
	const taskId = controller.getActiveTask()!.id;
	controller.handleEvent(goalUpdated({phase: 'started', status: 'running'}));
	assert.equal(controller.consumeCompletionCue(), null);
	controller.handleEvent(goalUpdated({phase: 'finished', status: 'passed'}));
	assert.deepEqual(controller.consumeCompletionCue(), {taskId, success: true});
});

test('goal_updated finished on hydrate (never busy here) does not cue', () => {
	const {controller} = boot();
	controller.handleEvent(goalUpdated({phase: 'finished', status: 'passed'}));
	assert.equal(controller.consumeCompletionCue(), null);
});
