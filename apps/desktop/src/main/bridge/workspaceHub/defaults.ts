/** WorkspaceHub tests — Default Project / create / integration. Loaded by WorkspaceHub.test.ts. */
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

test('isDefaultProjectPath accepts $HOME/fast_workspace/.default_project', () => {
	const home = '/Users/test';
	assert.equal(isDefaultProjectPath(defaultProjectPath(home), home), true);
	assert.equal(isDefaultProjectPath('/Users/test/code/other', home), false);
});
test('WorkspaceHub refuses opening Default Project path as folder Project', () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge([]),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	assert.throws(
		() => hub.openProject(defaultProjectPath(home), noopHandlers()),
		/hidden Default Project/
	);
});

test('ensureDefaultProject is hidden from listProjects and requests GetWorkspaceMeta', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	const snap = hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	assert.equal(hub.listProjects().length, 0);
	assert.equal(
		hub.listProjects().some(p => p.displayName === '.default_project' || p.path.endsWith('.default_project')),
		false,
		'Default Project must never appear under 项目'
	);
	assert.ok(hub.getDefaultProject());
	assert.equal(path.basename(snap.path), '.default_project');
	assert.equal(snap.isDefault, true);
	assert.equal(snap.displayName, 'Default Project');
	assert.equal(
		commands.filter(c => c.type === 'RegisterWorkspace').length,
		0,
		'Default Register must stay lazy until Task/focus'
	);
	assert.ok(
		commands.some(c => c.type === 'GetWorkspaceMeta'),
		'ready should request Meta aggregate'
	);
	hub.closeAll();
});

test('workspace_meta must not adopt .default_project path as a folder Project', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const defaultRoot = defaultProjectPath(home);
	mkdirSync(defaultRoot, {recursive: true});
	const bridge = createFakeBridge([]);
	const hub = new WorkspaceHub({
		createBridge: () => bridge,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 40));
	bridge.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'default-project',
				projectType: 'general',
				displayName: 'Default Project',
				isDefault: true,
				status: 'active',
				workspace: {
					id: 'ws-default',
					placement: 'local',
					rootPath: defaultRoot,
					pathHash: 'defhash'
				}
			},
			{
				id: 'stray-coding-default',
				projectType: 'coding',
				displayName: '.default_project',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-stray',
					placement: 'local',
					rootPath: defaultRoot,
					pathHash: 'defhash'
				}
			}
		],
		sessionsByProjectId: {
			'default-project': [{id: 'sess-keep', title: 'Keep', status: 'active'}],
			'stray-coding-default': [
				{id: 'sess-stray', title: 'New Task', status: 'active'}
			]
		}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	assert.equal(hub.listProjects().length, 0, 'stray coding Default path must not become a folder Project');
	assert.equal(
		hub.listProjects().some(p => p.path.includes('.default_project') || p.displayName === '.default_project'),
		false,
		'.default_project must never appear under 项目'
	);
	const def = hub.getDefaultProject();
	assert.ok(def);
	assert.ok(def.sessions.listTasks().some(t => t.sessionId === 'sess-keep'));
	assert.equal(
		def.sessions.listTasks().some(t => t.sessionId === 'sess-stray'),
		false,
		'stray project Sessions must not hydrate into Default Tasks'
	);
	hub.closeAll();
});

test('listProjects drops misclassified folder row on Default path', () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const defaultRoot = defaultProjectPath(home);
	mkdirSync(defaultRoot, {recursive: true});
	const other = mkdtempSync(path.join(tmpdir(), 'hub-other-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge([]),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	hub.openProject(other, noopHandlers());
	const def = hub.getDefaultProject()!;
	// Simulate path-rename bug: Default disk path registered as a folder Project.
	const projectsMap = (hub as unknown as {projects: Map<string, typeof def>}).projects;
	projectsMap.set('leaked-default', {...def, id: 'leaked-default', isDefault: false, path: defaultRoot});
	assert.equal(
		hub.listProjects().some(p => p.id === 'leaked-default' || isDefaultProjectPath(p.path, home)),
		false,
		'misclassified Default path must be purged from 项目'
	);
	assert.equal(hub.listProjects().some(p => path.resolve(p.path) === path.resolve(other)), true);
	assert.ok(hub.getDefaultProject(), 'real Default Project (Tasks mount) must remain');
	hub.closeAll();
});

test('createTask under Default Project sends CreateSession', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const def = hub.getDefaultProject();
	assert.ok(def);
	def.sessions.createTask('From New task');
	await new Promise(r => setTimeout(r, 80));
	const creates = commands.filter(c => c.type === 'CreateSession');
	assert.ok(creates.length >= 1);
	assert.equal(
		(creates.at(-1) as Extract<BridgeCommand, {type: 'CreateSession'}>).projectId,
		'default-project'
	);
	assert.equal(def.sessions.getActiveTask()?.sessionId, 'sess-1');
	const lastCreate = creates.at(-1) as Extract<BridgeCommand, {type: 'CreateSession'}>;
	assert.equal(lastCreate.taskId, def.sessions.getActiveTask()?.id);
	hub.closeAll();
});

