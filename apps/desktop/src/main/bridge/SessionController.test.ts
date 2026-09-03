import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	createTranscriptState,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from './SessionController.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';
import {assertSkillCommandPinned} from './skillSlashContract.js';

/** Stamp sessionId on session-stream events for post-demux unit tests. */
function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

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

test('SessionController new task sends CreateSession with path-hash then Attach', () => {
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

	const task = controller.createTask('First task');
	assert.equal(task.title, 'First task');
	assert.equal(task.sessionId, null);
	assert.equal(sent[0]?.type, 'CreateSession');
	if (sent[0]?.type === 'CreateSession') {
		assert.equal(sent[0].projectId, 'proj-1');
		assert.equal(sent[0].title, 'First task');
		assert.equal(sent[0].taskId, task.id);
		// Hosted path-hash → Engine bindHash (skips GetWorkspaceMeta); not Meta UUID.
		assert.equal(sent[0].workspaceId, 'ws-hash-1');
	}
	assert.equal(controller.canSendMessage(), false);

	// Hub passes engineBoundHash from command_result — skip redundant Bind.
	controller.acceptNewSession('engine-sess-1', task.id, 'ws-hash-1');
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'Engine already bound — Attach only'
	);
	const attach = sent.find(c => c.type === 'AttachSession');
	assert.ok(attach);
	if (attach?.type === 'AttachSession') {
		assert.equal(attach.sessionId, 'engine-sess-1');
		assert.equal(attach.lastEventSeq, 0);
		assert.equal(attach.limit, 20);
	}
	assert.equal(controller.getActiveTask()?.sessionId, 'engine-sess-1');
	assert.equal(controller.canSendMessage(), true);

	sent.length = 0;
	assert.equal(controller.renameTask(task.id, 'Renamed'), true);
	const titleCmd = sent.find(c => c.type === 'SetSessionTitle');
	assert.ok(titleCmd);
	if (titleCmd.type === 'SetSessionTitle') {
		assert.equal(titleCmd.sessionId, 'engine-sess-1');
		assert.equal(titleCmd.title, 'Renamed');
	}
	assert.equal(controller.getActiveTask()?.title, 'Renamed');

	controller.handleEvent({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Renamed"',
		status: 'success',
		sessionId: 'engine-sess-1'
	});
	assert.equal(controller.getActiveTask()?.title, 'Renamed');

	sent.length = 0;
	const ok = controller.sendMessage('build it');
	assert.equal(ok, true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.sessionId, 'engine-sess-1');
		assert.equal(submit.text, 'build it');
		assert.equal(submit.useModel, undefined);
	}
});

test('SessionController rerunRun sends RerunRun pinned to the active session', () => {
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

	assert.equal(controller.rerunRun('run-1'), false);

	const task = controller.createTask('Retry task');
	controller.acceptNewSession('engine-sess-1', task.id, 'ws-hash-1');
	sent.length = 0;

	assert.equal(controller.rerunRun('run-1'), true);
	const rerun = sent.find(c => c.type === 'RerunRun');
	assert.ok(rerun);
	if (rerun?.type === 'RerunRun') {
		assert.equal(rerun.sessionId, 'engine-sess-1');
		assert.equal(rerun.runId, 'run-1');
	}
});

test('SessionController acks eventSeq and heartbeats all attached Sessions', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 42,
		createId: () => 'fixed-id'
	});

	const ackTask = controller.createTask('T');
	controller.acceptNewSession('sess-a', ackTask.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli-test'});
	sent.length = 0;

	controller.handleEvent(withSid('sess-a', {
		type: 'assistant_delta',
		turnId: 't1',
		text: 'x',
		eventSeq: 1
	} as BridgeEvent));

	assert.equal(sent[0]?.type, 'Ack');
	if (sent[0]?.type === 'Ack') {
		assert.equal(sent[0].lastEventSeq, 1);
		assert.equal(sent[0].sessionId, 'sess-a');
	}

	sent.length = 0;
	controller.tickHeartbeat();
	const heartbeat = sent.find(cmd => cmd.type === 'Heartbeat');
	assert.ok(heartbeat);
	assert.equal(heartbeat.sessionId, 'sess-a');
	assert.equal(heartbeat.atMillis, 42);
});

test('selectTask re-Attaches when transcript empty and session_restored never arrived', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Old');
	controller.acceptNewSession('sess-miss', task.id);
	assert.ok(controller.isAttached('sess-miss'));
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	sent.length = 0;
	controller.selectTask(task.id);
	assert.ok(
		sent.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-miss'),
		'must re-Attach to recover missing history'
	);
});

test('selectTask does not re-Attach after empty session_restored', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Empty hist');
	controller.acceptNewSession('sess-empty', task.id);
	controller.handleEvent({type: 'session_restored', sessionId: 'sess-empty', turns: []});

	sent.length = 0;
	controller.selectTask(task.id);
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'empty-but-restored session must not loop Attach'
	);
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'restored session must not re-Bind on every select'
	);
});

test('selectTask without workspaceId requests Register and skips Attach', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Needs bind');
	controller.acceptNewSession('sess-boot', task.id);
	sent.length = 0;
	registerCalls = 0;
	controller.selectTask(task.id);
	assert.equal(registerCalls, 1, 'must request Register before Bind/Attach');
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'must not Attach while workspaceId is missing (pins boot cwd)'
	);
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'must not Bind without workspaceId'
	);
});

test('ensureLive without workspaceId does not Attach (retry after Register)', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	controller.hydrateFromMeta([{id: 'sess-wait', title: 'Wait', status: 'active'}]);
	const task = controller.listTasks().find(t => t.sessionId === 'sess-wait');
	assert.ok(task);
	controller.ensureLive(task.id, {focus: false});
	assert.equal(registerCalls, 1);
	assert.equal(controller.isAttached('sess-wait'), false);
	assert.equal(sent.find(c => c.type === 'BindSessionWorkspace'), undefined);
	assert.equal(sent.find(c => c.type === 'AttachSession'), undefined);
});

test('ensureLive Bind+Attach without moving focus (Open Tab background)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-bg', title: 'Background', status: 'active'},
		{id: 'sess-focus', title: 'Focused', status: 'active'}
	]);
	const focused = controller.listTasks().find(t => t.sessionId === 'sess-focus');
	const bg = controller.listTasks().find(t => t.sessionId === 'sess-bg');
	assert.ok(focused && bg);
	controller.selectTask(focused.id);
	assert.equal(controller.getActiveTask()?.id, focused.id);
	sent.length = 0;
	const live = controller.ensureLive(bg.id, {focus: false});
	assert.ok(live);
	assert.equal(controller.getActiveTask()?.id, focused.id, 'must not steal focus');
	assert.ok(
		sent.some(
			c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-bg'
		),
		'must Bind background Open Tab session'
	);
	assert.ok(
		sent.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-bg'),
		'must Attach background Open Tab session'
	);
	sent.length = 0;
	controller.ensureLive(bg.id, {focus: false});
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'already attached background must not re-Bind'
	);
});

test('selectTask is ensureLive with focus', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', status: 'active'},
		{id: 'sess-b', title: 'B', status: 'active'}
	]);
	const a = controller.listTasks().find(t => t.sessionId === 'sess-a');
	const b = controller.listTasks().find(t => t.sessionId === 'sess-b');
	assert.ok(a && b);
	controller.selectTask(a.id);
	assert.equal(controller.getActiveTask()?.id, a.id);
	sent.length = 0;
	controller.selectTask(b.id);
	assert.equal(controller.getActiveTask()?.id, b.id);
	assert.ok(sent.some(c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-b'));
});

test('SessionController selectTask keeps prior Attach and routes by sessionId', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `s${++n}`;
		})()
	});

	const taskA = controller.createTask('A');
	controller.acceptNewSession('sess-a', taskA.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: [{turnId: 't-a', userText: 'hi a', assistantText: 'a', tools: []}]
	});
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', text: 'a', eventSeq: 5} as BridgeEvent));

	const taskB = controller.createTask('B');
	controller.acceptNewSession('sess-b', taskB.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	controller.handleEvent({type: 'session_restored', sessionId: 'sess-b', turns: []});
	assert.ok(controller.isAttached('sess-a'));
	assert.ok(controller.isAttached('sess-b'));

	sent.length = 0;
	controller.selectTask(taskA.id);

	// Multi-Attach: switching focus must not Detach the other Session.
	assert.equal(
		sent.find(c => c.type === 'DetachSession'),
		undefined
	);
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'A was already attached — no re-Attach'
	);
	assert.equal(controller.getActiveTask()?.id, taskA.id);
	assert.equal(controller.canSendMessage(), true);

	const beforeA = [...(controller.listTasks().find(t => t.id === taskA.id)?.transcript.entries ?? [])]
		.map(e => e.text)
		.join('');
	controller.handleEvent(
		withSid('sess-b', {
			type: 'turn_started',
			eventSeq: 1,
			turnId: 'tb',
			clientMessageId: 'tb',
			text: 'ask B'
		})
	);
	controller.handleEvent(
		withSid('sess-b', {
			type: 'assistant_delta',
			turnId: 'tb',
			text: 'from-b',
			eventSeq: 2
		} as BridgeEvent)
	);
	assert.equal(
		[...(controller.listTasks().find(t => t.id === taskA.id)?.transcript.entries ?? [])]
			.map(e => e.text)
			.join(''),
		beforeA
	);
	const textB = [...(controller.listTasks().find(t => t.id === taskB.id)?.transcript.entries ?? [])]
		.map(e => e.text)
		.join('');
	assert.ok(textB.includes('from-b'), `expected B transcript to include from-b, got ${textB}`);
});

