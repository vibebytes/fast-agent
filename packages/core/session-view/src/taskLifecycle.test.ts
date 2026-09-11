import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskLifecycle, type LifecycleTask, type SessionMetaInfo, type TaskLifecycleDeps} from './taskLifecycle';
import {createSessionAttachStore} from './sessionAttach';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

type Row = LifecycleTask;

function makeDeps(overrides: Partial<TaskLifecycleDeps<Row>> = {}) {
	const sent: BridgeCommand[] = [];
	const rows: Row[] = [];
	let idSeq = 0;
	let listOrderSeq = 1_000;
	const active = {id: null as string | null};
	const notices: string[] = [];
	let changeCount = 0;
	const attached = createSessionAttachStore();
	const noopKeys = {
		delete: () => true,
		has: () => false
	};
	const deps: TaskLifecycleDeps<Row> = {
		createId: () => `task-${++idSeq}`,
		now: () => 1_700_000_000_000,
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		projectId: () => 'proj-1',
		workspaceId: () => 'workspace:ws-1',
		requestRegister: () => undefined,
		requestAttach: (task, sessionId) => {
			task.sessionId = sessionId;
			task.pendingNew = false;
			attached.bind(sessionId);
		},
		selectTask: id => {
			active.id = id;
		},
		getActiveTask: () => rows.find(r => r.id === active.id) ?? null,
		getActiveTaskId: () => active.id,
		setActiveTaskId: id => {
			active.id = id;
		},
		setActiveEngineKind: () => undefined,
		setHelpNotice: n => notices.push(n),
		onChange: () => {
			changeCount++;
		},
		taskBySessionId: sid => rows.find(t => t.sessionId === sid) ?? null,
		taskRunActive: () => false,
		cancelRunForTask: () => undefined,
		forgetTask: () => undefined,
		attachedSessionIds: attached,
		seqBySession: noopKeys,
		buildEntry: (id, kind, title, listOrder) => {
			const row: Row = {
				id,
				title,
				kind,
				sessionId: null,
				listOrder,
				pendingNew: true
			};
			rows.push(row);
			return row;
		},
		...overrides
	};
	return {deps, sent, rows, notices, active, changeCount: () => changeCount};
}

const asEvent = (e: Record<string, unknown>) => e as unknown as BridgeEvent;

test('createTask mints one id, shares it with the row and the CreateSession payload', () => {
	const {deps, sent, rows} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Research');
	assert.equal(task.id, 'task-1');
	assert.equal(rows[0]!.id, task.id);
	assert.ok(lc.tasks.get(task.id) === task);
	const create = sent.find(c => c.type === 'CreateSession') as {taskId?: string};
	assert.equal(create.taskId, task.id);
	assert.equal(task.pendingNew, true);
});

test('CreateSession always carries engineKind so a fast picker never falls back to the Host default', () => {
	const {deps, sent} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Fast please');
	task.engineKind = 'fast';
	const create = sent.find(c => c.type === 'CreateSession') as {engineKind?: string};
	assert.equal(
		create.engineKind,
		'fast',
		'omitting engineKind lets the Host resolve its Registry default (dsh in YAML-overridden deployments)'
	);
});

test('CreateSession defaults an unset row engineKind to fast rather than omitting it', () => {
	const {deps, sent} = makeDeps();
	const lc = createTaskLifecycle(deps);
	lc.createTask('Unset');
	const create = sent.find(c => c.type === 'CreateSession') as {engineKind?: string};
	assert.equal(create.engineKind, 'fast');
});

test('CreateSession forwards an explicit dsh picker choice', () => {
	const {deps, sent} = makeDeps();
	const base = deps.buildEntry;
	deps.buildEntry = (id, kind, title, listOrder) => ({...base(id, kind, title, listOrder), engineKind: 'dsh'});
	const lc = createTaskLifecycle(deps);
	lc.createTask('Dsh please');
	const create = sent.find(c => c.type === 'CreateSession') as {engineKind?: string};
	assert.equal(create.engineKind, 'dsh');
});

test('retryPendingNew resends the same engineKind as the original create', () => {
	const {deps, sent} = makeDeps({projectId: () => undefined});
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Deferred fast');
	task.engineKind = 'fast';
	deps.projectId = () => 'proj-late';
	assert.equal(lc.retryPendingNew(), true);
	const create = sent.find(c => c.type === 'CreateSession') as {engineKind?: string};
	assert.equal(create.engineKind, 'fast');
});

test('createTask without projectId defers to requestRegister instead of sending', () => {
	const {deps, sent} = makeDeps({projectId: () => undefined});
	let registered = 0;
	deps.requestRegister = () => {
		registered++;
	};
	const lc = createTaskLifecycle(deps);
	lc.createTask('Later');
	assert.equal(registered, 1);
	assert.equal(sent.length, 0);
});

