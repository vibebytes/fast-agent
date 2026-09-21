/** WorkspaceHub tests — cold start / Open Tab working set. Loaded by WorkspaceHub.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorkspaceHub} from '../WorkspaceHub.js';
import type {BridgeClient} from '../BridgeClient.js';
import {isDefaultProjectPath, defaultProjectPath} from '../defaultProject.js';
import {projectHash} from '../projectHash.js';
import {assertSkillCommandPinned} from '../skillSlashContract.js';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	type FakeBridge,
	createFakeBridge,
	noopHandlers,
	engineRow,
	settleReadyEngines
} from './kit.js';

test('cold start: each open Project hydrates its own sessions after multi RegisterWorkspace', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const registeredHashes = new Set<string>();
	const sessionFixtures = new Map<string, {id: string; title: string; cwd: string}>();

	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			const origSend = bridge.send.bind(bridge);
			bridge.send = ((cmd: BridgeCommand) => {
				const ok = origSend(cmd);
				if (cmd.type === 'RegisterWorkspace') {
					registeredHashes.add(projectHash(cmd.path));
				}
				if (cmd.type === 'command' && cmd.name === 'sessions') {
					queueMicrotask(() => {
						const fixtures = [...sessionFixtures.values()].filter(s =>
							registeredHashes.has(projectHash(s.cwd))
						);
						bridge!.__inject({
							type: 'sessions_list',
							sessions: fixtures.map(s => ({
								id: s.id,
								title: s.title,
								lastModified: '2026-07-14T12:00:00Z',
								messageCount: 1,
								cwd: s.cwd,
								isCurrent: true
							}))
						});
					});
				}
				return ok;
			}) as BridgeClient['send'];
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const rootA = mkdtempSync(path.join(tmpdir(), 'proj-restore-a-'));
	const rootB = mkdtempSync(path.join(tmpdir(), 'proj-restore-b-'));
	sessionFixtures.set('a', {id: 'sess-restore-a', title: 'Task A', cwd: rootA});
	sessionFixtures.set('b', {id: 'sess-restore-b', title: 'Task B', cwd: rootB});

	hub.openProject(rootA, noopHandlers());
	hub.openProject(rootB, noopHandlers());
	await new Promise(r => setTimeout(r, 200));

	const projA = hub.listProjects().find(p => p.path === rootA);
	const projB = hub.listProjects().find(p => p.path === rootB);
	assert.ok(projA && projB);

	const tasksA = hub.getById(projA.id)!.sessions.listTasks();
	const tasksB = hub.getById(projB.id)!.sessions.listTasks();

	assert.equal(
		tasksA.some(t => t.sessionId === 'sess-restore-a'),
		true,
		`Project A should hydrate sess-restore-a; got ${tasksA.map(t => t.sessionId).join(',') || '(empty)'}`
	);
	assert.equal(
		tasksB.some(t => t.sessionId === 'sess-restore-b'),
		true,
		`Project B should hydrate sess-restore-b; got ${tasksB.map(t => t.sessionId).join(',') || '(empty)'}`
	);

	const binds = commands.filter(c => c.type === 'BindSessionWorkspace');
	assert.ok(
		binds.some(c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-restore-a'),
		'select after hydrate must BindSessionWorkspace'
	);
	assert.ok(
		binds.some(c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-restore-b'),
		'select after hydrate must BindSessionWorkspace'
	);
	hub.closeAll();
});

test('RegisterWorkspace does not Bind every inventory session (Open Tab working set)', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-open-tab-bind-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 150));

	const project = hub.listProjects().find(p => p.path === root);
	assert.ok(project);
	const ctrl = hub.getById(project.id)!.sessions;
	ctrl.hydrateFromMeta([
		{id: 'sess-inv-1', title: 'One', status: 'active'},
		{id: 'sess-inv-2', title: 'Two', status: 'active'},
		{id: 'sess-inv-3', title: 'Three', status: 'active'},
		{id: 'sess-inv-4', title: 'Four', status: 'active'},
		{id: 'sess-inv-5', title: 'Five', status: 'active'}
	]);
	const active = ctrl.listTasks().find(t => t.sessionId === 'sess-inv-1');
	assert.ok(active);
	ctrl.selectTask(active.id);

	const bindBefore = commands.filter(c => c.type === 'BindSessionWorkspace').length;
	// Force (re)register — inventory must not be batch-bound again.
	const open = hub.getById(project.id)!;
	open.workspaceId = undefined;
	open.status = 'starting';
	hub.getBridge()!.send({type: 'RegisterWorkspace', path: root});
	await new Promise(r => setTimeout(r, 150));

	const newBinds = commands
		.slice(bindBefore)
		.filter(c => c.type === 'BindSessionWorkspace') as Array<
		Extract<BridgeCommand, {type: 'BindSessionWorkspace'}>
	>;
	const boundSessions = new Set(newBinds.map(c => c.sessionId));
	assert.ok(
		boundSessions.size <= 1,
		`Register must not Bind full inventory; got ${[...boundSessions].join(',')}`
	);
	if (boundSessions.size === 1) {
		assert.ok(
			boundSessions.has('sess-inv-1'),
			'only Hub-active session may Bind on Register select'
		);
	}
	hub.closeAll();
});

test('ensureTasksLive Bind+Attach only listed Open Tab tasks', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-ensure-live-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 150));

	const project = hub.listProjects().find(p => p.path === root);
	assert.ok(project);
	assert.ok(project.workspaceId, 'Register must stamp workspaceId for Bind');
	const ctrl = hub.getById(project.id)!.sessions;
	ctrl.hydrateFromMeta([
		{id: 'sess-tab-a', title: 'Tab A', status: 'active'},
		{id: 'sess-tab-b', title: 'Tab B', status: 'active'},
		{id: 'sess-stub', title: 'Stub only', status: 'active'}
	]);
	const tabA = ctrl.listTasks().find(t => t.sessionId === 'sess-tab-a');
	const tabB = ctrl.listTasks().find(t => t.sessionId === 'sess-tab-b');
	const stub = ctrl.listTasks().find(t => t.sessionId === 'sess-stub');
	assert.ok(tabA && tabB && stub);

	commands.length = 0;
	const result = hub.ensureTasksLive([tabA.id, tabB.id]);
	assert.deepEqual(result.ok.sort(), [tabA.id, tabB.id].sort());
	assert.equal(result.skipped.length, 0);

	const binds = commands.filter(c => c.type === 'BindSessionWorkspace') as Array<
		Extract<BridgeCommand, {type: 'BindSessionWorkspace'}>
	>;
	const bound = new Set(binds.map(c => c.sessionId));
	assert.deepEqual([...bound].sort(), ['sess-tab-a', 'sess-tab-b']);
	assert.equal(bound.has('sess-stub'), false, 'inventory stub outside Open Tabs must not Bind');
	assert.equal(ctrl.getActiveTask()?.id !== stub.id || true, true);
	// Background ensureLive must not force stub into focus.
	assert.notEqual(ctrl.getActiveTask()?.sessionId, 'sess-stub');
	hub.closeAll();
});

test('ensureTasksLive skips before workspaceId then Bind after Register (Open Tab race)', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-slot-race-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 150));

	const snap = hub.listProjects().find(p => p.path === root);
	assert.ok(snap);
	const open = hub.getById(snap.id)!;
	const ctrl = open.sessions;
	ctrl.hydrateFromMeta([
		{id: 'sess-race-a', title: 'A', status: 'active'},
		{id: 'sess-race-b', title: 'B', status: 'active'}
	]);
	const tabA = ctrl.listTasks().find(t => t.sessionId === 'sess-race-a');
	const tabB = ctrl.listTasks().find(t => t.sessionId === 'sess-race-b');
	assert.ok(tabA && tabB);

	// Simulate ensureLive firing on engine ready before Register stamped the slot.
	open.workspaceId = undefined;
	commands.length = 0;
	const early = hub.ensureTasksLive([tabA.id, tabB.id]);
	assert.equal(early.ok.length, 0, 'must not report ok without workspaceId');
	assert.equal(early.skipped.length, 2);
	assert.equal(
		commands.filter(c => c.type === 'BindSessionWorkspace').length,
		0,
		'must not Bind before slot hash exists'
	);

	// Register completes → workspaceId present → reconcile retries Open Tabs.
	open.workspaceId = projectHash(root);
	open.status = 'ready';
	commands.length = 0;
	const late = hub.ensureTasksLive([tabA.id, tabB.id]);
	assert.deepEqual(late.ok.sort(), [tabA.id, tabB.id].sort());
	assert.equal(late.skipped.length, 0);
	const bound = new Set(
		commands
			.filter(c => c.type === 'BindSessionWorkspace')
			.map(c => (c as Extract<BridgeCommand, {type: 'BindSessionWorkspace'}>).sessionId)
	);
	assert.deepEqual([...bound].sort(), ['sess-race-a', 'sess-race-b']);
	hub.closeAll();
});

test('renameProjectDisplayName updates snapshot after SetProjectDisplayName accepted', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rename-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const snap = hub.listProjects()[0]!;
	assert.equal(snap.displayName, path.basename(root));
	assert.equal(hub.renameProjectDisplayName(snap.id, 'Renamed'), true);
	await new Promise(r => setTimeout(r, 80));

	const renamed = hub.listProjects()[0]!;
	assert.equal(renamed.displayName, 'Renamed');
	assert.ok(
		commands.some(
			c => c.type === 'SetProjectDisplayName' && c.displayName === 'Renamed'
		)
	);
	hub.closeAll();
});