test('SessionController heartbeats every attached Session', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 99,
		createId: (() => {
			let n = 0;
			return () => `h${++n}`;
		})()
	});
	const hbA = controller.createTask('A');
	controller.acceptNewSession('sess-a', hbA.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	const hbB = controller.createTask('B');
	controller.acceptNewSession('sess-b', hbB.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});

	sent.length = 0;
	controller.tickHeartbeat();
	const beats = sent.filter(c => c.type === 'Heartbeat');
	assert.equal(beats.length, 2);
	const ids = new Set(beats.map(c => (c.type === 'Heartbeat' ? c.sessionId : '')));
	assert.ok(ids.has('sess-a'));
	assert.ok(ids.has('sess-b'));
});

test('createTask appears at top of listTasks immediately (has lastModified)', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `c${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: '2026-01-01T00:00:00.000Z'}
	]);
	assert.equal(controller.listTasks()[0]?.title, 'Older');

	const created = controller.createTask('Brand new');
	assert.ok(created.listOrder > 0, 'new task must stamp listOrder');
	assert.equal(
		controller.listTasks()[0]?.id,
		created.id,
		'new task must be first — empty lastModified used to land at bottom then jump'
	);

	const newer = controller.createTask('Even newer');
	assert.equal(controller.listTasks()[0]?.id, newer.id);
	assert.equal(controller.listTasks()[1]?.id, created.id);
});

test('ready/meta before CreateSession result: only command_result+taskId binds; listOrder stays', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `r${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: '2026-01-01T00:00:00.000Z'}
	]);
	const created = controller.createTask('New task');
	assert.equal(controller.listTasks()[0]?.id, created.id);
	assert.equal(controller.listTasks().length, 2);
	const orderAtCreate = created.listOrder;

	// ready is not bind authority.
	controller.handleEvent({
		type: 'ready',
		sessionId: 'sess-new',
		protocolVersion: 2
	});
	assert.equal(created.sessionId, null, 'ready must not bind pending New');

	// Inventory may insert a stub; must not claim the optimistic row.
	controller.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: '2026-01-01T00:00:00.000Z'},
		{
			id: 'sess-new',
			title: 'New Task',
			lastModified: '2020-01-01T00:00:00.000Z'
		}
	]);
	assert.equal(created.sessionId, null, 'meta must not claim pending New');
	assert.equal(controller.listTasks()[0]?.id, created.id);
	assert.equal(created.listOrder, orderAtCreate, 'listOrder must not move');

	controller.acceptNewSession('sess-new', created.id);
	assert.equal(created.sessionId, 'sess-new');
	assert.equal(controller.listTasks()[0]?.id, created.id);
	assert.equal(controller.listTasks()[0]?.listOrder, orderAtCreate);
	assert.equal(
		controller.listTasks().filter(t => t.sessionId === 'sess-new').length,
		1,
		'accept must collapse inventory stub'
	);
});

test('hydrate must not move listOrder (no jump down the list)', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `d${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', lastModified: '2026-07-15T12:00:00.000Z'}
	]);
	const created = controller.createTask('Fresh');
	const order = created.listOrder;
	controller.acceptNewSession('sess-fresh', created.id);
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', lastModified: '2026-07-15T12:00:00.000Z'},
		{id: 'sess-fresh', title: 'Fresh', lastModified: '2026-07-15T11:00:00.000Z'}
	]);
	assert.equal(controller.listTasks()[0]?.id, created.id);
	assert.equal(controller.listTasks()[0]?.listOrder, order);
});

test('hydrateFromSessionsList must not steal focus from pending New task', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `n${++n}`;
		})()
	});
	const _bind1 = controller.createTask('A');
	controller.acceptNewSession('sess-a', _bind1.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});

	const created = controller.createTask('New task');
	assert.equal(controller.getActiveTask()?.id, created.id);
	assert.equal(controller.getActiveTask()?.pendingNew, true);

	sent.length = 0;
	controller.hydrateFromSessionsList([
		{
			id: 'sess-a',
			title: 'A',
			lastModified: '2026-07-15T12:00:00.000Z',
			messageCount: 1,
			cwd: '/proj',
			isCurrent: true
		}
	]);

	assert.equal(controller.getActiveTask()?.id, created.id, 'New task must stay focused');
	assert.equal(controller.getActiveTask()?.pendingNew, true);
	assert.equal(controller.tasksHydrated, true);
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'hydrate must not Attach'
	);
});

test('selectTask focuses pending New task without sessionId (no Bind/Attach)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `p${++n}`;
		})(),
		workspaceId: () => 'ws-1'
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	const pending = controller.createTask('Pending');
	assert.equal(pending.sessionId, null);

	sent.length = 0;
	const selected = controller.selectTask(pending.id);
	assert.ok(selected);
	assert.equal(controller.getActiveTask()?.id, pending.id);
	assert.equal(sent.length, 0, 'no Bind/Attach until sessionId exists');

	controller.selectTask(a.id);
	assert.equal(controller.getActiveTask()?.id, a.id);
});

test('hydrateFromMeta does not steal focus after user selected another session task', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `h${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: '2026-07-15T10:00:00.000Z'},
		{id: 'sess-new', title: 'Newer', lastModified: '2026-07-15T12:00:00.000Z', isCurrent: true}
	]);
	const older = controller.listTasks().find(t => t.title === 'Older')!;
	const newer = controller.listTasks().find(t => t.title === 'Newer')!;
	assert.equal(controller.getActiveTask()?.id, newer.id);

	controller.selectTask(older.id);
	assert.equal(controller.getActiveTask()?.id, older.id);

	controller.hydrateFromMeta([
		{id: 'sess-old', title: 'Older', lastModified: '2026-07-15T10:00:00.000Z'},
		{id: 'sess-new', title: 'Newer', lastModified: '2026-07-15T12:00:00.000Z', isCurrent: true}
	]);
	assert.equal(controller.getActiveTask()?.id, older.id, 're-hydrate must keep user selection');
});

test('hydrateFromMeta auto-selects isCurrent only when nothing is active', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `a${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', lastModified: '2026-07-15T10:00:00.000Z'},
		{id: 'sess-b', title: 'B', lastModified: '2026-07-15T11:00:00.000Z', isCurrent: true}
	]);
	assert.equal(controller.getActiveTask()?.title, 'B');
});

test('selectTask unknown id returns null and leaves prior focus', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `u${++n}`;
		})()
	});
	const t = controller.createTask('Keep');
	assert.equal(controller.selectTask('missing-id'), null);
	assert.equal(controller.getActiveTask()?.id, t.id);
});

test('clicking middle of three Meta tasks keeps that focus across re-hydrate (no jump)', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `m${++n}`;
		})()
	});
	const sessions = [
		{id: 'sess-1', title: 'First', lastModified: '2026-07-15T12:00:00.000Z'},
		{id: 'sess-2', title: 'Second', lastModified: '2026-07-15T11:00:00.000Z'},
		{id: 'sess-3', title: 'Third', lastModified: '2026-07-15T10:00:00.000Z'}
	];
	controller.hydrateFromMeta(sessions);
	assert.equal(controller.getActiveTask()?.title, 'First');

	const second = controller.listTasks().find(t => t.title === 'Second')!;
	const third = controller.listTasks().find(t => t.title === 'Third')!;
	controller.selectTask(third.id);
	assert.equal(controller.getActiveTask()?.id, third.id);

	controller.hydrateFromMeta(sessions.map(s => ({...s, isCurrent: s.id === 'sess-1'})));
	assert.equal(controller.getActiveTask()?.id, third.id, 'must not jump back to First/Second');

	controller.selectTask(second.id);
	controller.hydrateFromMeta(sessions);
	assert.equal(controller.getActiveTask()?.id, second.id);
});

test('hydrateFromMeta with empty list keeps prior activeTaskId', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `e${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', lastModified: '2026-07-15T12:00:00.000Z'}
	]);
	const id = controller.getActiveTask()?.id;
	assert.ok(id);
	controller.hydrateFromMeta([]);
	assert.equal(controller.getActiveTask()?.id, id);
	assert.equal(controller.tasksHydrated, true);
});

