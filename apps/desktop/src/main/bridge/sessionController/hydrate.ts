/** SessionController tests — glue lifecycle / hydrate / delete. Loaded by SessionController.test.ts. */
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