test('CreateSession without taskId hard-fails: removes optimistic row and surfaces session.create_failed', async () => {
	const commands: BridgeCommand[] = [];
	const errors: Array<{message: string; code?: string; params?: Record<string, string | number>}> =
		[];
	let bridge: FakeBridge | null = null;
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject({
		...noopHandlers(),
		onError(_id, message, meta) {
			if (message.trim() || meta?.code) errors.push({message, ...meta});
		}
	});
	await new Promise(r => setTimeout(r, 80));
	const def = hub.getDefaultProject()!;
	def.metaProjectId = undefined;
	const pending = def.sessions.createTask('Will fail');
	assert.equal(pending.sessionId, null);
	bridge!.__inject({
		type: 'command_result',
		name: 'CreateSession',
		message: 'Started session orphan.',
		status: 'accepted',
		sessionId: 'sess-orphan',
		projectId: 'default-project'
		// no taskId — hard fail
	});
	await new Promise(r => setTimeout(r, 40));
	assert.ok(
		errors.some(e => e.code === 'session.create_failed_detail'),
		JSON.stringify(errors)
	);
	assert.equal(
		errors.find(e => e.code === 'session.create_failed_detail')?.params?.detail,
		'Started session orphan.'
	);
	assert.equal(
		def.sessions.listTasks().some(t => t.id === pending.id),
		false,
		'optimistic row must be removed'
	);
	hub.closeAll();
});

/**
 * Integration regression:「创建失败」banner while chat still works.
 *
 * Production race (after workspaceId CreateSession slowdown):
 * 1. New task → CreateSession #1 in flight (pendingNew, no sessionId yet)
 * 2. Late CreateProject / Register → retryPendingNew → CreateSession #2
 * 3. Both accepted, same taskId, different sessionIds
 * 4. Old Hub: second acceptNewSession → null →「创建失败」
 * 5. First bind still live → Submit「你是谁」streams normally
 *
 * Guards: createRequested blocks #2; Hub treats already-bound duplicate as success.
 */
/**
 * Integration regression: SkillSlash UI「完全没有反应」.
 *
 * Without sessionId on `{type:command}`, Engine SkillSlash used boot/stale
 * `sessionManager.sessionId`. Stream events demuxed away from the New task → empty pane.
 */