test('requestSessionsList passes workspaceId args', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		workspaceId: () => 'ws-hash-42'
	});
	assert.equal(controller.requestSessionsList(), true);
	const cmd = sent[0];
	assert.ok(cmd && cmd.type === 'command' && cmd.name === 'sessions');
	assert.equal(cmd.args, 'ws-hash-42');
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
	assert.equal(state.activeRunId, 'run-1');
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

test('local cancel drops stray assistant_delta', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: () => 'cid'
	});
	const _bind6 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind6.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'x', eventSeq: 1}));
	assert.equal(controller.cancelRun(), true);
	controller.handleEvent(withSid('sess', {type: 'assistant_delta', turnId: 't1', text: 'ghost', eventSeq: 2}));
	const assistant = controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'cancelled');
	assert.equal(assistant?.text, '');
});

test('user sequence: cancel settle → resubmit stays streaming; third turn accepts content', () => {
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
	const _bind7 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind7.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'c1',
		clientMessageId: 'c1',
		text: '继续寻找方法'
	}));
	controller.handleEvent(withSid('sess', {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}));
	assert.equal(controller.cancelRun('stop'), true);
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 2}));
	assert.equal(controller.canSubmitNow(), true);

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 3,
		turnId: 'c2',
		clientMessageId: 'c2',
		text: '继续'
	}));
	controller.handleEvent(withSid('sess', {type: 'reasoning_delta', turnId: 'c2', text: 'thinking', eventSeq: 4}));
	const a2 = controller.getActiveTask()?.transcript.entries.find(
		e => e.role === 'assistant' && e.turnId === 'c2'
	);
	assert.equal(a2?.status, 'streaming');
	assert.equal(a2?.reasoning, 'thinking');

	assert.equal(controller.cancelRun('stop'), true);
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 5}));
	assert.equal(controller.canSubmitNow(), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('继续'), true);
	assert.equal(sent.some(c => c.type === 'SubmitUserMessage'), true);

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 6,
		turnId: 'c3',
		clientMessageId: 'c3',
		text: '继续'
	}));
	controller.handleEvent(withSid('sess', {type: 'reasoning_delta', turnId: 'c3', text: 'plan', eventSeq: 7}));
	const a3 = controller.getActiveTask()?.transcript.entries.find(
		e => e.role === 'assistant' && e.turnId === 'c3'
	);
	assert.equal(a3?.status, 'streaming');
	assert.equal(a3?.reasoning, 'plan');
});

test('cancel → CancelAssociated; turn_cancelled unlocks; no host drain (V6)', () => {
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
	const _bind8 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind8.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'first'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	}));
	assert.equal(controller.getActiveTask()?.transcript.activeRunId, '019f-server-run');
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.canSubmitNow(), false);

	assert.equal(controller.sendMessage('queued follow-up'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage' && c.text === 'queued follow-up'));
	controller.handleEvent(
		withSid('sess', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-a', text: 'queued follow-up', order: 0}])
		})
	);
	assert.equal(controller.getActiveTask()?.queue.length, 1);

	sent.length = 0;
	assert.equal(controller.cancelRun('stop'), true);
	const cancel = sent.find(c => c.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(controller.getActiveTask()?.transcript.awaitingCancelSettlement, true);
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.canSubmitNow(), false);
	assert.equal(controller.canEnqueue(), true, 'Stopping allows Follow-up submit');
	assert.equal(controller.gate().runState, 'stopping');
	assert.equal(controller.sendMessage('during cancel'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage' && c.text === 'during cancel'));

	sent.length = 0;
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 2}));
	assert.equal(controller.getActiveTask()?.transcript.awaitingCancelSettlement, false);
	assert.equal(controller.isRunActive(), false);
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.getActiveTask()?.queue.length, 1, 'projection unchanged until follow_up_changed');
	assert.equal(sent.filter(c => c.type === 'SubmitUserMessage').length, 0);

	assert.equal(controller.sendMessage('after settle'), true);
	const submits = sent.filter(c => c.type === 'SubmitUserMessage');
	assert.equal(submits.length, 1);
	if (submits[0]?.type === 'SubmitUserMessage') {
		assert.equal(submits[0].text, 'after settle');
	}
});

test('cancel settlement timeout unlocks submit when turn_cancelled never arrives', async () => {
	const sent: BridgeCommand[] = [];
	let changes = 0;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		cancelSettlementTimeoutMs: 30,
		onChange: () => {
			changes += 1;
		}
	});
	const _bind9 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind9.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'first'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(controller.getActiveTask()?.transcript.awaitingCancelSettlement, true);
	assert.equal(controller.canSubmitNow(), false);

	await new Promise(r => setTimeout(r, 80));
	assert.equal(controller.getActiveTask()?.transcript.awaitingCancelSettlement, false);
	assert.equal(controller.isRunActive(), false);
	assert.equal(controller.canSubmitNow(), true);
	assert.ok(changes >= 1, 'onChange must fire so UI can unlock');
	assert.equal(controller.sendMessage('after timeout'), true);
});

test('cancel settlement timers are per-task: arming B does not disarm A', async () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		cancelSettlementTimeoutMs: 30
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent(withSid('sess-a', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_a',
		clientMessageId: 'client_a',
		text: 'run a'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(controller.listTasks().find(t => t.id === a.id)?.transcript.awaitingCancelSettlement, true);

	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	controller.selectTask(b.id);
	controller.handleEvent(withSid('sess-b', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_b',
		clientMessageId: 'client_b',
		text: 'run b'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(controller.listTasks().find(t => t.id === b.id)?.transcript.awaitingCancelSettlement, true);
	assert.equal(controller.listTasks().find(t => t.id === a.id)?.transcript.awaitingCancelSettlement, true);

	await new Promise(r => setTimeout(r, 80));
	assert.equal(
		controller.listTasks().find(t => t.id === a.id)?.transcript.awaitingCancelSettlement,
		false,
		'A watchdog must fire even after B armed its own'
	);
	assert.equal(controller.listTasks().find(t => t.id === b.id)?.transcript.awaitingCancelSettlement, false);
});

test('run lease expiry attaches then locally settles after grace', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'assistant_delta',
		eventSeq: 2,
		turnId: 'run-1',
		text: 'hello'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	assert.equal(controller.getActiveTask()?.transcript.leaseAware, true);
	assert.equal(controller.gate().runState, 'running');

	now = 1_000 + 16_000;
	sent.length = 0;
	controller.tickRunLeases();
	assert.ok(sent.some(c => c.type === 'AttachSession'));
	assert.equal(controller.gate().runState, 'running', 'grace keeps chrome busy');

	now += 5_000;
	controller.tickRunLeases();
	assert.equal(controller.getActiveTask()?.transcript.activeRunId, undefined);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.consumeHelpNotice(), 'errors.lease.expired');
	controller.reset();
});

test('run lease does not expire before a run_state (legacy engine)', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	now = 1_000 + 60_000;
	controller.tickRunLeases();
	assert.equal(sent.some(c => c.type === 'AttachSession' && 'lastEventSeq' in c && c.lastEventSeq > 0), false);
	assert.equal(controller.gate().runState, 'running');
	controller.reset();
});

test('run lease heartbeat during grace renews and does not settle', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	now = 1_000 + 16_000;
	controller.tickRunLeases();
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	now += 5_000;
	controller.tickRunLeases();
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.consumeHelpNotice(), null);
	controller.reset();
});

test('run lease expires a Goal-only overlay after grace', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'goal_updated',
		goalId: 'g1',
		phase: 'started',
		status: 'running'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'goal-run',
		state: 'running',
		ts: now
	}));
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.gate().canCancel, false);
	assert.equal(controller.getActiveTask()?.transcript.activeRunId, undefined);

	now = 1_000 + 16_000;
	sent.length = 0;
	controller.tickRunLeases();
	assert.ok(sent.some(c => c.type === 'AttachSession'));
	assert.equal(controller.gate().runState, 'running', 'grace keeps Goal chrome busy');

	now += 5_000;
	controller.tickRunLeases();
	assert.equal(controller.getActiveTask()?.goalCard, undefined);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.consumeHelpNotice(), 'errors.lease.expired');
	controller.reset();
});

test('cancel without server Run id still sends CancelAssociated (V6 Stop)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'cid'
	});
	const _bind10 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind10.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 'client_only', text: 'early', eventSeq: 1}));
	// Peer-turn pin keeps Composer Gate honest but is NOT a server Run id —
	// Stop uses CancelAssociated over the whole FanOut, never CancelRun('client_only').
	assert.equal(controller.getActiveTask()?.transcript.activeRunId, 'client_only');
	assert.equal(controller.getActiveTask()?.transcript.activeRunFromServer, false);

	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(sent.some(c => c.type === 'CancelRun'), false);
	assert.equal(sent.some(c => c.type === 'CancelSession'), false);
	const cancel = sent.find(c => c.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(controller.getActiveTask()?.transcript.awaitingCancelSettlement, true);
});

