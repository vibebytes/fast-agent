/** WorkspaceHub tests — sessions_list / NewSession / event demux. Loaded by WorkspaceHub.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorkspaceHub} from '../WorkspaceHub.js';
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

test('open folder Project sends CreateProject; open-set no longer authoritative', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	hub.openProject(a, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	assert.equal(hub.persistOpenProjectSet(), false);
	assert.ok(commands.some(c => c.type === 'CreateProject'));
	assert.ok(commands.some(c => c.type === 'GetWorkspaceMeta'));
	assert.equal(commands.filter(c => c.type === 'SetOpenProjectSet').length, 0);
	assert.equal(hub.listProjects().length, 1);
	hub.closeAll();
});

test('sessions_list for a Project ignores sessions from another cwd', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const root = mkdtempSync(path.join(tmpdir(), 'proj-eeee-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const project = hub.getById(hub.listProjects()[0]!.id)!;
	assert.equal(project.sessions.listTasks().length, 0);

	bridge!.__inject({
		type: 'sessions_list',
		sessions: [
			{
				id: 'sess-foreign-1',
				title: 'New task',
				lastModified: '2026-07-14T10:00:00Z',
				messageCount: 1,
				cwd: '/some/other/project'
			},
			{
				id: 'sess-foreign-2',
				title: 'New task',
				lastModified: '2026-07-14T11:00:00Z',
				messageCount: 1,
				cwd: path.join(hub.getDefaultProject()?.path ?? '/tmp', 'nope')
			},
			{
				id: 'sess-mine',
				title: 'Real one',
				lastModified: '2026-07-14T12:00:00Z',
				messageCount: 2,
				cwd: root,
				isCurrent: true
			}
		]
	});
	await new Promise(r => setTimeout(r, 40));

	const tasks = project.sessions.listTasks();
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0]?.title, 'Real one');
	assert.equal(tasks[0]?.sessionId, 'sess-mine');
	hub.closeAll();
});

test('empty sessions_list hydrates only the oldest pending Project', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const rootA = mkdtempSync(path.join(tmpdir(), 'proj-empty-a-'));
	const rootB = mkdtempSync(path.join(tmpdir(), 'proj-empty-b-'));
	hub.openProject(rootA, noopHandlers());
	hub.openProject(rootB, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const projA = hub.listProjects().find(p => p.path === rootA)!;
	const projB = hub.listProjects().find(p => p.path === rootB)!;
	const sessionsA = hub.getById(projA.id)!.sessions;
	const sessionsB = hub.getById(projB.id)!.sessions;
	assert.equal(sessionsA.tasksHydrated, false);
	assert.equal(sessionsB.tasksHydrated, false);

	bridge!.__inject({type: 'sessions_list', sessions: []});
	await new Promise(r => setTimeout(r, 40));

	assert.equal(sessionsA.tasksHydrated, true);
	assert.equal(sessionsB.tasksHydrated, false);

	bridge!.__inject({type: 'sessions_list', sessions: []});
	await new Promise(r => setTimeout(r, 40));
	assert.equal(sessionsB.tasksHydrated, true);
	hub.closeAll();
});

test('restore-style multi-Project open then sessions_list hydrates each by cwd (not only active)', async () => {
	// Historical: early-opened Project looked empty after restart because hydrate
	// must match every Project by cwd, not only the focused one.
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const early = mkdtempSync(path.join(tmpdir(), 'proj-early-'));
	const later = mkdtempSync(path.join(tmpdir(), 'proj-later-'));
	hub.openProject(early, noopHandlers());
	hub.openProject(later, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	hub.focusProject(hub.listProjects().find(p => p.path === later)!.id);
	assert.equal(hub.getActive()?.path, later);

	bridge!.__inject({
		type: 'sessions_list',
		sessions: [
			{
				id: 'sess-early',
				title: 'Early task',
				lastModified: '2026-07-14T09:00:00Z',
				messageCount: 3,
				cwd: early
			},
			{
				id: 'sess-later',
				title: 'Later task',
				lastModified: '2026-07-14T10:00:00Z',
				messageCount: 1,
				cwd: later,
				isCurrent: true
			}
		]
	});
	await new Promise(r => setTimeout(r, 40));

	const earlyTasks = hub.getById(hub.listProjects().find(p => p.path === early)!.id)!.sessions.listTasks();
	const laterTasks = hub.getById(hub.listProjects().find(p => p.path === later)!.id)!.sessions.listTasks();
	assert.equal(earlyTasks.length, 1, 'early Project must hydrate even when not focused');
	assert.equal(earlyTasks[0]?.title, 'Early task');
	assert.equal(laterTasks.length, 1);
	assert.equal(laterTasks[0]?.title, 'Later task');
	hub.closeAll();
});

test('NewSession demuxes by path hash when workspaceId stamp was cleared', async () => {
	const commands: BridgeCommand[] = [];
	const errors: Array<{message: string; code?: string}> = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const root = mkdtempSync(path.join(tmpdir(), 'proj-race-'));
	hub.openProject(root, {
		...noopHandlers(),
		onError(_id, message, meta) {
			if (message.trim() || meta?.code) errors.push({message, code: meta?.code});
		}
	});
	await new Promise(r => setTimeout(r, 80));

	const project = hub.getById(hub.listProjects()[0]!.id)!;
	assert.ok(project.workspaceId);
	const hash = project.workspaceId!;
	// Clear Meta stamp so createTask stays unbound (no CreateSession); then NewSession binds by taskId + path hash.
	project.metaProjectId = undefined;
	const raceTask = project.sessions.createTask('Race task');
	assert.equal(raceTask.sessionId, null);
	project.workspaceId = undefined;
	bridge!.__inject({
		type: 'command_result',
		name: 'NewSession',
		message: 'Started session deadbeef.',
		status: 'accepted',
		sessionId: 'sess-race-1',
		workspaceId: hash,
		taskId: raceTask.id
	});
	await new Promise(r => setTimeout(r, 40));

	assert.equal(
		errors.filter(
			e => e.code === 'session.create_failed' || e.code === 'session.create_failed_detail'
		).length,
		0,
		JSON.stringify(errors)
	);
	assert.equal(project.workspaceId, hash);
	assert.equal(project.sessions.getActiveTask()?.sessionId, 'sess-race-1');
	hub.closeAll();
});

test('NewSession results demux by workspaceId when another Project is focused', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const projA = hub.getById(hub.listProjects().find(p => p.path === a)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === b)!.id)!;
	hub.focusProject(projB.id);
	assert.ok(projA.metaProjectId, 'CreateProject should stamp metaProjectId');
	projA.sessions.createTask('A task');
	await new Promise(r => setTimeout(r, 80));

	assert.ok(projA.sessions.getActiveTask()?.sessionId);
	assert.equal(projB.sessions.getActiveTask()?.sessionId ?? null, null);
	// Teams「安排任务」passes Meta project id — must resolve to the same OpenProject.
	assert.equal(hub.projectByMetaId(projA.metaProjectId!)?.id, projA.id);
	hub.closeAll();
});
test('workspace_meta pathHash still RegisterWorkspace for a live local folder', async () => {
	const commands: BridgeCommand[] = [];
	const root = mkdtempSync(path.join(tmpdir(), 'meta-folder-'));
	const bridge = createFakeBridge(commands);
	const hub = new WorkspaceHub({
		createBridge: () => bridge,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	hub.ensureEngine(noopHandlers());
	await new Promise(r => setTimeout(r, 60));
	bridge.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-live',
				projectType: 'coding',
				displayName: 'live',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-live',
					placement: 'local',
					rootPath: root,
					pathHash: projectHash(root)
				}
			}
		],
		sessionsByProjectId: {}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	assert.ok(
		commands.some(c => c.type === 'RegisterWorkspace' && c.path === root),
		'Meta pathHash must not skip Slot claim on a live folder'
	);
	hub.closeAll();
});
test('session-scoped Attached routes to owning Project even when another is focused', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;

	const taskA = projA.sessions.createTask('Task A');
	projA.sessions.acceptNewSession('sess-a', taskA.id);
	assert.equal(projA.sessions.getActiveTask()?.sessionId, 'sess-a');

	const taskB = projB.sessions.createTask('Task B');
	projB.sessions.acceptNewSession('sess-b', taskB.id);

	hub.focusProject(projB.id);
	assert.equal(hub.getActive()?.id, projB.id);

	bridge!.__inject({
		type: 'Attached',
		sessionId: 'sess-a',
		clientId: projA.clientId
	});
	await new Promise(r => setTimeout(r, 30));

	assert.equal(projA.sessions.getAttachedSessionId(), 'sess-a');
	assert.notEqual(projB.sessions.getAttachedSessionId(), 'sess-a');
	hub.closeAll();
});

test('closeProject skips UnregisterWorkspace while a Turn is in flight', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const root = mkdtempSync(path.join(tmpdir(), 'proj-close-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const project = hub.getById(hub.listProjects()[0]!.id)!;
	project.sessions.createTask('Running');
	await new Promise(r => setTimeout(r, 40));
	const sid = project.sessions.getActiveTask()?.sessionId;
	assert.ok(sid);
	project.sessions.handleEvent({type: 'Attached', sessionId: sid!, clientId: project.clientId});
	project.sessions.handleEvent({
		type: 'turn_started',
		eventSeq: 1,
		turnId: 't1',
		clientMessageId: 't1',
		text: 'go',
		sessionId: sid
	} as BridgeEvent);
	assert.equal(project.sessions.isRunActive(), true);

	const before = commands.filter(c => c.type === 'UnregisterWorkspace').length;
	hub.closeProject(project.id);
	const after = commands.filter(c => c.type === 'UnregisterWorkspace').length;
	assert.equal(after, before, 'must not Unregister while Turn in flight');
	hub.closeAll();
});

test('RegisterWorkspace stamps each Project by path hash, not focus order', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'hash-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'hash-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const projA = hub.getById(hub.listProjects().find(p => p.path === a)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === b)!.id)!;
	assert.equal(projA.workspaceId, projectHash(a));
	assert.equal(projB.workspaceId, projectHash(b));
	assert.notEqual(projA.workspaceId, projB.workspaceId);
	hub.closeAll();
});

/**
 * Feedback loop for "different Projects' transcripts mix".
 *
 * Engine Bridge emits stream events (assistant_delta / …) without sessionId
 * (JsonEvents.assistantDelta). Hub falls back to getActive(), so a background
 * turn's deltas paint onto whichever Project is focused.
 *
 * Asserts correct isolation — RED while the demux bug remains.
 */
