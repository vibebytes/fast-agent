import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskLifecycle, type LifecycleTask, type TaskLifecycleDeps} from './taskLifecycle';
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
	const attached = new Set<string>();
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
			attached.add(sessionId);
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
	deps.attachedSessionIds.add('sess-b');
	const deleting = lc.deleteTask(second.id);
	lc.handleCommandResult(
		asEvent({type: 'command_result', name: 'UpdateSessionStatus', sessionId: 'sess-b', status: 'accepted'})
	);
	assert.deepEqual(await deleting, {ok: true});
	assert.equal(lc.tasks.has(second.id), false);
	assert.equal(deps.attachedSessionIds.has('sess-b'), false);
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