test('killProc sends KillProc and clears liveProcs optimistically', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-kill'
	});
	const task = controller.createTask('Kill');
	controller.acceptNewSession('sess-kill', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-kill', clientId: 'cli'});
	controller.handleEvent(
		withSid('sess-kill', {
			type: 'proc_updated',
			procId: 'p-stuck',
			status: 'running',
			command: 'sbt test'
		} as BridgeEvent)
	);
	assert.equal(controller.getActiveTask()?.transcript.liveProcs?.length, 1);

	assert.equal(controller.killProc('p-stuck'), true);
	const kill = sent.find(c => c.type === 'KillProc');
	assert.ok(kill && kill.type === 'KillProc');
	assert.equal(kill.procId, 'p-stuck');
	assert.equal(kill.reason, 'user_stopped');
	assert.equal(controller.getActiveTask()?.transcript.liveProcs?.length, 0);
});

test('session_restored before ready hydrates Main task transcript', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'main'
	});

	// Bind only via acceptNewSession(taskId); later restore with turns projects
	// onto the owning task (never claim pending New with prior-task history).
	const main = controller.createTask('Main');
	assert.equal(controller.getActiveTask()?.kind, 'task');
	controller.acceptNewSession('sess-restored', main.id);
	assert.ok(sent.some(c => c.type === 'AttachSession'));
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-restored',
		turns: [
			{turnId: 't1', userText: 'hello from history', assistantText: 'hi back', tools: []}
		]
	});

	const entries = controller.getActiveTask()?.transcript.entries ?? [];
	assert.equal(entries.some(e => e.role === 'user' && e.text === 'hello from history'), true);
	assert.equal(entries.some(e => e.role === 'assistant' && e.text === 'hi back'), true);
});

test('sessions_list hydrates project conversations and keeps most recent open', () => {
	const sent: BridgeCommand[] = [];
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => `id-${++n}`
	});

	controller.handleEvent({
		type: 'sessions_list',
		sessions: [
			{
				id: 'sess-old',
				title: 'Yesterday',
				lastModified: '2026-07-10T10:00:00Z',
				messageCount: 2
			},
			{
				id: 'sess-new',
				title: 'Stock analysis',
				lastModified: '2026-07-12T10:00:00Z',
				messageCount: 4,
				isCurrent: true
			}
		]
	});

	const tasks = controller.listTasks();
	assert.equal(tasks.length, 2);
	assert.equal(tasks[0]?.sessionId, 'sess-new');
	assert.equal(tasks[0]?.title, 'Stock analysis');
	assert.equal(tasks[1]?.title, 'Yesterday');
	assert.equal(controller.listChats().length, 0);
	assert.equal(controller.getActiveTask()?.sessionId, 'sess-new');
	assert.equal(controller.getActiveTask()?.kind, 'task');
});

test('sessions_list does not replace Main with a bare session id', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: () => 'main'
	});
	const _bind11 = controller.createTask('Main');
	controller.acceptNewSession('019f598a-abcd', _bind11.id);
	controller.handleEvent({
		type: 'sessions_list',
		sessions: [
			{
				id: '019f598a-abcd',
				lastModified: '2026-07-12T10:00:00Z',
				messageCount: 1,
				isCurrent: true
			}
		]
	});
	assert.equal(controller.getActiveTask()?.title, 'Main');
	assert.equal(controller.getActiveTask()?.kind, 'task');
	assert.equal(controller.listChats().length, 0);
});

test('session_restored hydrates prior turns and keeps in-flight user+assistant', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'live',
		clientMessageId: 'live',
		text: 'now'
	});
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{turnId: 'old', userText: 'before', assistantText: 'answer', thinking: 't', tools: []}
		]
	});
	assert.equal(state.entries.some(e => e.text === 'before'), true);
	assert.equal(state.entries.some(e => e.text === 'answer'), true);
	assert.equal(state.entries.some(e => e.role === 'user' && e.text === 'now'), true);
	assert.equal(state.entries.filter(e => e.status === 'streaming').length, 1);
});

test('slash catalog from commands_available; skills list silent; skill slash forwards to Bridge', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		discoverHostSkills: () => [
			{name: 'host-skill', description: 'From disk', available: true, badge: 'personal'}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	// Attach must not prefetch /skills (switch/create hot path). Composer pulls on menu open.
	assert.equal(
		sent.some(c => c.type === 'command' && c.name === 'skills'),
		false,
		'Attached must not silent-/skills'
	);
	sent.length = 0;
	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'host-skill');
	assert.ok(
		sent.some(
			c =>
				c.type === 'command' &&
				c.name === 'skills' &&
				c.args === '' &&
				c.sessionId === 'sess'
		),
		'silent /skills must stamp sessionId'
	);
	sent.length = 0;
	// In-flight silent request is not stacked.
	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(sent.length, 0);

	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{
				name: 'explain-code',
				description: 'Explain',
				usage: '/explain-code',
				available: true,
				badge: 'personal'
			}
		]
	});
	// Bridge merges with Host disk skills (Bridge wins on name collision).
	assert.equal(controller.slashCatalog.length, 2);
	assert.ok(controller.slashCatalog.some(e => e.name === 'host-skill'));
	const explained = controller.slashCatalog.find(e => e.name === 'explain-code');
	assert.equal(explained?.badge, 'personal');
	assert.equal(controller.slashCatalogHydrated, true);

	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	assert.equal(controller.sendMessage('/explain-code look at this'), true);
	const skillCmd = sent.find(c => c.type === 'command' && c.name === 'explain-code');
	assert.ok(skillCmd, 'skill command must be sent');
	assertSkillCommandPinned(skillCmd, 'sess');
	assert.equal(skillCmd.args, 'look at this');
});

test('skill slash without attached session surfaces blocker notice (not silent)', () => {
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		send: () => true,
		createId: () => 'task-pending'
	});
	controller.createTask('Pending');
	assert.equal(controller.sendMessage('/explain-code'), false);
	assert.equal(controller.consumeHelpNotice(), 'errors.send.session_starting');
});

test('intentional /skills is not swallowed by silent catalog refresh', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	assert.equal(controller.requestSlashCatalog(), true);
	assert.equal(controller.sendMessage('/skills'), true);

	// Silent refresh result — dropped from transcript.
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (silent)\n──\n  a',
		status: 'success'
	});
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	// User /skills result projects into transcript.
	const afterUser = controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.ok((afterUser?.transcript.entries.length ?? 0) > 0);
});

test('requestSlashCatalog does not mark silent when send fails', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => false
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	assert.equal(controller.requestSlashCatalog(), false);
	// Unmatched command_result must still reach transcript (default transcript mode).
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Skills (1)\n──\n  explain-code',
		status: 'success'
	});
	assert.ok((controller.getActiveTask()?.transcript.entries.length ?? 0) > 0);
});

test('silent /skills Unknown command does not leak into next send notice', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'skills',
		message: 'Unknown command: /skills',
		status: 'error'
	});
	assert.equal(controller.consumeHelpNotice(), null);

	assert.equal(controller.sendMessage('/code-review look'), true);
	assert.equal(controller.consumeHelpNotice(), null);
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

test('skill slash command_result error paints into transcript', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'code-review',
		message: 'Unknown command: /code-review (Skill not found)',
		status: 'error'
	});
	const entries = controller.getActiveTask()?.transcript.entries ?? [];
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.status, 'error');
	assert.match(entries[0]?.text ?? '', /code-review/);
});

test('empty commands_available keeps host-seeded slash catalog', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'code-review', description: 'Review', available: true, badge: 'personal'}
		]
	});
	assert.equal(controller.seedHostSlashCatalog(), true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
	controller.handleEvent({type: 'commands_available', commands: []});
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
});

test('empty commands_available on dsh keeps catalog for skill.list', () => {
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
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	controller.handleEvent({type: 'commands_available', commands: []});
	assert.equal(controller.slashCatalogHydrated, true);
	assert.equal(controller.slashCatalog[0]?.name, 'code-review');
});

test('dsh skill slash is SubmitUserMessage text, not Fast command', () => {
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
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-dsh', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.sendMessage('/code-review look'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.equal(submit && 'text' in submit ? submit.text : undefined, '/code-review look');
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'code-review'));
});

test('dsh /model and /mode do not send Fast command', () => {
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
		createId: () => `id-${++n}`
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-dsh', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-dsh', clientId: 'cli'});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.sendMessage('/model deepseek-v4-flash'), true);
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'model'));
	assert.ok(!sent.some(c => c.type === 'SubmitUserMessage'));
	assert.equal(controller.sendMessage('/mode agent'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.equal(submit && 'text' in submit ? submit.text : undefined, '/mode agent');
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'mode'));
	assert.ok(!sent.some(c => c.type === 'SetMode'));
});