test('acceptNewSession binds exactly once and rejects unknown or already-bound tasks', () => {
	const {deps} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Bind me');
	task.pendingNew = true;
	assert.equal(lc.acceptNewSession('sess-a', task.id), task);
	assert.equal(task.sessionId, 'sess-a');
	assert.equal(lc.acceptNewSession('sess-b', task.id), null);
	assert.equal(lc.acceptNewSession('sess-c', 'missing'), null);
});

test('renameTask reverts on rejected SetSessionTitle and adopts engine title on success', () => {
	const {deps, notices} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Old');
	lc.acceptNewSession('sess-a', task.id);
	assert.equal(lc.renameTask(task.id, 'New'), true);
	assert.equal(task.title, 'New');
	lc.handleCommandResult(
		asEvent({type: 'command_result', name: 'SetSessionTitle', sessionId: 'sess-a', status: 'error'})
	);
	assert.equal(task.title, 'Old');
	assert.ok(notices.length > 0);
	assert.equal(lc.renameTask(task.id, 'Again'), true);
	lc.handleCommandResult(
		asEvent({
			type: 'command_result',
			name: 'SetSessionTitle',
			sessionId: 'sess-a',
			status: 'accepted',
			title: 'Engine Title '
		})
	);
	assert.equal(task.title, 'Engine Title');
});

test('deleteTask discards an unbound pending create via failPendingCreate', async () => {
	const {deps, active} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Ephemeral');
	const result = await lc.deleteTask(task.id);
	assert.deepEqual(result, {ok: true});
	assert.equal(lc.tasks.has(task.id), false);
	assert.equal(active.id, null);
});

test('settleDelete removes the task, clears session bookkeeping and refocuses sibling', async () => {
	const {deps, active, rows} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const first = lc.createTask('First');
	lc.acceptNewSession('sess-a', first.id);
	const second = lc.createTask('Second');
	lc.acceptNewSession('sess-b', second.id);
	deps.selectTask(second.id);
	deps.attachedSessionIds.bind('sess-b');
	const deleting = lc.deleteTask(second.id);
	lc.handleCommandResult(
		asEvent({type: 'command_result', name: 'UpdateSessionStatus', sessionId: 'sess-b', status: 'accepted'})
	);
	assert.deepEqual(await deleting, {ok: true});
	assert.equal(lc.tasks.has(second.id), false);
	assert.equal(deps.attachedSessionIds.isAttached('sess-b'), false);
	assert.equal(active.id, first.id);
});

test('settleDelete with error keeps the task and surfaces the notice', async () => {
	const {deps, notices} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Keep');
	lc.acceptNewSession('sess-a', task.id);
	const deleting = lc.deleteTask(task.id);
	lc.handleCommandResult(
		asEvent({
			type: 'command_result',
			name: 'UpdateSessionStatus',
			sessionId: 'sess-a',
			status: 'error',
			message: 'busy'
		})
	);
	assert.deepEqual(await deleting, {ok: false, notice: 'busy'});
	assert.ok(lc.tasks.has(task.id));
	assert.ok(notices.includes('busy'));
});

test('deleteTask resolves with timeout notice when Engine never settles', async () => {
	const {deps} = makeDeps({deleteWaitMs: 10});
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Stuck');
	lc.acceptNewSession('sess-a', task.id);
	const deleting = lc.deleteTask(task.id);
	await new Promise(resolve => setTimeout(resolve, 40));
	assert.deepEqual(await deleting, {ok: false, notice: 'Delete timed out'});
	assert.ok(lc.tasks.has(task.id));
});

test('rejectPendingDeletes resolves every waiter without removing tasks', async () => {
	const {deps} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('X');
	lc.acceptNewSession('sess-a', task.id);
	const deleting = lc.deleteTask(task.id);
	lc.rejectPendingDeletes('Engine not connected');
	assert.deepEqual(await deleting, {ok: false, notice: 'Engine not connected'});
	assert.ok(lc.tasks.has(task.id));
	const again = await lc.deleteTask(task.id);
	assert.equal(again.ok, false);
});

test('retryPendingNew resends CreateSession once and guards against duplicates', () => {
	const {deps, sent} = makeDeps({projectId: () => undefined});
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Deferred');
	assert.equal(task.createRequested, undefined);
	deps.projectId = () => 'proj-late';
	assert.equal(lc.retryPendingNew(), true);
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 1);
	assert.equal(task.createRequested, true);
	assert.equal(lc.retryPendingNew(), false);
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 1);
});