test('unsigned assistant_delta must not contaminate the focused Project (cross-project mix)', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;

	const _bind1 = projA.sessions.createTask('Task A');
	projA.sessions.acceptNewSession('sess-a', _bind1.id);
	projA.sessions.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: projA.clientId});
	projA.sessions.handleEvent({
		type: 'turn_started',
		turnId: 'turn-a',
		clientMessageId: 'turn-a',
		text: 'ask A'
	});

	const _bind2 = projB.sessions.createTask('Task B');
	projB.sessions.acceptNewSession('sess-b', _bind2.id);
	projB.sessions.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: projB.clientId});
	projB.sessions.handleEvent({
		type: 'turn_started',
		turnId: 'turn-b',
		clientMessageId: 'turn-b',
		text: 'ask B'
	});

	hub.focusProject(projB.id);
	assert.equal(hub.getActive()?.id, projB.id);
	assert.equal(projA.sessions.getAttachedSessionId(), 'sess-a');
	assert.equal(projB.sessions.getAttachedSessionId(), 'sess-b');

	// Mirror Engine JsonEvents.assistantDelta — no sessionId field.
	bridge!.__inject({
		type: 'assistant_delta',
		turnId: 'turn-a',
		text: 'SECRET_FROM_PROJECT_A'
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	const textA = projA.sessions
		.getActiveTask()!
		.transcript.entries.map(e => e.text)
		.join('');
	const textB = projB.sessions
		.getActiveTask()!
		.transcript.entries.map(e => e.text)
		.join('');

	// Unsigned stream is dropped (never getActive fallback) — neither Project absorbs it.
	assert.doesNotMatch(
		textB,
		/SECRET_FROM_PROJECT_A/,
		`Project B must not show Project A stream; got B transcript=${JSON.stringify(textB)}`
	);
	assert.doesNotMatch(
		textA,
		/SECRET_FROM_PROJECT_A/,
		`Unsigned stream must be dropped, not painted on A; got A transcript=${JSON.stringify(textA)}`
	);

	hub.closeAll();
});