test('seedHostSlashCatalog backfills when Bridge flag set but catalog empty', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Research', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'plan', description: 'Plan', usage: '', available: true, badge: 'builtin'}]
	});
	assert.ok(controller.slashCatalog.some(e => e.name === 'plan'));
	// Simulate wipe while bridgeSlashCatalog remains true — Host must still backfill.
	controller.slashCatalog = [];
	assert.equal(controller.seedHostSlashCatalog(), true);
	assert.equal(controller.slashCatalog[0]?.name, 'research');
});

test('commands_available merges host disk skills; Bridge wins on name collision', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Host research', available: true, badge: 'personal'},
			{name: 'to-spec', description: 'Host to-spec', available: true, badge: 'personal'},
			{name: 'plan', description: 'Host plan stale', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{name: 'plan', description: 'Builtin plan', usage: '', available: true, badge: 'builtin'},
			{name: 'to-spec', description: 'Builtin to-spec', usage: '', available: true, badge: 'builtin'},
			{name: 'brainstorm', description: 'Ideas', usage: '', available: true, badge: 'builtin'}
		]
	});
	const names = controller.slashCatalog.map(e => e.name).sort();
	assert.deepEqual(names, ['brainstorm', 'plan', 'research', 'to-spec']);
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.description, 'Builtin plan');
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'to-spec')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'research')?.badge, 'personal');
});

test('commands_available normalizes legacy Engine badge labels to ids', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'research', description: 'Host research', available: true, badge: '个人'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [
			{name: 'plan', description: 'Builtin plan', usage: '', available: true, badge: '内置'}
		]
	});
	assert.equal(controller.slashCatalog.find(e => e.name === 'plan')?.badge, 'builtin');
	assert.equal(controller.slashCatalog.find(e => e.name === 'research')?.badge, 'personal');
});

test('Host coding product names are not merged as personal when Bridge omits them', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{name: 'implement', description: 'Host implement', available: true, badge: 'personal'},
			{name: 'grilling', description: 'Host grilling', available: true, badge: 'personal'}
		]
	});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'plan', description: 'Plan', usage: '', available: true, badge: 'builtin'}]
	});
	assert.ok(!controller.slashCatalog.some(e => e.name === 'implement'));
	assert.ok(controller.slashCatalog.some(e => e.name === 'grilling'));
});

test('Unknown command for host-known skill adds SkillSlash rebuild hint', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		discoverHostSkills: () => [
			{
				name: 'improve-codebase-architecture',
				description: 'Arch',
				available: true,
				badge: 'personal'
			}
		]
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'improve-codebase-architecture',
		message: 'Unknown command: /improve-codebase-architecture',
		status: 'error'
	});
	const text = controller.getActiveTask()?.transcript.entries[0]?.text ?? '';
	assert.match(text, /Unknown command: \/improve-codebase-architecture/);
	assert.match(text, /SkillSlash/);
});

test('model list command_result populates catalog without transcript noise', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const _bind12 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind12.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.equal(controller.requestModelList(), true);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'model' && c.args === ''));
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: '* default\n  gpt-4o\n',
		status: 'success'
	});
	assert.equal(controller.modelCatalog.length, 2);
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);
	assert.equal(controller.selectModel('gpt-4o'), true);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'model' && c.args === 'gpt-4o'));
});

test('provider catalog is not overwritten by yaml /model dump', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const bind = controller.createTask('T');
	controller.acceptNewSession('sess', bind.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-pro',
			display: 'DeepSeek V4 Pro',
			aliases: ['deepseek-v4-pro'],
			current: true,
			supportsThinking: true,
			supportedEfforts: ['xhigh']
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	sent.length = 0;
	assert.equal(controller.requestModelList(), true);
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model'),
		'ListProviders catalog must not re-fetch yaml /model'
	);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: [
			'Current model: anthropic/claude-opus-4-5',
			'',
			'  anthropic/claude-opus-4-5',
			'  anthropic/claude-sonnet-4-5',
			'  deepseek/deepseek-v4-pro',
			'',
			'Usage: /model <name|alias>'
		].join('\n'),
		status: 'success'
	});
	assert.deepEqual(
		controller.modelCatalog.map(e => e.id),
		['deepseek/deepseek-v4-pro', 'zhipu/glm-5.2']
	);
	assert.equal(
		controller.modelCatalog.some(e => e.id.includes('claude')),
		false
	);
});

test('applyProviderCatalog snaps yaml default chrome onto a ListProviders row', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.model, 'default');
	assert.equal(controller.modelDisplay, '');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
	});
	assert.equal(controller.modelDisplay, '', 'yaml stub must not paint Composer');
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.model, 'deepseek/deepseek-v4-flash');
	assert.equal(controller.modelDisplay, 'DeepSeek V4 Flash');
	assert.equal(controller.modelCatalog.find(e => e.current)?.id, 'deepseek/deepseek-v4-flash');
	assert.equal(
		controller.modelCatalog.some(e => e.display.includes('nemotron')),
		false
	);
});

test('applyProviderCatalog keeps a catalog pick that is already selected', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.selectModel('zhipu/glm-5.2'), true);
	controller.applyProviderCatalog([
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			aliases: ['deepseek-v4-flash'],
			current: false
		},
		{
			id: 'zhipu/glm-5.2',
			display: 'GLM-5.2',
			aliases: ['glm-5.2'],
			current: false
		}
	]);
	assert.equal(controller.model, 'zhipu/glm-5.2');
	assert.equal(controller.modelDisplay, 'GLM-5.2');
});

test('ready applies Engine modelDisplay when it is a real catalog id', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.modelDisplay, '');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'openai/gpt-5.6-luna',
		modelDisplay: 'openai/gpt-5.6-luna'
	});
	assert.equal(controller.model, 'openai/gpt-5.6-luna');
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	const task = controller.createTask('T');
	assert.equal(
		task.modelDisplay,
		'openai/gpt-5.6-luna',
		'new tasks inherit resolved display from ready'
	);
});

test('ready with bare default alias does not paint yaml nemotron', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'default'
	});
	assert.equal(controller.modelDisplay, '');
	assert.equal(controller.modelDisplay.toLowerCase() === 'default', false);
	assert.equal(controller.modelDisplay.includes('nemotron'), false);
});

test('healDefaultModelDisplay paints real default model name over alias stub', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(
		controller.healDefaultModelDisplay(
			'default',
			'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
		),
		false,
		'must refuse to paint the yaml default stub'
	);
	controller.createTask('T');
	assert.equal(controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'), true);
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	assert.equal(controller.getActiveTask()?.modelDisplay, 'openai/gpt-5.6-luna');
	assert.equal(
		controller.healDefaultModelDisplay('default', 'default'),
		false,
		'must refuse to paint the bare alias'
	);
});

test('submit sends painted model, not the alias stub default', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'msg-1'
	});
	assert.equal(
		controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'),
		true
	);
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.notEqual(submit.useModel, 'default');
		assert.equal(submit.useModel, 'openai/gpt-5.6-luna');
	}
});

test('submit after setRunMode still does not send useModel default', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'msg-2'
	});
	controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna');
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.equal(controller.setRunMode('plan', task.id), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('plan it'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.notEqual(submit.useModel, 'default');
		assert.equal(submit.useModel, 'openai/gpt-5.6-luna');
	}
});

test('hydrate after ready does not reinstall Default placeholder on chrome', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	assert.equal(controller.healDefaultModelDisplay('default', 'openai/gpt-5.6-luna'), true);
	const early = controller.createTask('Early');
	assert.equal(early.modelDisplay, 'openai/gpt-5.6-luna');
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
	});
	assert.equal(
		controller.modelDisplay,
		'openai/gpt-5.6-luna',
		'yaml stub ready must not clobber a resolved catalog label'
	);
	assert.equal(controller.getActiveTask()?.modelDisplay, 'openai/gpt-5.6-luna');
	controller.handleEvent({
		type: 'sessions_list',
		sessions: [
			{
				id: 'sess-early',
				title: 'Early',
				lastModified: new Date().toISOString(),
				messageCount: 0,
				isCurrent: true
			}
		]
	});
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
	const sibling = controller.createTask('Sibling');
	controller.selectTask(early.id);
	assert.equal(
		controller.modelDisplay,
		'openai/gpt-5.6-luna',
		'selecting a pre-ready task must not paint Default'
	);
	controller.selectTask(sibling.id);
	assert.equal(controller.modelDisplay, 'openai/gpt-5.6-luna');
});

test('ready and Attached do not pull yaml /model for catalog', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	controller.handleEvent({
		type: 'ready',
		protocolVersion: 2,
		model: 'default',
		modelDisplay: 'default'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model'),
		'Composer catalog is ListProviders, not yaml /model'
	);
});