test('SetEngineKind rejected result reverts staged engineKind', () => {
	const {deps} = makeDeps();
	const reverted: string[] = [];
	deps.setActiveEngineKind = k => reverted.push(k);
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Eng');
	lc.acceptNewSession('sess-a', task.id);
	task.engineKind = 'fast';
	lc.stageEngineChange('sess-a', 'fast');
	task.engineKind = 'dsh';
	const stop = lc.handleCommandResult(
		asEvent({type: 'command_result', name: 'SetEngineKind', sessionId: 'sess-a', status: 'rejected'})
	);
	assert.equal(stop.stop, true);
	assert.equal(task.engineKind, 'fast');
	assert.deepEqual(reverted, ['fast']);
});

test('hydrateSessions upserts stubs, selects isCurrent and restores chrome', () => {
	const {deps} = makeDeps();
	const lc = createTaskLifecycle(deps);
	deps.taskBySessionId = sid => {
		for (const t of lc.tasks.values()) if (t.sessionId === sid) return t;
		return null;
	};
	const restored: string[] = [];
	const opts = {
		model: () => 'm-1',
		modelDisplay: () => 'Model One',
		applyStickyChrome: () => undefined,
		buildStub: (id: string, info: SessionMetaInfo, listOrder: number, model: string) => ({
			id,
			title: info.title?.trim() || info.id.slice(0, 8),
			kind: 'task' as const,
			sessionId: info.id,
			listOrder,
			pendingNew: false,
			model
		}),
		restoreChrome: (task: Row) => restored.push(task.id)
	};
	lc.hydrateSessions(
		[
			{id: 'sess-b', title: '  Beta ', lastModified: iso(1_600_000_001_000)},
			{id: 'sess-a', title: 'Alpha', lastModified: iso(1_600_000_002_000), isCurrent: true}
		],
		opts
	);
	assert.equal(lc.tasks.size, 2);
	const alpha = deps.taskBySessionId('sess-a');
	const beta = deps.taskBySessionId('sess-b');
	assert.ok(alpha && beta);
	assert.equal(alpha.title, 'Alpha');
	assert.equal(alpha.listOrder, 1_600_000_002_000);
	assert.equal(beta!.listOrder, 1_600_000_001_000);
	assert.equal(deps.getActiveTaskId(), alpha.id);
	assert.deepEqual(restored, [alpha.id]);

	lc.hydrateSessions([{id: 'sess-a', title: 'Renamed', lastModified: iso(1_600_000_003_000)}], opts);
	assert.equal(lc.tasks.size, 2);
	assert.equal(deps.taskBySessionId('sess-a')!.title, 'Renamed');
	assert.equal(deps.taskBySessionId('sess-a')!.lastModified, iso(1_600_000_003_000));
});

test('hydrateSessions drops deleted sessions and never claims unbound pending rows', () => {
	const {deps} = makeDeps();
	const lc = createTaskLifecycle(deps);
	deps.taskBySessionId = sid => {
		for (const t of lc.tasks.values()) if (t.sessionId === sid) return t;
		return null;
	};
	const opts = {
		model: () => 'm-1',
		modelDisplay: () => 'Model One',
		applyStickyChrome: () => undefined,
		buildStub: (id: string, info: SessionMetaInfo, listOrder: number, model: string) => ({
			id,
			title: info.title ?? info.id,
			kind: 'task' as const,
			sessionId: info.id,
			listOrder,
			pendingNew: false,
			model
		}),
		restoreChrome: () => undefined
	};
	const optimistic = lc.createTask('Optimistic');
	lc.hydrateSessions([{id: 'sess-a', title: 'A', lastModified: iso(1)}], opts);
	assert.ok(deps.taskBySessionId('sess-a'));
	assert.equal(optimistic.pendingNew, true);
	assert.equal(optimistic.sessionId, null);

	lc.hydrateSessions([{id: 'sess-a', status: 'deleted'}], opts);
	assert.equal(deps.taskBySessionId('sess-a'), null);
	assert.ok(lc.tasks.has(optimistic.id));
	assert.equal(deps.getActiveTaskId(), optimistic.id);
});

test('reset clears tasks, pending title/engine staging and attach bookkeeping', () => {
	const {deps} = makeDeps();
	const lc = createTaskLifecycle(deps);
	const task = lc.createTask('Doomed');
	lc.acceptNewSession('sess-a', task.id);
	lc.stageEngineChange('sess-a', 'dsh');
	lc.reset();
	assert.equal(lc.tasks.size, 0);

	const again = lc.createTask('Fresh');
	again.engineKind = 'dsh';
	lc.acceptNewSession('sess-a', again.id);
	const stop = lc.handleCommandResult(
		asEvent({type: 'command_result', name: 'SetEngineKind', sessionId: 'sess-a', status: 'rejected'})
	);
	assert.equal(stop.stop, true);
	assert.equal(again.engineKind, 'dsh', 'stale staged engine must not survive reset');
});

function iso(millis: number): string {
	return new Date(millis).toISOString();
}