/**
 * P0-3: `error` with sessionId is a session-scoped failure and must ride the
 * SESSION_STREAM demux into the owning Project's SessionController; only
 * sessionId-less errors (host-level command failures) stay on the host path.
 */
test('error with sessionId routes to the owning session; without sessionId stays host-level', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'err-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'err-b-'));
	const seen: Array<{projectId: string; type: string}> = [];
	const watching = () => ({
		onEvent: (projectId: string, event: BridgeEvent) => seen.push({projectId, type: event.type}),
		onError: () => {},
		onExit: () => {}
	});
	hub.openProject(a, watching());
	hub.openProject(b, watching());
	await new Promise(r => setTimeout(r, 120));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;

	const bind = projA.sessions.createTask('Task A');
	projA.sessions.acceptNewSession('sess-err', bind.id);
	projA.sessions.handleEvent({type: 'Attached', sessionId: 'sess-err', clientId: projA.clientId});

	// Route errors to Project A while B is focused — demux must win over getActive().
	hub.focusProject(projB.id);
	seen.length = 0;

	bridge!.__inject({
		type: 'error',
		sessionId: 'sess-err',
		message: 'engine blew up mid-turn'
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	assert.deepEqual(
		seen.filter(e => e.type === 'error'),
		[{projectId: projA.id, type: 'error'}],
		`sessionId error must reach owning Project only; got ${JSON.stringify(seen)}`
	);

	seen.length = 0;
	bridge!.__inject({type: 'error', message: 'host command failed'} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	assert.deepEqual(
		seen.filter(e => e.type === 'error'),
		[{projectId: 'engine', type: 'error'}],
		`sessionId-less error must stay host-level; got ${JSON.stringify(seen)}`
	);

	seen.length = 0;
	bridge!.__inject({type: 'host_error', message: 'Invalid command: nope'} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	assert.ok(
		seen.some(e => e.projectId === 'engine' && e.type === 'host_error'),
		`host_error must stay host-level; got ${JSON.stringify(seen)}`
	);

	hub.closeAll();
});

/**
 * Checkpoint push names a checkout, not a conversation, so it carries no sessionId. Falling through
 * to getActive() would tell the focused Project that another Project's change list moved.
 */
test('bridgeEventSchema keeps sessionId on assistant_delta', async () => {
	const {bridgeEventSchema} = await import('@fastllm/bridge-protocol');
	const parsed = bridgeEventSchema.parse({
		type: 'assistant_delta',
		eventSeq: 1,
		turnId: 'turn-a',
		text: 'x',
		sessionId: 'sess-a'
	});
	assert.equal(
		'sessionId' in parsed && (parsed as {sessionId?: string}).sessionId,
		'sess-a'
	);
});

test('assistant_delta WITH sessionId routes to owning Project while another is focused', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;
	projA.metaProjectId = projA.metaProjectId ?? 'proj-a-meta';
	projB.metaProjectId = projB.metaProjectId ?? 'proj-b-meta';

	const taskA = projA.sessions.createTask('Task A');
	projA.sessions.acceptNewSession('sess-a', taskA.id);
	const sessA = projA.sessions.getActiveTask()?.sessionId;
	assert.ok(sessA, 'Project A should have Engine sessionId after CreateSession');
	projA.sessions.handleEvent({type: 'Attached', sessionId: sessA!, clientId: projA.clientId});
	projA.sessions.handleEvent({
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'turn-a',
		clientMessageId: 'turn-a',
		text: 'ask A',
		sessionId: sessA
	} as BridgeEvent);

	const taskB = projB.sessions.createTask('Task B');
	projB.sessions.acceptNewSession('sess-b', taskB.id);
	const sessB = projB.sessions.getActiveTask()?.sessionId;
	assert.ok(sessB, 'Project B should have Engine sessionId after CreateSession');
	projB.sessions.handleEvent({type: 'Attached', sessionId: sessB!, clientId: projB.clientId});

	hub.focusProject(projB.id);

	bridge!.__inject({
		type: 'assistant_delta',
		eventSeq: 2,
		turnId: 'turn-a',
		text: 'STAMPED_FOR_A',
		sessionId: sessA
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	const textA = projA.sessions
		.getActiveTask()!
		.transcript.entries.map(e => e.text)
		.join('');
	const textB = (projB.sessions.getActiveTask()?.transcript.entries ?? [])
		.map(e => e.text)
		.join('');

	assert.match(textA, /STAMPED_FOR_A/);
	assert.doesNotMatch(textB, /STAMPED_FOR_A/);
	hub.closeAll();
});

/**
 * Feedback loop for "restart → projects visible, tasks empty".
 * Mirrors Engine after fix: `/sessions` lists every registered workspace.
 * Hub must hydrate EACH Project by cwd (no single waiter).
 */