test('Attached skips model list when concrete default label is already painted', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	assert.equal(controller.modelDisplay, '');
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	assert.ok(
		!sent.some(c => c.type === 'command' && c.name === 'model' && c.args === ''),
		'concrete default label must not trigger a redundant /model refresh'
	);
});

test('model selection is remembered per task across selectTask', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});

	controller.selectTask(a.id);
	assert.equal(controller.requestModelList(), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message: '* default\n  gpt-4o\n  claude\n',
		status: 'success'
	});
	assert.equal(controller.selectModel('gpt-4o'), true);
	assert.equal(controller.model, 'gpt-4o');
	assert.equal(controller.getActiveTask()?.model, 'gpt-4o');

	controller.selectTask(b.id);
	assert.equal(controller.model, 'default');
	assert.equal(controller.selectModel('claude'), true);
	assert.equal(controller.getActiveTask()?.model, 'claude');

	controller.selectTask(a.id);
	assert.equal(controller.model, 'gpt-4o');
	assert.equal(controller.modelDisplay, 'gpt-4o');
	assert.equal(controller.getActiveTask()?.model, 'gpt-4o');
});

test('markEngineLost fails in-flight streaming turn and clears cancel settlement gate', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const _bind13 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind13.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 't1',
		clientMessageId: 't1',
		text: 'hello'
	}));
	controller.handleEvent(withSid('sess', {type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 2}));
	assert.equal(controller.isRunActive(), true);

	controller.markEngineLost('Engine exited (1)');
	const task = controller.getActiveTask()!;
	assert.equal(controller.isRunActive(), false);
	assert.equal(task.transcript.awaitingCancelSettlement, false);
	assert.equal(task.transcript.activeRunId, undefined);
	assert.equal(controller.getAttachedSessionId(), null);
	const assistant = task.transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'error');
});

test('markEngineLost lease drop clears Attach but keeps the in-flight turn', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const row = controller.createTask('T');
	controller.acceptNewSession('sess', row.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 't1',
		clientMessageId: 't1',
		text: 'hello'
	}));
	controller.handleEvent(withSid('sess', {type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 2}));
	assert.equal(controller.isRunActive(), true);

	controller.markEngineLost('Connection lost (unknown)', {failTurns: false});
	const task = controller.getActiveTask()!;
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.getAttachedSessionId(), null);
	const assistant = task.transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'streaming');
});

test('requestOlderHistory sends FetchSessionHistory once while in flight', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'id-1',
		workspaceId: () => 'ws'
	});
	const histTask = controller.createTask('T');
	controller.acceptNewSession('sess', histTask.id);
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess',
		hasMoreOlder: true,
		totalTurnCount: 40,
		turns: [
			{turnId: 'restored_20', userText: 'u20', assistantText: 'a20', tools: []},
			{turnId: 'restored_21', userText: 'u21', assistantText: 'a21', tools: []}
		]
	});
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	sent.length = 0;
	assert.equal(controller.requestOlderHistory(), true);
	assert.equal(controller.requestOlderHistory(), false, 'single-flight while pending');
	const hist = sent.find(c => c.type === 'FetchSessionHistory');
	assert.ok(hist);
	if (hist?.type === 'FetchSessionHistory') {
		assert.equal(hist.sessionId, 'sess');
		assert.equal(hist.beforeTurnId, 'restored_20');
		assert.equal(hist.limit, 20);
	}

	controller.handleEvent({
		type: 'session_history_page',
		sessionId: 'sess',
		beforeTurnId: 'restored_20',
		hasMoreOlder: false,
		totalTurnCount: 40,
		turns: [{turnId: 'restored_0', userText: 'u0', assistantText: 'a0', tools: []}]
	});
	const users = controller
		.getActiveTask()!
		.transcript.entries.filter(e => e.role === 'user')
		.map(e => e.turnId);
	assert.deepEqual(users, ['restored_0', 'restored_20', 'restored_21']);
	assert.equal(controller.getActiveTask()!.transcript.hasMoreOlder, false);

	sent.length = 0;
	assert.equal(controller.requestOlderHistory(), false, 'no more older pages');
	assert.equal(sent.length, 0);
});

test('submitUserText does not sticky titleGenRequested when sendFn fails', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => false,
		createId: () => 'id-1'
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-fail', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-fail', clientId: 'cli'});
	assert.equal(controller.sendMessage('hello'), false);
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	// Fake input_accepted must not clear pending — send never registered titleGenRequested.
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-fail',
		clientMessageId: 'x',
		turnId: 'x'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
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
	assert.equal(transcript.awaitingCancelSettlement, true);
	const assistant = transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'cancelled');
});

test('busy turn sends skill slash as Bridge command (Session queues skillSlash)', () => {
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
	controller.acceptNewSession('sess-busy', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-busy', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	controller.handleEvent(withSid('sess-busy', {type: 'turn_started', turnId: 't1', text: 'first'}));
	sent.length = 0;
	assert.equal(controller.sendMessage('/explain-code look'), true);
	assert.equal(controller.getActiveTask()?.queue.length, 0);
	assert.ok(sent.some(c => c.type === 'command' && c.name === 'explain-code'));
	assert.ok(!sent.some(c => c.type === 'SubmitUserMessage'));
});

test('skill command_result error clears titleGenRequested so pending can retry', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	assert.equal(task.autoTitlePending, true);
	controller.acceptNewSession('sess-err', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-err', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	assert.equal(controller.sendMessage('/explain-code'), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'explain-code',
		message: "Unknown command: /explain-code (Skill 'explain-code' not found)",
		status: 'error',
		sessionId: 'sess-err'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	// Spurious input_accepted must not clear pending after error cleared sticky opt-in.
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-err',
		clientMessageId: 'x',
		turnId: 'x'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	sent.length = 0;
	assert.equal(controller.sendMessage('retry as normal message'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
	}
});

test('available:false catalog skill is not routed as slash', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-na', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-na', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'hidden-skill', description: 'nope', usage: '/hidden-skill', available: false}]
	});
	sent.length = 0;
	assert.equal(controller.sendMessage('/hidden-skill'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage'));
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'hidden-skill'));
});

test('unknown /xxx is SubmitUserMessage not Bridge command', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-u', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-u', clientId: 'cli'});
	sent.length = 0;
	assert.equal(controller.sendMessage('/not-a-real-skill please'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage'));
	assert.ok(!sent.some(c => c.type === 'command' && c.name === 'not-a-real-skill'));
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
		assert.equal(submit.text, '/not-a-real-skill please');
	}
});

test('skill slash with autoTitlePending sends command.generateTitle; input_accepted clears pending', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	assert.equal(task.autoTitlePending, true);
	controller.acceptNewSession('sess-sk', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-sk', clientId: 'cli'});
	controller.handleEvent({
		type: 'commands_available',
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	});
	sent.length = 0;
	assert.equal(controller.sendMessage('/explain-code look at auth'), true);
	const skillCmd = sent.find(c => c.type === 'command' && c.name === 'explain-code');
	assert.ok(skillCmd?.type === 'command');
	if (skillCmd?.type === 'command') {
		assert.equal(skillCmd.generateTitle, true);
		assert.equal(skillCmd.args, 'look at auth');
	}
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-sk',
		clientMessageId: 'x',
		turnId: 'x'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, false);
});

test('skill slash without generateTitle does not clear autoTitlePending on input_accepted', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-keep', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-keep', clientId: 'cli'});
	// First: /skills (fixed command, no generateTitle)
	sent.length = 0;
	assert.equal(controller.sendMessage('/skills'), true);
	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-keep',
		clientMessageId: 'x',
		turnId: 'x'
	});
	// /skills does not emit input_accepted in practice, but if it did pending must stay.
	assert.equal(controller.getActiveTask()?.autoTitlePending, true);
	sent.length = 0;
	assert.equal(controller.sendMessage('real first message'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
	}
});