test('INTEGRATION: skill slash stamps sessionId and stream paints on that Task', async () => {
	const commands: BridgeCommand[] = [];
	const errors: Array<{message: string; code?: string}> = [];
	let bridge: FakeBridge | null = null;
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const root = mkdtempSync(path.join(tmpdir(), 'proj-skill-slash-'));
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});

	hub.openProject(root, {
		...noopHandlers(),
		onError(_id, message, meta) {
			if (message.trim() || meta?.code) errors.push({message, code: meta?.code});
		}
	});
	await new Promise(r => setTimeout(r, 100));

	const project = hub.getById(hub.listProjects().find(p => p.path === root)!.id)!;
	assert.ok(project.metaProjectId);

	// Task A then Task B — Engine focus after CreateSession B may differ from UI focus races.
	const taskA = project.sessions.createTask('Task A');
	await new Promise(r => setTimeout(r, 40));
	const taskB = project.sessions.createTask('Task B');
	await new Promise(r => setTimeout(r, 40));
	assert.ok(taskA.sessionId && taskB.sessionId);
	assert.notEqual(taskA.sessionId, taskB.sessionId);

	project.sessions.selectTask(taskB.id);
	// Catalog is pulled on slash-menu open (not every Attached). Seed Bridge skills here.
	project.sessions.handleEvent({
		type: 'commands_available',
		commands: [
			{
				name: 'explain-code',
				description: 'Explain',
				usage: '/explain-code',
				available: true
			}
		]
	});
	commands.length = 0;
	assert.equal(project.sessions.sendMessage('/explain-code review helpers'), true);

	const skillCmd = commands.find(c => c.type === 'command' && c.name === 'explain-code');
	assert.ok(skillCmd, 'skill must be sent as Bridge command');
	// Hard contract: missing sessionId must fail this test (silent-UI regression).
	assertSkillCommandPinned(skillCmd, taskB.sessionId!);
	assert.equal(skillCmd.args, 'review helpers');

	// Simulate Engine stream stamped with the command sessionId (correct demux).
	bridge!.__inject({
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'cmid-1',
		clientMessageId: 'cmid-1',
		text: '/explain-code review helpers',
		sessionId: taskB.sessionId!
	} as BridgeEvent);
	bridge!.__inject({
		type: 'assistant_delta',
		eventSeq: 2,
		turnId: 'run-skill-1',
		text: 'SKILL_OUTPUT_ON_B',
		sessionId: taskB.sessionId!
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	const textB = project.sessions
		.listTasks()
		.find(t => t.id === taskB.id)
		?.transcript.entries.map(e => e.text)
		.join('\n') ?? '';
	assert.match(textB, /SKILL_OUTPUT_ON_B/, 'skill output must appear on focused Task B');

	const textA = project.sessions
		.listTasks()
		.find(t => t.id === taskA.id)
		?.transcript.entries.map(e => e.text)
		.join('\n') ?? '';
	assert.doesNotMatch(textA, /SKILL_OUTPUT_ON_B/, 'must not leak onto Task A');

	// Wrong sessionId (boot) must not paint onto B — the pre-fix silent failure mode.
	bridge!.__inject({
		type: 'assistant_delta',
		turnId: 'run-boot',
		text: 'BOOT_LEAK',
		sessionId: 'host-sess'
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	const textB2 = project.sessions
		.listTasks()
		.find(t => t.id === taskB.id)
		?.transcript.entries.map(e => e.text)
		.join('\n') ?? '';
	assert.doesNotMatch(textB2, /BOOT_LEAK/);

	assert.equal(
		errors.filter(
			e => e.code === 'session.create_failed' || e.code === 'session.create_failed_detail'
		).length,
		0
	);
	hub.closeAll();
});

test('INTEGRATION: CreateProject/Register retry during in-flight CreateSession must not banner create_failed', async () => {
	const commands: BridgeCommand[] = [];
	const errors: Array<{message: string; code?: string}> = [];
	let bridge: FakeBridge | null = null;
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const root = mkdtempSync(path.join(tmpdir(), 'proj-create-race-'));
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdCreateSession: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});

	hub.openProject(root, {
		...noopHandlers(),
		onError(_id, message, meta) {
			if (message.trim() || meta?.code) errors.push({message, code: meta?.code});
		}
	});
	await new Promise(r => setTimeout(r, 100));

	const project = hub.getById(hub.listProjects().find(p => p.path === root)!.id)!;
	assert.ok(project.metaProjectId, 'CreateProject must stamp metaProjectId before New task');

	const createCountBeforeTask = commands.filter(c => c.type === 'CreateSession').length;
	const pending = project.sessions.createTask('你是谁 race');
	assert.equal(pending.sessionId, null, 'CreateSession held — still unbound');
	assert.equal(pending.createRequested, true);
	assert.equal(
		commands.filter(c => c.type === 'CreateSession').length,
		createCountBeforeTask + 1,
		'exactly one CreateSession from createTask'
	);

	// Late CreateProject + Register while #1 still in flight (production firstReady / re-stamp).
	bridge!.__inject({
		type: 'command_result',
		name: 'CreateProject',
		message: `created ${project.metaProjectId}`,
		status: 'accepted',
		projectId: project.metaProjectId!,
		workspaceId: `meta-ws-${project.metaProjectId}`,
		pathHash: projectHash(root)
	});
	bridge!.__inject({
		type: 'command_result',
		name: 'RegisterWorkspace',
		message: projectHash(root),
		status: 'accepted'
	});
	await new Promise(r => setTimeout(r, 40));

	assert.equal(
		commands.filter(c => c.type === 'CreateSession').length,
		createCountBeforeTask + 1,
		'retryPendingNew must not send a second CreateSession (createRequested)'
	);
	assert.equal(pending.sessionId, null, 'still waiting on held CreateSession #1');

	// Release #1 — bind succeeds; composer can Submit.
	bridge!.__releaseCreates();
	await new Promise(r => setTimeout(r, 40));
	const firstSid = project.sessions.getActiveTask()?.sessionId;
	assert.ok(firstSid, 'first CreateSession must bind');
	assert.equal(project.sessions.canSendMessage(), true, 'dialogue path ready after first bind');
	assert.equal(
		errors.filter(
			e => e.code === 'session.create_failed' || e.code === 'session.create_failed_detail'
		).length,
		0,
		`no create_failed after first bind: ${JSON.stringify(errors)}`
	);

	// What the old race still delivered: second accepted, different Engine sessionId.
	bridge!.__inject({
		type: 'command_result',
		name: 'CreateSession',
		message: 'Started session deadbeef.',
		status: 'accepted',
		sessionId: 'sess-duplicate-orphan',
		projectId: project.metaProjectId!,
		taskId: pending.id
	});
	await new Promise(r => setTimeout(r, 40));

	assert.equal(
		errors.filter(
			e => e.code === 'session.create_failed' || e.code === 'session.create_failed_detail'
		).length,
		0,
		`duplicate accepted must not banner create_failed (old bug): ${JSON.stringify(errors)}`
	);
	assert.equal(project.sessions.getActiveTask()?.sessionId, firstSid);
	assert.equal(project.sessions.canSendMessage(), true, 'Submit「你是谁」still works');
	assert.equal(
		project.sessions.sendMessage('你是谁'),
		true,
		'user message must send on the first bound session'
	);
	assert.ok(
		commands.some(
			c =>
				c.type === 'SubmitUserMessage' &&
				c.sessionId === firstSid &&
				c.text === '你是谁'
		),
		'SubmitUserMessage must target the first session, not the duplicate'
	);

	hub.closeAll();
});

