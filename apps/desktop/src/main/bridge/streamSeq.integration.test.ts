import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {UiSend, WorkspaceFocus} from '@fast-ide/session-view';
import {SessionController} from './SessionController.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';
import {createUiPublisher, type UiPublisher} from './uiPublisher.js';
import type {WorkspaceHub} from './WorkspaceHub.js';
import {
	initialWorkspaceState,
	reduceWorkspace,
	type WorkspaceEvent,
	type WorkspaceState
} from '../../renderer/src/workspaceStore.js';

function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

type Harness = {
	controller: SessionController;
	publisher: UiPublisher;
	taskId: string;
	sessionId: string;
	commands: BridgeCommand[];
	feed: (event: BridgeEvent) => void;
	flush: () => void;
	settle: () => Promise<void>;
	rendererState: () => WorkspaceState;
	sentTailPatches: () => Array<{from: number; total: number; entries: unknown[]}>;
};

function pipeline(sessionId: string): Harness {
	const commands: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			commands.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `cid-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession(sessionId, task.id);
	controller.handleEvent({type: 'Attached', sessionId, clientId: 'cli'});

	const hub = {
		getActive: () => ({
			id: 'p1',
			path: '/tmp/p1',
			status: 'ready',
			error: null,
			cwd: '/tmp/p1',
			displayName: undefined,
			sessions: controller
		}),
		getById: () => null,
		getDefaultProject: () => null,
		listProjects: () => [],
		getEngineStatus: () => ({status: 'ready' as const, error: null})
	} as unknown as WorkspaceHub;

	let state = initialWorkspaceState();
	const tailPatches: Array<{from: number; total: number; entries: unknown[]}> = [];
	const timers: Array<() => void> = [];

	const send: UiSend = (channel, payload) => {
		if (channel === 'transcript:patched') {
			state = reduceWorkspace(state, {type: 'transcript:patched', payload} as WorkspaceEvent);
		} else if (channel === 'transcript:tailPatched') {
			const p = payload as {from: number; total: number; entries: unknown[]};
			tailPatches.push({from: p.from, total: p.total, entries: p.entries});
			state = reduceWorkspace(state, {type: 'transcript:tailPatched', payload} as WorkspaceEvent);
		} else if (channel === 'tasks:changed') {
			state = reduceWorkspace(state, {type: 'tasks:changed', payload} as WorkspaceEvent);
		} else if (channel === 'projects:changed') {
			state = reduceWorkspace(state, {type: 'projects:changed', payload} as WorkspaceEvent);
		} else if (channel === 'project:changed') {
			state = reduceWorkspace(state, {type: 'project:changed', payload} as WorkspaceEvent);
		} else if (channel === 'workspace:focus') {
			state = reduceWorkspace(state, {
				type: 'workspace:focus',
				payload: payload as WorkspaceFocus
			} as WorkspaceEvent);
		}
	};

	const publisher = createUiPublisher({
		hub,
		send,
		setTimeoutFn: ((fn: () => void) => {
			timers.push(fn);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
			const idx = (id as unknown as number) - 1;
			if (idx >= 0 && idx < timers.length) timers[idx] = () => {};
		}) as typeof clearTimeout
	});
	publisher.publishFocusChange();

	return {
		controller,
		publisher,
		taskId: task.id,
		sessionId,
		commands,
		feed(event) {
			const ev = withSid(sessionId, event);
			controller.handleEvent(ev);
			publisher.handleEvent('p1', ev);
		},
		flush() {
			while (timers.length > 0) {
				const fn = timers.shift()!;
				fn();
			}
		},
		settle: () => new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve))),
		rendererState: () => state,
		sentTailPatches: () => tailPatches
	};
}

function assistantText(controller: SessionController, taskId?: string): string {
	const task = taskId
		? controller.listTasks().find(t => t.id === taskId)
		: controller.getActiveTask();
	return task?.transcript.entries.filter(e => e.role === 'assistant').map(e => e.text).join('') ?? '';
}

test('reconnect replay from lastApplied applies only the new seq', async () => {
	const h = pipeline('sess-a');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'a', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'b', eventSeq: 3} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'c', eventSeq: 4} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'd', eventSeq: 5} as BridgeEvent);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 5);
	assert.equal(assistantText(h.controller), 'abcd');
	h.feed({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'c', eventSeq: 4} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'd', eventSeq: 5} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'e', eventSeq: 6} as BridgeEvent);
	assert.equal(assistantText(h.controller), 'abcde');
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 6);
});

test('duplicate replay does not change text or emit extra tails', async () => {
	const h = pipeline('sess-a');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'x', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'y', eventSeq: 3} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'z', eventSeq: 4} as BridgeEvent);
	h.flush();
	await h.settle();
	const beforeTails = h.sentTailPatches().length;
	const before = assistantText(h.controller);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'y', eventSeq: 3} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'z', eventSeq: 4} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.equal(assistantText(h.controller), before);
	assert.equal(h.sentTailPatches().length, beforeTails);
});

test('unfillable hole keeps lastApplied and marks stream incomplete', async () => {
	const h = pipeline('sess-a');
	h.commands.length = 0;
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'keep', eventSeq: 2} as BridgeEvent);
	h.commands.length = 0;
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'skip', eventSeq: 4} as BridgeEvent);
	assert.doesNotMatch(assistantText(h.controller), /skip/);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 2);
	assert.ok(h.commands.some(c => c.type === 'AttachSession' && c.lastEventSeq === 2));
	h.feed({type: 'gap', floor: 5, high: 9, sessionId: 'sess-a'} as BridgeEvent);
	const entry = h.controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.text, 'keep');
	assert.equal(entry?.streamIncomplete, true);
});

test('terminal gap jumps lastApplied to high and does not mark incomplete', async () => {
	const h = pipeline('sess-a');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'keep', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 't1', success: true, eventSeq: 3} as BridgeEvent);
	h.commands.length = 0;
	h.feed({type: 'gap', floor: 9, high: 12, sessionId: 'sess-a'} as BridgeEvent);
	const entry = h.controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.text, 'keep');
	assert.equal(entry?.streamIncomplete, undefined);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 12);
	assert.ok(h.commands.some(c => c.type === 'AttachSession' && c.lastEventSeq === 12));
});

test('gap before any assistant does not jump lastApplied to high', async () => {
	const h = pipeline('sess-a');
	h.commands.length = 0;
	h.feed({type: 'gap', floor: 9, high: 12, sessionId: 'sess-a'} as BridgeEvent);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 0);
	assert.equal(
		h.controller.getActiveTask()?.transcript.entries.some(e => e.role === 'assistant'),
		false
	);
	assert.ok(h.commands.some(c => c.type === 'AttachSession' && c.lastEventSeq === 0));
});

test('terminal gap then session_restored replaces the completed turn', async () => {
	const h = pipeline('sess-a');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'keep', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 't1', success: true, eventSeq: 3} as BridgeEvent);
	h.feed({type: 'gap', floor: 9, high: 12, sessionId: 'sess-a'} as BridgeEvent);
	h.feed({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: [{turnId: 't1', userText: 'hi', assistantText: 'full completed answer'}]
	} as BridgeEvent);
	const entry = h.controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.text, 'full completed answer');
	assert.equal(entry?.status, 'done');
	assert.equal(entry?.streamIncomplete, undefined);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 12);
});

test('two sessions keep isolated cursors', () => {
	const commands: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			commands.push(cmd);
			return true;
		}
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent(withSid('sess-a', {type: 'turn_started', turnId: 'ta', text: 'A', eventSeq: 1} as BridgeEvent));
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 'ta', text: 'AAA', eventSeq: 2} as BridgeEvent));
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 'ta', text: 'A2', eventSeq: 4} as BridgeEvent));
	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	controller.handleEvent(withSid('sess-b', {type: 'turn_started', turnId: 'tb', text: 'B', eventSeq: 1} as BridgeEvent));
	controller.handleEvent(withSid('sess-b', {type: 'assistant_delta', turnId: 'tb', text: 'BBB', eventSeq: 2} as BridgeEvent));
	assert.equal(assistantText(controller, a.id), 'AAA');
	assert.equal(assistantText(controller, b.id), 'BBB');
	assert.equal(controller.listTasks().find(t => t.id === a.id)?.lastEventSeq, 2);
	assert.equal(controller.listTasks().find(t => t.id === b.id)?.lastEventSeq, 2);
});

test('tailPatched renderer body equals authority after a contiguous stream', async () => {
	const h = pipeline('sess-a');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'Hel', eventSeq: 2} as BridgeEvent);
	h.flush();
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'lo', eventSeq: 3} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 't1', success: true, eventSeq: 4} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	const authority = h.controller.getActiveTask()!;
	const renderer = h.rendererState().byTaskId[h.taskId];
	assert.ok(renderer);
	assert.deepEqual(renderer.entries, authority.transcript.entries);
	assert.ok(h.sentTailPatches().length > 0);
});

function reviewController(sessionId: string) {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `cid-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession(sessionId, task.id);
	controller.handleEvent({type: 'Attached', sessionId, clientId: 'cli'});
	const feed = (event: BridgeEvent) => controller.handleEvent(withSid(sessionId, event));
	feed({
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	} as BridgeEvent);
	feed({type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'} as BridgeEvent);
	feed({type: 'assistant_delta', turnId: 'run-9', text: '审查通过', eventSeq: 1} as BridgeEvent);
	feed({type: 'turn_started', turnId: 'run-9-turn-1', clientMessageId: 'client-1'} as BridgeEvent);
	return controller;
}

test('seq hole + CommandLoop turn_finished without eventSeq extinguishes Stop', () => {
	const c = reviewController('sess-settle');
	assert.equal(c.gate().canCancel, true, 'Stop lit while the review is still streaming');
	c.handleEvent(
		withSid('sess-settle', {type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent)
	);
	assert.equal(c.gate().canCancel, false, 'handleEvent must apply CommandLoop settle');
	assert.equal(c.gate().runState, 'idle');
});

test('seq hole + persist run_done still extinguishes Stop', () => {
	const c = reviewController('sess-rundone');
	assert.equal(c.gate().canCancel, true);
	c.handleEvent(
		withSid('sess-rundone', {
			type: 'run_done',
			runId: 'run-9',
			success: true,
			summary: '',
			eventSeq: 3
		} as BridgeEvent)
	);
	assert.equal(c.gate().canCancel, false, 'run_done must not sit behind the missing EventRow');
	assert.equal(c.gate().runState, 'idle');
});

test('DSH sequenced TurnStarted + checkpoint + settle extinguishes renderer Stop', async () => {
	const h = pipeline('sess-dsh-seq');
	h.feed({
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '你是谁'
	} as BridgeEvent);
	h.feed({type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'} as BridgeEvent);
	h.feed({type: 'thinking_started', turn: 1, maxTurns: 50} as BridgeEvent);
	h.feed({type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 'run-9', text: '我是 Fast。', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'checkpoint', unitId: '1:1', content: '我是 Fast。', eventSeq: 3} as BridgeEvent);
	h.feed({
		type: 'run_done',
		runId: 'run-9',
		success: true,
		summary: '',
		eventSeq: 4
	} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.controller.gate().runState, 'idle');
	assert.equal(h.rendererState().gate.canCancel, false, 'composer Stop is bound to renderer gate');
	assert.equal(h.rendererState().gate.runState, 'idle');
	assert.equal(
		h.controller.getActiveTask()?.transcript.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('late empty TurnStarted after DSH settle must not relight renderer Stop', async () => {
	const h = pipeline('sess-dsh-late');
	h.feed({
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '你是谁'
	} as BridgeEvent);
	h.feed({type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 'run-9', text: '我是 Fast。', eventSeq: 2} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(h.controller.gate().canCancel, false);
	h.feed({type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(
		h.controller.getActiveTask()?.transcript.entries.some(e => e.status === 'streaming'),
		false,
		'attach replay of sequenced TurnStarted must not reopen the sealed turn'
	);
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.rendererState().gate.canCancel, false);
	assert.equal(h.rendererState().gate.runState, 'idle');
});

test('cold session_restored then persist TurnStarted must not relight renderer Stop', async () => {
	const h = pipeline('sess-cold-restore');
	h.feed({
		type: 'session_restored',
		sessionId: 'sess-cold-restore',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'review 下这个开发计划',
				assistantText: '## Findings\n总结：计划可落地。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(h.controller.gate().runState, 'idle');
	assert.equal(h.controller.gate().canCancel, false);
	h.feed({type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1} as BridgeEvent);
	h.flush();
	await h.settle();
	h.flush();
	assert.equal(
		h.controller.getActiveTask()?.transcript.entries.some(e => e.status === 'streaming'),
		false
	);
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.controller.gate().runState, 'idle');
	assert.equal(h.rendererState().gate.canCancel, false);
	assert.equal(h.rendererState().gate.runState, 'idle');
});

test('settled restore + persist approval pair of the finished turn must not relight Stop', async () => {
	const h = pipeline('sess-ended-approval');
	h.feed({
		type: 'session_restored',
		sessionId: 'sess-ended-approval',
		turns: [
			{
				turnId: '01a0197b-8976-7f28-98a6-68d7f404d274',
				userText: '设计L0引擎文档',
				assistantText: '文档已写完。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	} as BridgeEvent);
	h.feed({
		type: 'approval_requested',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		tool: 'shell',
		description: 'git diff build.sbt',
		eventSeq: 5454
	} as BridgeEvent);
	h.feed({
		type: 'approval_resolved',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		approved: true,
		eventSeq: 5455
	} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.controller.gate().runState, 'idle');
	assert.equal(h.controller.getActiveTask()?.transcript.activeRunId, undefined);
	assert.equal(h.rendererState().gate.canCancel, false);
	assert.equal(h.rendererState().gate.runState, 'idle');
});

test('settled restore + persist opener of the finished turn must not relight Stop', async () => {
	const h = pipeline('sess-ended');
	h.feed({
		type: 'session_restored',
		sessionId: 'sess-ended',
		turns: [
			{
				turnId: 'restored_0',
				userText: '继续完成啊',
				assistantText: '剩余 3 项 [~] 及原因'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	} as BridgeEvent);
	h.feed({
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		eventSeq: 79
	} as BridgeEvent);
	h.feed({
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		text: '继续完成啊',
		eventSeq: 80
	} as BridgeEvent);
	h.feed({
		type: 'assistant_delta',
		turnId: 'run-9',
		text: '剩余 3 项 [~] 及原因',
		eventSeq: 94
	} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.controller.gate().runState, 'idle');
	assert.equal(h.controller.getActiveTask()?.transcript.activeRunId, undefined);
	assert.equal(
		h.controller.getActiveTask()?.transcript.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('cold restore then a high-seq live turn still paints (session must not stay frozen)', async () => {
	const h = pipeline('sess-sticky');
	h.feed({
		type: 'session_restored',
		sessionId: 'sess-sticky',
		turns: [{turnId: 'old', userText: 'prior', assistantText: 'already on disk'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	} as BridgeEvent);
	h.feed({
		type: 'turn_started',
		turnId: 't-new',
		clientMessageId: 't-new',
		text: '我们不讨论实施，只讨论哪个方案更好'
	} as BridgeEvent);
	h.feed({
		type: 'assistant_delta',
		turnId: 't-new',
		text: '方案 A 更好。',
		eventSeq: 94
	} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 94);
	assert.match(assistantText(h.controller), /方案 A 更好/);
});

test('held late body after empty tool steps paints on turn_finished', async () => {
	const h = pipeline('sess-pr9');
	h.feed({
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review PR9 Wave2'
	} as BridgeEvent);
	h.feed({type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'} as BridgeEvent);
	for (let i = 0; i < 18; i++) {
		h.feed({
			type: 'tool_started',
			id: `tc-${i}`,
			tool: 'read_file',
			args: {path: `/tmp/${i}.md`},
			eventSeq: 100 + i
		} as BridgeEvent);
		h.feed({
			type: 'tool_finished',
			id: `tc-${i}`,
			tool: 'read_file',
			success: true,
			eventSeq: 200 + i
		} as BridgeEvent);
	}
	h.feed({type: 'assistant_delta', turnId: 'run-9', text: '# PR9 + Wave 2', eventSeq: 320} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.match(assistantText(h.controller), /# PR9 \+ Wave 2/);
	assert.equal(h.controller.gate().canCancel, false);
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 320);
});

test('dirty-cursor 定位到了 body paints after settle', async () => {
	const h = pipeline('sess-locate');
	h.feed({
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '问题定位到了吗'
	} as BridgeEvent);
	h.feed({type: 'input_accepted', turnId: 'run-q', clientMessageId: 'client-1'} as BridgeEvent);
	h.feed({type: 'reasoning_delta', turnId: 'run-q', text: 'look', eventSeq: 1987} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 'run-q', text: '定位到了', eventSeq: 2005} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 'run-q', success: true} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.match(assistantText(h.controller), /定位到了/);
	assert.equal(h.controller.gate().canCancel, false);
});

test('an unfilled hole in turn 1 must not drop turn 2 live prose', async () => {
	const h = pipeline('sess-poison');
	h.feed({type: 'turn_started', turnId: 't1', clientMessageId: 't1', text: 'first'} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 1} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't1', text: 'held', eventSeq: 3} as BridgeEvent);
	h.feed({type: 'turn_finished', turnId: 't1', success: true} as BridgeEvent);
	h.feed({type: 'turn_started', turnId: 't2', clientMessageId: 't2', text: 'second'} as BridgeEvent);
	h.feed({type: 'assistant_delta', turnId: 't2', text: 'second live body', eventSeq: 10} as BridgeEvent);
	h.flush();
	await h.settle();
	assert.equal(h.controller.getActiveTask()?.lastEventSeq, 10);
	assert.match(assistantText(h.controller), /second live body/);
});