test('autoTitlePending: New task Submit sends generateTitle; rename and title result clear/apply', () => {
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

	const task = controller.createTask('New task');
	assert.equal(task.autoTitlePending, true);

	controller.acceptNewSession('sess-1', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-1', clientId: 'cli'});
	assert.equal(controller.getActiveTask()?.sessionId, 'sess-1');
	assert.equal(controller.getActiveTask()?.pendingNew, false);

	sent.length = 0;
	assert.equal(controller.sendMessage('Fix the auth login flow please'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.generateTitle, true);
	}
	assert.equal(controller.getActiveTask()?.autoTitlePending, true, 'pending until input_accepted');

	controller.handleEvent({
		type: 'input_accepted',
		sessionId: 'sess-1',
		clientMessageId: 'id-1',
		turnId: 'id-1'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, false);

	sent.length = 0;
	assert.equal(controller.sendMessage('follow up'), true);
	const second = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(second?.type === 'SubmitUserMessage');
	if (second?.type === 'SubmitUserMessage') {
		assert.equal(second.generateTitle, undefined);
	}

	const task2 = controller.createTask('Another');
	controller.acceptNewSession('sess-2', task2.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-2', clientId: 'cli'});
	assert.equal(task2.autoTitlePending, true);
	assert.equal(controller.renameTask(task2.id, 'Manual name'), true);
	assert.equal(controller.getActiveTask()?.autoTitlePending, true, 'pending until rename succeeds');
	controller.handleEvent({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Manual name"',
		status: 'success',
		sessionId: 'sess-2',
		title: 'Manual name'
	});
	assert.equal(controller.getActiveTask()?.autoTitlePending, false);
	assert.equal(controller.getActiveTask()?.title, 'Manual name');

	controller.selectTask(task.id);
	controller.handleEvent({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Fix auth login"',
		status: 'success',
		sessionId: 'sess-1',
		title: 'Fix auth login'
	});
	assert.equal(controller.getActiveTask()?.title, 'Fix auth login');
});

test('hydrateFromMeta skips deleted sessions and drops matching local tasks', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-live', title: 'Keep', status: 'active', lastModified: '2026-07-20T00:00:02Z'},
		{id: 'sess-gone', title: 'Gone', status: 'deleted', lastModified: '2026-07-20T00:00:01Z'}
	]);
	assert.equal(controller.listTasks().length, 1);
	assert.equal(controller.listTasks()[0]?.sessionId, 'sess-live');

	controller.hydrateFromMeta([
		{id: 'sess-live', title: 'Keep', status: 'deleted', lastModified: '2026-07-20T00:00:03Z'}
	]);
	assert.equal(controller.listTasks().length, 0);
});

test('hydrateFromMeta overwrites in-memory auto title when Meta still has New task', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('New task');
	controller.acceptNewSession('sess-meta', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-meta', clientId: 'cli'});
	controller.handleEvent({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "每次股票推荐"',
		status: 'success',
		sessionId: 'sess-meta',
		title: '每次股票推荐'
	});
	assert.equal(controller.listTasks().find(t => t.id === task.id)?.title, '每次股票推荐');

	// Cold-start / late workspace_meta: Meta row still CreateSession placeholder.
	controller.hydrateFromMeta([
		{id: 'sess-meta', title: 'New task', lastModified: new Date().toISOString()}
	]);
	assert.equal(
		controller.listTasks().find(t => t.id === task.id)?.title,
		'New task',
		'evidence: hydrateFromMeta clobbers auto title whenever Meta still says New task'
	);
});

test('deleteTask soft-deletes after UpdateSessionStatus accepted and focuses next', async () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		projectId: () => 'proj-1',
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const older = controller.createTask('Older');
	controller.acceptNewSession('sess-older', older.id);
	const newer = controller.createTask('Newer');
	controller.acceptNewSession('sess-newer', newer.id);
	controller.selectTask(newer.id);

	const deletePromise = controller.deleteTask(newer.id);
	const statusCmd = sent.find(c => c.type === 'UpdateSessionStatus');
	assert.ok(statusCmd);
	if (statusCmd?.type === 'UpdateSessionStatus') {
		assert.equal(statusCmd.sessionId, 'sess-newer');
		assert.equal(statusCmd.status, 'deleted');
	}

	controller.handleEvent({
		type: 'command_result',
		name: 'UpdateSessionStatus',
		message: 'deleted',
		status: 'success',
		sessionId: 'sess-newer'
	});
	const result = await deletePromise;
	assert.equal(result.ok, true);
	assert.equal(controller.listTasks().some(t => t.id === newer.id), false);
	assert.equal(controller.getActiveTask()?.id, older.id);
});

test('deleteTask discards unbound pending create without Bridge status', async () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		projectId: () => 'proj-1',
		createId: () => 'pending-1'
	});
	const pending = controller.createTask('New task');
	assert.equal(pending.sessionId, null);
	sent.length = 0;
	const result = await controller.deleteTask(pending.id);
	assert.equal(result.ok, true);
	assert.equal(controller.listTasks().length, 0);
	assert.equal(
		sent.some(c => c.type === 'UpdateSessionStatus'),
		false
	);
});

test('deleteTask error keeps task and rejects waiter', async () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		projectId: () => 'proj-1',
		createId: () => 't1'
	});
	const task = controller.createTask('Keep');
	controller.acceptNewSession('sess-keep', task.id);
	const deletePromise = controller.deleteTask(task.id);
	controller.handleEvent({
		type: 'command_result',
		name: 'UpdateSessionStatus',
		message: 'boom',
		status: 'error',
		sessionId: 'sess-keep'
	});
	const result = await deletePromise;
	assert.equal(result.ok, false);
	assert.match(result.notice ?? '', /boom/);
	assert.equal(controller.listTasks().some(t => t.id === task.id), true);
});

test('acceptNewSession with workspaceId sends Bind before Attach', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-aw',
		workspaceId: () => 'hash-agent-work',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-new'
	});
	const task = controller.createTask('Bind first');
	sent.length = 0;
	controller.acceptNewSession('sess-new', task.id);
	const bindIdx = sent.findIndex(c => c.type === 'BindSessionWorkspace');
	const attachIdx = sent.findIndex(c => c.type === 'AttachSession');
	assert.ok(bindIdx >= 0, 'BindSessionWorkspace required');
	assert.ok(attachIdx >= 0, 'AttachSession required');
	assert.ok(bindIdx < attachIdx, 'Bind must precede Attach');
	const bind = sent[bindIdx];
	if (bind?.type === 'BindSessionWorkspace') {
		assert.equal(bind.sessionId, 'sess-new');
		assert.equal(bind.workspaceId, 'hash-agent-work');
	}
});

test('acceptNewSession without workspaceId requests Register and still Attaches', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-reg'
	});
	const task = controller.createTask('Needs register');
	sent.length = 0;
	registerCalls = 0;
	controller.acceptNewSession('sess-reg', task.id);
	assert.equal(registerCalls, 1);
	assert.equal(sent.find(c => c.type === 'BindSessionWorkspace'), undefined);
	assert.ok(sent.find(c => c.type === 'AttachSession'));
	assert.equal(controller.getActiveTask()?.sessionId, 'sess-reg');
});

test('createTask stamps path-hash workspaceId on CreateSession when Slot known', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'a1b2c3d4e5f6',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-no-ws'
	});
	controller.createTask('Has slot');
	const create = sent.find(c => c.type === 'CreateSession');
	assert.ok(create && create.type === 'CreateSession');
	if (create?.type === 'CreateSession') {
		assert.equal(create.workspaceId, 'a1b2c3d4e5f6');
	}
});

test('acceptNewSession Binds when engineBoundHash missing or mismatches', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'proj-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-bind-fallback'
	});
	const task = controller.createTask('Needs bind');
	sent.length = 0;
	controller.acceptNewSession('sess-boot', task.id, 'boot-hash');
	const bind = sent.find(c => c.type === 'BindSessionWorkspace');
	assert.ok(bind && bind.type === 'BindSessionWorkspace');
	if (bind?.type === 'BindSessionWorkspace') {
		assert.equal(bind.workspaceId, 'proj-hash');
	}
	assert.ok(sent.find(c => c.type === 'AttachSession'));
});

test('retryPendingNew is no-op when CreateSession already requested', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'hash-after-register',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-retry'
	});
	controller.createTask('Retry me');
	assert.equal(controller.getActiveTask()?.pendingNew, true);
	assert.equal(controller.getActiveTask()?.createRequested, true);
	sent.length = 0;
	assert.equal(controller.retryPendingNew(), false, 'must not double CreateSession');
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 0);
});

test('retryPendingNew sends once when create was waiting on projectId', () => {
	const sent: BridgeCommand[] = [];
	let projectId: string | undefined;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => projectId,
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-wait-proj'
	});
	controller.createTask('Wait for meta');
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 0);
	assert.equal(controller.getActiveTask()?.createRequested, false);
	projectId = 'proj-1';
	assert.equal(controller.retryPendingNew(), true);
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 1);
	assert.equal(controller.retryPendingNew(), false);
});

test('setRunMode / setModelSettings stick on Task and restore on selectTask', () => {
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
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setRunMode('plan'), true);
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'high',
		thinking: true
	}), true);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.equal(controller.getActiveTask()?.runMode, 'plan');

	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id, 'ws-1');
	assert.equal(controller.setRunMode('ask'), true);
	assert.equal(controller.runMode, 'ask');

	controller.selectTask(a.id);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.ok(sent.some(c => c.type === 'SetMode' && c.mode === 'plan'));
	assert.ok(sent.some(c => c.type === 'SetModelSettings'));
});