test('session-switch ready does not re-request GetWorkspaceMeta', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const metaBefore = commands.filter(c => c.type === 'GetWorkspaceMeta').length;
	assert.ok(metaBefore >= 1);

	const def = hub.getDefaultProject()!;
	def.sessions.createTask('Race');
	await new Promise(r => setTimeout(r, 80));

	const metaAfter = commands.filter(c => c.type === 'GetWorkspaceMeta').length;
	assert.equal(
		metaAfter,
		metaBefore,
		'CreateSession session-switch ready must not GetWorkspaceMeta again'
	);
	assert.equal(def.sessions.listTasks()[0]?.title, 'Race');
	assert.ok(
		def.sessions.getActiveTask()?.sessionId,
		'CreateSession command_result+taskId must bind pending New'
	);
	hub.closeAll();
});

test('Default Project: re-injected workspace_meta does not steal task focus', async () => {
	const commands: BridgeCommand[] = [];
	let bridgeRef: FakeBridge | undefined;
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => {
			const client = createFakeBridge(commands);
			bridgeRef = client;
			return client;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const def = hub.getDefaultProject();
	assert.ok(def);
	assert.ok(bridgeRef);
	const bridge = bridgeRef;

	const metaPayload = {
		type: 'workspace_meta' as const,
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'default-project',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: null
			}
		],
		sessionsByProjectId: {
			'default-project': [
				{
					id: 'sess-first',
					title: 'First',
					status: 'active',
					updatedAt: '2026-07-15T12:00:00.000Z'
				},
				{
					id: 'sess-second',
					title: 'Second',
					status: 'active',
					updatedAt: '2026-07-15T11:00:00.000Z'
				},
				{
					id: 'sess-third',
					title: 'Third',
					status: 'active',
					updatedAt: '2026-07-15T10:00:00.000Z'
				}
			]
		}
	};
	bridge.__inject(metaPayload as BridgeEvent);
	await new Promise(r => setTimeout(r, 80));
	assert.equal(def.sessions.listTasks().length, 3);
	assert.equal(def.sessions.getActiveTask()?.title, 'First');

	const third = def.sessions.listTasks().find(t => t.title === 'Third')!;
	def.sessions.selectTask(third.id);
	assert.equal(def.sessions.getActiveTask()?.id, third.id);

	bridge.__inject({
		...metaPayload,
		sessionsByProjectId: {
			'default-project': metaPayload.sessionsByProjectId['default-project'].map(s => ({
				...s,
				// Engine still marks First as current — must not steal.
			}))
		}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 80));
	assert.equal(
		def.sessions.getActiveTask()?.id,
		third.id,
		're-hydrate must keep user-selected Third'
	);
	hub.closeAll();
});