test('setEngineKind sticks on Task; CreateSession sends dsh only when selected', () => {
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
		createId: () => `id-${++n}`
	});
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');
	const a = controller.createTask('A');
	assert.equal(a.engineKind, 'dsh');
	const create = sent.find(c => c.type === 'CreateSession');
	assert.ok(create && create.type === 'CreateSession');
	if (create?.type === 'CreateSession') {
		assert.equal(create.engineKind, 'dsh');
	}
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setEngineKind('fast'), true);
	assert.equal(controller.engineKind, 'fast');
	assert.ok(sent.some(c => c.type === 'SetEngine' && c.engineId === 'fast'));
});

test('SetEngineKind rejected or error reverts optimistic engineKind', () => {
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
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.engineKind, 'fast');
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'busy',
		status: 'rejected',
		sessionId: 'sess-a'
	});
	assert.equal(controller.engineKind, 'fast');
	assert.equal(controller.getActiveTask()?.engineKind, 'fast');

	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.equal(controller.engineKind, 'dsh');
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'disk full',
		status: 'error',
		sessionId: 'sess-a'
	});
	assert.equal(controller.engineKind, 'fast');
	assert.equal(controller.getActiveTask()?.engineKind, 'fast');

	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'SetEngineKind',
		message: 'dsh',
		status: 'success',
		sessionId: 'sess-a'
	});
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(controller.getActiveTask()?.engineKind, 'dsh');
});

test('setEngineKind dsh without available does not send SetEngine and stays fast', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-1',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'id-1'
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setEngineKind('dsh'), false);
	assert.equal(controller.engineKind, 'fast');
	assert.ok(!sent.some(c => c.type === 'SetEngine'));
	controller.setAvailableEngines(['fast', 'dsh']);
	assert.equal(controller.setEngineKind('dsh'), true);
	assert.ok(sent.some(c => c.type === 'SetEngine' && c.engineId === 'dsh'));
});

test('hydrateFromSessionsList cold-restores runMode and model_settings', () => {
	let n = 0;
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: () => `id-${++n}`
	});
	controller.hydrateFromSessionsList([
		{
			id: 'sess-sticky',
			title: 'Sticky',
			lastModified: '2026-07-15T12:00:00.000Z',
			messageCount: 2,
			isCurrent: true,
			runMode: 'plan',
			engineKind: 'dsh',
			modelSettings: {
				platform: 'openrouter',
				model: 'claude-sonnet-4',
				effort: 'high',
				thinking: true
			}
		}
	]);
	assert.equal(controller.runMode, 'plan');
	assert.equal(controller.engineKind, 'dsh');
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, true);
	assert.equal(controller.model, 'openrouter/claude-sonnet-4');
	const task = controller.getActiveTask();
	assert.equal(task?.runMode, 'plan');
	assert.equal(task?.engineKind, 'dsh');
	assert.equal(task?.effort, 'high');
	assert.equal(task?.thinking, true);
});

test('hydrate omit effort/thinking keeps prior Task chrome', () => {
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
		createId: () => `id-${++n}`
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id, 'ws-1');
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'high',
		thinking: false
	}), true);
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, false);

	// Engine JSON omits None fields — re-hydrate must not wipe Off / effort.
	controller.hydrateFromSessionsList([
		{
			id: 'sess-a',
			title: 'A',
			lastModified: '2026-07-15T12:00:00.000Z',
			messageCount: 1,
			isCurrent: true,
			runMode: 'plan',
			modelSettings: {
				platform: 'openrouter',
				model: 'claude-sonnet-4'
			}
		}
	]);
	assert.equal(controller.getActiveTask()?.effort, 'high');
	assert.equal(controller.getActiveTask()?.thinking, false);
	controller.selectTask(a.id);
	assert.equal(controller.effort, 'high');
	assert.equal(controller.thinking, false);
	assert.equal(controller.runMode, 'plan');
});

test('selectTask to Off task does not emit SetModelSettings(true) from composer materialize path', () => {
	// Regression: DialogueComposer no longer persists thinking:true on mount.
	// Controller chrome for Off must survive focus switch without a sticky overwrite.
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
		createId: () => `id-${++n}`
	});
	const onTask = controller.createTask('On');
	controller.acceptNewSession('sess-on', onTask.id, 'ws-1');
	controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'medium',
		thinking: true
	});
	const offTask = controller.createTask('Off');
	controller.acceptNewSession('sess-off', offTask.id, 'ws-1');
	controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'low',
		thinking: false
	});
	sent.length = 0;
	controller.selectTask(offTask.id);
	assert.equal(controller.thinking, false);
	assert.equal(
		sent.filter(c => c.type === 'SetModelSettings' && c.thinking === true).length,
		0,
		'must not rewrite Off → On on selectTask'
	);
});

test('SubmitUserMessage includes sticky effort/thinking', () => {
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
		createId: () => `id-${++n}`
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-a', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: []
	});
	assert.equal(controller.setModelSettings({
		platform: 'openrouter',
		model: 'claude-sonnet-4',
		effort: 'xhigh',
		thinking: true
	}), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.effort, 'xhigh');
		assert.equal(submit.thinking, true);
	}
});

test('SubmitUserMessage defaults thinking=true when catalog supportsThinking and sticky unset', () => {
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
		createId: () => `id-${++n}`
	});
	const task = controller.createTask('A');
	controller.acceptNewSession('sess-a', task.id, 'ws-1');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: []
	});
	assert.equal(controller.requestModelList(), true);
	controller.handleEvent({
		type: 'command_result',
		name: 'model',
		message:
			'Current model: thinky\n\n* thinky | thinking=1 efforts=low,medium,high default=medium\n\nUsage: /model <name|alias>',
		status: 'success',
		sessionId: 'sess-a'
	});
	assert.equal(controller.thinking, undefined);
	assert.equal(controller.modelCatalog[0]?.supportsThinking, true);
	assert.equal(controller.model, 'thinky');
	sent.length = 0;
	assert.equal(controller.sendMessage('hello'), true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit?.type === 'SubmitUserMessage');
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.thinking, true);
	}
});

test('SessionController holds assistant_delta across a seq hole and does not Ack past it', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-a', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli-test'});
	controller.handleEvent(withSid('sess-a', {type: 'turn_started', turnId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent));
	sent.length = 0;
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 't1', text: 'c', eventSeq: 3} as BridgeEvent));
	const afterHole = controller.listTasks()[0]!;
	assert.doesNotMatch(afterHole.transcript.entries.map(e => e.text).join(''), /c/);
	assert.equal(afterHole.lastEventSeq, 1);
	assert.ok(sent.some(c => c.type === 'AttachSession' && c.lastEventSeq === 1));
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 't1', text: 'b', eventSeq: 2} as BridgeEvent));
	const done = controller.listTasks()[0]!;
	assert.equal(done.transcript.entries.find(e => e.role === 'assistant')?.text, 'bc');
	assert.equal(done.lastEventSeq, 3);
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

test('ready without eventSeq does not reset lastEventSeq', () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-a', task.id);
	const got = controller.listTasks()[0]!;
	got.lastEventSeq = 7;
	controller.handleEvent({type: 'ready', protocolVersion: 1});
	assert.equal(controller.listTasks()[0]!.lastEventSeq, 7);
});

function cueController() {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	return {controller, task};
}

test('turn_finished after a live run offers a completion cue once', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	assert.equal(controller.consumeCompletionCue(), null);
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
	assert.equal(controller.consumeCompletionCue(), null);
});

test('turn_finished success:false still cues; cancel does not', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: false}));
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: false});

	const again = cueController();
	again.controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	again.controller.handleEvent(withSid('sess', {type: 'turn_cancelled', turnId: 't1', reason: 'stop'}));
	assert.equal(again.controller.consumeCompletionCue(), null);
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

test('replay turn_finished without a live run does not cue', () => {
	const {controller} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(controller.consumeCompletionCue(), null);
});

test('run_done after a live run offers a completion cue', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(
		withSid('sess', {type: 'run_done', runId: 't1', success: true, summary: 'ok'})
	);
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
});

test('run_done then late turn_finished cues only once', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(
		withSid('sess', {type: 'run_done', runId: 't1', success: true, summary: 'ok'})
	);
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(controller.consumeCompletionCue(), null);
});

test('run_cancelled does not cue', () => {
	const {controller} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(withSid('sess', {type: 'run_cancelled', runId: 't1', reason: 'stop'}));
	assert.equal(controller.consumeCompletionCue(), null);
});

test('dsh_caps is stored; queue:false does not route DshQueue; Fast ignores unknown type', () => {
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
	assert.equal(sent.some(c => c.type === 'Queue' || c.type === 'DshQueue'), false);
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
	assert.ok(sent.some(c => c.type === 'Queue' && c.action === 'remove'));
	assert.equal(controller.dshSteer('nudge'), true);
	assert.ok(sent.some(c => c.type === 'Steer' && c.text === 'nudge'));
	assert.equal(controller.dshGoalAct('pause'), true);
	assert.ok(sent.some(c => c.type === 'Call' && c.method === 'goal.pause'));
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

