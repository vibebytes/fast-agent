import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorkspaceHub} from './WorkspaceHub.js';
import {BridgeClient} from './BridgeClient.js';
import {isDefaultProjectPath, defaultProjectPath} from './defaultProject.js';
import {projectHash} from './projectHash.js';
import {assertSkillCommandPinned} from './skillSlashContract.js';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

type FakeBridge = BridgeClient & {
	__child: EventEmitter & {killed: boolean; stdout: PassThrough};
	__inject: (event: BridgeEvent) => void;
	/** Flush held CreateSession/NewSession auto-acks (only when holdCreateSession). */
	__releaseCreates: () => void;
	/** Flush held RegisterWorkspace auto-acks (only when holdRegister). */
	__releaseRegisters: () => void;
};

/** Settings-enabled models fixture — Composer must match this, not yaml Anthropic. */
const SETTINGS_ENABLED_PROVIDERS = [
	{
		id: 'deepseek',
		kind: 'api',
		vendor: 'deepseek',
		name: 'DeepSeek',
		modelCount: 2,
		enabledModelCount: 2,
		enabled: true,
		models: [
			{
				modelId: 'deepseek-v4-flash',
				displayName: 'DeepSeek V4 Flash',
				enabled: true,
				source: 'catalog'
			},
			{
				modelId: 'deepseek-v4-pro',
				displayName: 'DeepSeek V4 Pro',
				enabled: true,
				source: 'catalog'
			}
		]
	},
	{
		id: 'openrouter',
		kind: 'api',
		vendor: 'openrouter',
		name: 'OpenRouter',
		modelCount: 2,
		enabledModelCount: 2,
		enabled: true,
		models: [
			{
				modelId: 'openai/gpt-5.6-terra',
				displayName: 'GPT-5.6 Terra',
				enabled: true,
				source: 'catalog'
			},
			{
				modelId: 'openrouter/free',
				displayName: 'OpenRouter Free',
				enabled: true,
				source: 'catalog'
			}
		]
	},
	{
		id: 'zhipu',
		kind: 'api',
		vendor: 'zhipu',
		name: 'Zhipu',
		modelCount: 1,
		enabledModelCount: 1,
		enabled: true,
		models: [
			{modelId: 'glm-5.2', displayName: 'GLM-5.2', enabled: true, source: 'catalog'}
		]
	},
	{
		id: 'anthropic',
		kind: 'api',
		vendor: 'anthropic',
		name: 'Anthropic',
		modelCount: 1,
		enabledModelCount: 1,
		enabled: false,
		models: [
			{
				modelId: 'claude-opus-4-5',
				displayName: 'Claude Opus 4.5',
				enabled: true,
				source: 'catalog'
			}
		]
	}
];

function createFakeBridge(
	commands: BridgeCommand[],
	opts: {
		onStop?: () => void;
		/**
		 * Record CreateSession/NewSession but do not auto-ack until `__releaseCreates()`.
		 * Used to reproduce CreateProject/Register `retryPendingNew` races.
		 */
		holdCreateSession?: boolean;
		/**
		 * Record RegisterWorkspace/CreateProject but do not auto-ack until `__releaseRegisters()`.
		 * Used to reproduce review ops racing a still-unregistered workspace.
		 */
		holdRegister?: boolean;
		/** ListProviders reply. `error` = fail; omit uses Settings-enabled fixture. */
		listProviders?: typeof SETTINGS_ENABLED_PROVIDERS | 'error';
		/** Delay ListProviders command_result (ms). Used to assert catalog refresh awaits the reply. */
		listProvidersDelayMs?: number;
	} = {}
): FakeBridge {
	const heldCreates: Array<() => void> = [];
	const heldRegisters: Array<() => void> = [];
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});

	const client = new BridgeClient({
		spawnImpl: () => child as never
	}) as FakeBridge;

	const origStart = client.start.bind(client);
	client.start = ((workspaceRoot, handlers, launchOptions = {}) => {
		origStart(workspaceRoot, handlers, {
			...launchOptions,
			env: {
				FAST_ENGINE_COMMAND: 'mock',
				FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio --new',
				...(launchOptions.env ?? {})
			},
			bundledEnginePath: '/unused',
			sessionMode: 'new'
		});
		queueMicrotask(() => {
			stdout.write(
				`${JSON.stringify({
			type: 'ready',
			protocolVersion: 2,
					sessionId: 'host-sess',
					cwd: workspaceRoot,
			mode: 'bridge'
				})}\n`
			);
		});
	}) as BridgeClient['start'];

	const origSend = client.send.bind(client);
	client.send = ((cmd: BridgeCommand) => {
		commands.push(cmd);
		const ok = origSend(cmd);
		if (cmd.type === 'RegisterWorkspace') {
			const emitRegisterAck = () => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'RegisterWorkspace',
						message: projectHash(cmd.path),
						status: 'accepted'
					})}\n`
				);
			};
			if (opts.holdRegister) {
				heldRegisters.push(emitRegisterAck);
			} else {
				queueMicrotask(emitRegisterAck);
			}
		}
		if (cmd.type === 'CreateSession' || cmd.type === 'NewSession') {
			const emitCreateAck = () => {
				const sessionId = `sess-${commands.filter(c => c.type === 'CreateSession' || c.type === 'NewSession').length}`;
				const projectId =
					cmd.type === 'CreateSession' ? cmd.projectId : 'default-project';
				// Production adoptCreatedSession returns path-hash; Thin Client (taskId)
				// skips session-switch ready and Attaches next.
				const workspaceId = cmd.workspaceId;
				const taskId =
					cmd.type === 'CreateSession' || cmd.type === 'NewSession'
						? cmd.taskId
						: undefined;
				if (!taskId) {
					stdout.write(
						`${JSON.stringify({
							type: 'ready',
							protocolVersion: 2,
							sessionId,
							cwd: workspaceId ?? 'default',
							mode: 'bridge'
						})}\n`
					);
				}
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: cmd.type,
						message: `Started session ${sessionId.slice(0, 8)}.`,
						status: 'accepted',
						sessionId,
						projectId,
						workspaceId,
						taskId
					})}\n`
				);
			};
			if (opts.holdCreateSession) {
				heldCreates.push(emitCreateAck);
			} else {
				queueMicrotask(emitCreateAck);
			}
		}
		if (cmd.type === 'CreateProject') {
			queueMicrotask(() => {
				const projectId = `proj-${commands.filter(c => c.type === 'CreateProject').length}`;
				const hash = cmd.rootPath ? projectHash(cmd.rootPath) : undefined;
				const emit = () =>
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'CreateProject',
							message: `created ${projectId}`,
							status: 'accepted',
							projectId,
							workspaceId: `meta-ws-${projectId}`,
							pathHash: hash
						})}\n`
					);
				if (opts.holdRegister) heldRegisters.push(emit);
				else emit();
			});
		}
		if (cmd.type === 'GetWorkspaceMeta') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'workspace_meta',
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
						sessionsByProjectId: {}
					})}\n`
				);
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'GetWorkspaceMeta',
						message: '1 projects',
						status: 'accepted'
					})}\n`
				);
			});
		}
		if (cmd.type === 'UpdateProjectStatus') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'UpdateProjectStatus',
						message: cmd.status,
						status: 'accepted',
						projectId: cmd.projectId
					})}\n`
				);
			});
		}
		if (cmd.type === 'SetProjectDisplayName') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'SetProjectDisplayName',
						message: `DisplayName -> "${cmd.displayName}"`,
						status: 'accepted',
						projectId: cmd.projectId,
						displayName: cmd.displayName
					})}\n`
				);
			});
		}
		if (cmd.type === 'ListProviders') {
			const reply = () => {
				if (opts.listProviders === 'error') {
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'ListProviders',
							message: 'engine unavailable',
							status: 'error'
						})}\n`
					);
					return;
				}
				const providers = opts.listProviders ?? SETTINGS_ENABLED_PROVIDERS;
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'ListProviders',
						message: `${providers.length} providers`,
						status: 'accepted',
						providers
					})}\n`
				);
			};
			const delayMs = opts.listProvidersDelayMs ?? 0;
			if (delayMs > 0) setTimeout(reply, delayMs);
			else queueMicrotask(reply);
		}
		if (cmd.type === 'SaveWorkspaceFile') {
			// leave to caller inject for FS tests
		}
		if (cmd.type === 'GitWorkspaceStatus') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'GitWorkspaceStatus',
						message: 'branch=main files=1',
						status: 'success',
						requestId: cmd.requestId,
						pathHash: cmd.workspaceId,
						git: {
							available: true,
							branch: 'main',
							dirty: true,
							files: [{path: 'a.txt', kind: 'modified'}]
						}
					})}\n`
				);
			});
		}
		return ok;
	}) as BridgeClient['send'];

	const origStop = client.stop.bind(client);
	client.stop = (() => {
		opts.onStop?.();
		origStop();
		child.killed = true;
	}) as BridgeClient['stop'];

	client.__child = child as FakeBridge['__child'];
	client.__inject = (event: BridgeEvent) => {
		stdout.write(`${JSON.stringify(event)}\n`);
	};
	client.__releaseCreates = () => {
		const pending = heldCreates.splice(0, heldCreates.length);
		for (const emit of pending) emit();
	};
	client.__releaseRegisters = () => {
		const pending = heldRegisters.splice(0, heldRegisters.length);
		for (const emit of pending) emit();
	};
	return client;
}

function noopHandlers() {
	return {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	};
}

test('isDefaultProjectPath accepts $HOME/fast_workspace/.default_project', () => {
	const home = '/Users/test';
	assert.equal(isDefaultProjectPath(defaultProjectPath(home), home), true);
	assert.equal(isDefaultProjectPath('/Users/test/code/other', home), false);
});

test('ensureEngine launches with continue — not --new (no boot mint into Default Tasks)', () => {
	// Regression: sessionMode:'new' made every App cold start / rebind call mintBootSession(),
	// stacking durable "New Task" rows under default-project (see ~/.fast/server SESSION).
	let startSessionMode: string | undefined;
	let launchedArgs: string[] | undefined;
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});
	const recording = new BridgeClient({
		spawnImpl: (_cmd, args) => {
			launchedArgs = args;
			return child as never;
		}
	});
	const origStart = recording.start.bind(recording);
	recording.start = ((workspaceRoot, handlers, launchOptions = {}) => {
		startSessionMode = launchOptions.sessionMode;
		origStart(workspaceRoot, handlers, {
			...launchOptions,
			env: {
				FAST_ENGINE_COMMAND: 'mock',
				FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio',
				...(launchOptions.env ?? {})
			},
			bundledEnginePath: '/unused'
		});
	}) as BridgeClient['start'];

	const hub = new WorkspaceHub({
		createBridge: () => recording,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	hub.ensureEngine(noopHandlers());

	assert.equal(
		startSessionMode,
		'continue',
		`Hub must not force sessionMode=new (got ${String(startSessionMode)})`
	);
	assert.ok(
		launchedArgs?.includes('--continue'),
		`Engine argv must include --continue, got ${JSON.stringify(launchedArgs)}`
	);
	assert.equal(
		launchedArgs?.includes('--new'),
		false,
		`Engine argv must not include --new, got ${JSON.stringify(launchedArgs)}`
	);
	hub.closeAll();
});

test('WorkspaceHub shares one Engine across two folder Projects', async () => {
	const commands: BridgeCommand[] = [];
	let stops = 0;
	const hub = new WorkspaceHub({
		createBridge: () => {
			const client = createFakeBridge(commands, {onStop: () => { stops += 1; }});
			return client;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	const handlers = noopHandlers();

	hub.openProject(a, handlers);
	hub.openProject(b, handlers);

	await new Promise(r => setTimeout(r, 80));

	assert.equal(hub.listProjects().length, 2);
	assert.ok(hub.getBridge());
	const registers = commands.filter(c => c.type === 'RegisterWorkspace');
	assert.ok(registers.length >= 2);
	assert.equal(hub.getEngineStatus().status, 'ready');

	hub.closeProject(hub.listProjects()[0]!.id);
	assert.equal(stops, 0, 'closing one Project must not stop the shared Bridge');
	assert.equal(hub.listProjects().length, 1);

	hub.closeAll();
	assert.equal(stops, 1);
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

test('crash rebind moves Engine to reconnecting then ready', async () => {
	const commands: BridgeCommand[] = [];
	let spawnCount = 0;
	const children: Array<EventEmitter & {killed: boolean}> = [];

	const hub = new WorkspaceHub({
		createBridge: () => {
			spawnCount += 1;
			const client = createFakeBridge(commands);
	children.push((client as FakeBridge).__child);
			return client;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});

	const statuses: string[] = [];
	const projectDir = mkdtempSync(path.join(tmpdir(), 'proj-rebind-'));
	hub.openProject(projectDir, {
		...noopHandlers(),
		onEngineStatus(status) {
			statuses.push(status);
		}
	});

	await new Promise(r => setTimeout(r, 60));
	assert.equal(hub.getEngineStatus().status, 'ready');
	assert.equal(spawnCount, 1);

	children[0]!.emit('exit', 1, null);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(hub.getEngineStatus().status, 'reconnecting');

	await new Promise(r => setTimeout(r, 1200));
	assert.equal(hub.getEngineStatus().status, 'ready');
	assert.ok(spawnCount >= 2, 'must respawn Bridge after crash');
	assert.ok(statuses.includes('reconnecting'));
	assert.ok(commands.filter(c => c.type === 'RegisterWorkspace').length >= 2);

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

test('reconnect ready does not re-CreateProject when Meta id is already stamped', async () => {
	const commands: BridgeCommand[] = [];
	const children: Array<EventEmitter & {killed: boolean}> = [];
	const hub = new WorkspaceHub({
		createBridge: () => {
			const client = createFakeBridge(commands);
			children.push((client as FakeBridge).__child);
			return client;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		rebindBaseMs: 40,
		stableLeaseMs: 30_000
	});

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const createsBefore = commands.filter(c => c.type === 'CreateProject').length;
	assert.ok(createsBefore >= 2, 'cold start CreateProject for folder projects');
	assert.ok(
		hub.listProjects().every(p => hub.getById(p.id)?.metaProjectId),
		'CreateProject must stamp metaProjectId'
	);

	children[0]!.emit('exit', 1, null);
	await new Promise(r => setTimeout(r, 120));
	assert.equal(hub.getEngineStatus().status, 'ready');

	assert.equal(
		commands.filter(c => c.type === 'CreateProject').length,
		createsBefore,
		'reconnect must not replay CreateProject for stamped projects'
	);
	assert.ok(
		commands.filter(c => c.type === 'RegisterWorkspace').length > createsBefore,
		'slot reclaim still RegisterWorkspace after host death'
	);

	hub.closeAll();
});

test('ready after reconnect keeps rebind backoff until the lease is stable', async () => {
	const commands: BridgeCommand[] = [];
	const children: Array<EventEmitter & {killed: boolean}> = [];
	const hub = new WorkspaceHub({
		createBridge: () => {
			const client = createFakeBridge(commands);
			children.push((client as FakeBridge).__child);
			return client;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		rebindBaseMs: 80,
		stableLeaseMs: 30_000
	});

	const projectDir = mkdtempSync(path.join(tmpdir(), 'proj-backoff-'));
	hub.openProject(projectDir, noopHandlers());
	await new Promise(r => setTimeout(r, 60));
	assert.equal(hub.getEngineStatus().status, 'ready');

	children[0]!.emit('exit', 1, null);
	await new Promise(r => setTimeout(r, 140));
	assert.equal(hub.getEngineStatus().status, 'ready');

	children[1]!.emit('exit', 1, null);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(hub.getEngineStatus().status, 'reconnecting');
	// First delay was 80ms; if ready reset backoff this would be ready again.
	// Second attempt is 160ms.
	await new Promise(r => setTimeout(r, 90));
	assert.equal(
		hub.getEngineStatus().status,
		'reconnecting',
		'write-stall reconnect must not reset backoff on the next ready'
	);
	await new Promise(r => setTimeout(r, 120));
	assert.equal(hub.getEngineStatus().status, 'ready');

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
 * Checkpoint push names a checkout, not a conversation, so it carries no sessionId. Falling through
 * to getActive() would tell the focused Project that another Project's change list moved.
 */
test('review_changed routes by pathHash to the owning Project, not the focused one', async () => {
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
	hub.focusProject(projB.id);
	seen.length = 0;

	bridge!.__inject({
		type: 'review_changed',
		pathHash: projectHash(a),
		revision: 3
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	assert.deepEqual(seen, [{projectId: projA.id, type: 'review_changed'}]);

	// A hash no open Project owns is dropped rather than handed to whoever is focused.
	seen.length = 0;
	bridge!.__inject({type: 'review_changed', pathHash: 'nobody', revision: 4} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	assert.deepEqual(seen, []);
	hub.closeAll();
});

/**
 * Review replies carry no sessionId and no Meta projectId, so the checkout hash is the only thing
 * saying which of several open Projects an answer belongs to. Two lists in flight at once must not be
 * able to take each other's payload.
 */
test('review answers are matched by checkout, so two Projects cannot cross', async () => {
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
	const a = mkdtempSync(path.join(tmpdir(), 'proj-rev-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-rev-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;

	const askedA = hub.listReviewChanges(projA.id);
	const askedB = hub.listReviewChanges(projB.id);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(commands.filter(c => c.type === 'ListReviewChanges').length, 2);

	// Answer B's first: without hash matching, A's waiter is older and would swallow it.
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '1 change',
		status: 'success',
		pathHash: projectHash(b),
		review: {
			revision: 7,
			changes: [
				{
					id: 'chg-b',
					checkpointId: 'ckpt-b',
					path: 'b.txt',
					kind: 'modified',
					state: {kind: 'pending'}
				}
			]
		}
	} as unknown as BridgeEvent);
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(a),
		review: {revision: 2, changes: []}
	} as unknown as BridgeEvent);

	const [answerA, answerB] = await Promise.all([askedA, askedB]);
	assert.ok(answerA.ok && answerB.ok);
	assert.equal(answerA.ok && answerA.list.revision, 2);
	assert.equal(answerB.ok && answerB.list.revision, 7);
	assert.deepEqual(answerB.ok && answerB.list.changes.map(c => c.path), ['b.txt']);
	hub.closeAll();
});

/** The session id rides the ListReviewChanges command so the daemon can scope the list to one session. */
test('listReviewChanges forwards the session id to the daemon', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-sid-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id, null, 'sess-42');
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges');
	assert.ok(sent);
	assert.equal((sent as {sessionId?: string}).sessionId, 'sess-42');

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(root),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);
	hub.closeAll();
});

/** Checkpoints off is not a failure to retry: nothing was recorded, so nothing can be undone. */
test('a review command on an unprotected workspace answers unavailable', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-off-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: 'Workspace checkpoints are off',
		status: 'unavailable',
		pathHash: projectHash(root),
		review: {available: false}
	} as unknown as BridgeEvent);

	const answer = await asked;
	assert.equal(answer.ok, false);
	assert.equal(!answer.ok && answer.unavailable, true);
	hub.closeAll();
});

/** A decision made against a list that has moved is refused with the revision to resync to. */
test('a stale keep comes back with the revision the client must catch up to', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-stale-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.keepReviewChanges(project.id, ['chg-1'], 1);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'KeepChanges',
		message: 'the change list has moved on',
		status: 'rejected',
		pathHash: projectHash(root),
		review: {revision: 4}
	} as unknown as BridgeEvent);

	const answer = await asked;
	assert.equal(answer.ok, false);
	assert.equal(!answer.ok && answer.revision, 4);
	assert.equal(!answer.ok && answer.unavailable, undefined);
	hub.closeAll();
});

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

test('openLivingSession selects by sessionId and focuses owning Project', async () => {
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
	await new Promise(r => setTimeout(r, 80));

	const projA = hub.getById(hub.listProjects().find(p => p.path === a)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === b)!.id)!;
	const taskA = projA.sessions.createTask('A');
	projA.sessions.acceptNewSession('sess-living-a', taskA.id);
	hub.focusProject(projB.id);

	const hit = hub.openLivingSession('sess-living-a');
	assert.equal(hit.ok, true);
	if (!hit.ok) return;
	assert.equal(hit.taskId, taskA.id);
	assert.equal(hub.getActive()?.id, projA.id);
	assert.equal(projA.sessions.getActiveTask()?.id, taskA.id);

	const miss = hub.openLivingSession('sess-missing');
	assert.equal(miss.ok, false);

	const byMeta = hub.openLivingSession('sess-living-a', projA.metaProjectId);
	assert.equal(byMeta.ok, true);

	const metaMiss = hub.openLivingSession('sess-missing', 'no-such-meta');
	assert.equal(metaMiss.ok, false);
	hub.closeAll();
});

test('listLivingTasks resolves host command_result (no session demux steal)', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-living-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.listLivingTasks();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ListLivingTasks'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListLivingTasks',
		message: '1 projects',
		status: 'accepted',
		livingTasks: [
			{
				projectId: 'meta-p1',
				displayName: 'Demo',
				sessions: []
			}
		]
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.projects[0]?.projectId, 'meta-p1');
	assert.equal(result.projects[0]?.displayName, 'Demo');
	hub.closeAll();
});

test('providers_changed refreshes Composer from ListProviders, not yaml /model', async () => {
	const commands: BridgeCommand[] = [];
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
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const def = hub.getDefaultProject();
	assert.ok(def);
	def.sessions.createTask('Catalog sync');
	await new Promise(r => setTimeout(r, 80));
	assert.deepEqual(
		def.sessions.modelCatalog.map(e => e.id),
		[
			'deepseek/deepseek-v4-flash',
			'deepseek/deepseek-v4-pro',
			'openrouter/openai/gpt-5.6-terra',
			'openrouter/openrouter/free',
			'zhipu/glm-5.2'
		]
	);
	assert.equal(
		def.sessions.modelCatalog.some(e => e.id.includes('claude')),
		false
	);
	commands.length = 0;
	bridge!.__inject({type: 'providers_changed', providerId: 'deepseek'});
	await new Promise(r => setTimeout(r, 80));
	assert.ok(
		commands.some(c => c.type === 'ListProviders'),
		JSON.stringify(commands)
	);
	assert.ok(
		!commands.some(c => c.type === 'command' && c.name === 'model'),
		`yaml /model must not replace Settings list: ${JSON.stringify(commands)}`
	);
	hub.closeAll();
});

test('ListProviders failure does not fall back to yaml /model', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {listProviders: 'error'});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	commands.length = 0;
	bridge!.__inject({type: 'providers_changed', providerId: 'deepseek'});
	await new Promise(r => setTimeout(r, 80));
	assert.ok(
		!commands.some(c => c.type === 'command' && c.name === 'model'),
		`ListProviders error must not paint yaml catalog: ${JSON.stringify(commands)}`
	);
	hub.closeAll();
});

test('refreshComposerCatalog resolves only after ListProviders paints Composer', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands, {listProvidersDelayMs: 60}),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 20));
	const def = hub.getDefaultProject();
	assert.ok(def);
	assert.equal(
		def.sessions.modelCatalog.length,
		0,
		'ListProviders is still in flight — Composer must not look loaded yet'
	);
	await hub.refreshComposerCatalog();
	assert.deepEqual(
		def.sessions.modelCatalog.map(e => e.id),
		[
			'deepseek/deepseek-v4-flash',
			'deepseek/deepseek-v4-pro',
			'openrouter/openai/gpt-5.6-terra',
			'openrouter/openrouter/free',
			'zhipu/glm-5.2'
		]
	);
	hub.closeAll();
});

test('Composer selected chrome snaps to ListProviders, not yaml default', async () => {
	const commands: BridgeCommand[] = [];
	const home = mkdtempSync(path.join(tmpdir(), 'hub-home-'));
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: home
	});
	hub.ensureDefaultProject(noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const def = hub.getDefaultProject();
	assert.ok(def);
	assert.equal(def.sessions.model, 'deepseek/deepseek-v4-flash');
	assert.equal(def.sessions.modelDisplay, 'DeepSeek V4 Flash');
	assert.equal(def.sessions.model.includes('nemotron'), false);
	assert.equal(def.sessions.modelDisplay.includes('nemotron'), false);
	hub.closeAll();
});

test('dshCall times out with requestId when Engine emits no command_result', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		requestWaitMs: 200
	});
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-dsh-to-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const result = await hub.dshCall('settings.describe', {});
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.match(result.error.message ?? '', /timeout waiting for requestId /);
	const sent = commands.find(c => c.type === 'Call');
	assert.ok(sent && sent.type === 'Call');
	if (sent.type === 'Call') {
		assert.ok(sent.requestId);
		assert.match(result.error.message ?? '', new RegExp(sent.requestId));
	}
	hub.closeAll();
});

test('dshCall resolves settings.describe by requestId', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		requestWaitMs: 2_000
	});
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-dsh-ok-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.dshCall('settings.describe', {});
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'Call');
	assert.ok(sent && sent.type === 'Call');
	if (sent.type !== 'Call') return;

	bridge!.__inject({
		type: 'command_result',
		name: 'GetSettings',
		message: 'wrong name must not steal',
		status: 'accepted',
		requestId: 'not-the-dsh-call'
	});
	bridge!.__inject({
		type: 'command_result',
		name: 'DshCall',
		message: 'settings.describe',
		status: 'success',
		method: 'settings.describe',
		requestId: sent.requestId,
		value: {writable: true, hasDocument: false, namespaces: []}
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.method, 'settings.describe');
	assert.equal((result.value as {writable?: boolean}).writable, true);
	hub.closeAll();
});

test('listExtensions forwards ledger put/drop with extension rows', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-ext-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.listExtensions();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ListExtensions'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListExtensions',
		message: '1 extensions',
		status: 'accepted',
		extensions: [{id: 'probe', phase: 'Active', hotUnload: true}],
		ledger: [
			{id: 'probe', mark: 'put'},
			{id: 'probe', mark: 'drop'},
			{id: 'probe', mark: 'put'}
		]
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.extensions[0]?.id, 'probe');
	assert.deepEqual(
		result.ledger.map(n => n.mark),
		['put', 'drop', 'put']
	);
	assert.equal(result.ledger[0]?.id, 'probe');
	hub.closeAll();
});

test('listEngines forwards engine rows like listExtensions', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-eng-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.listEngines();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ListEngines'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListEngines',
		message: '2 engines',
		status: 'accepted',
		engines: [
			{
				id: 'fast',
				kind: 'builtin',
				adapter: 'ready',
				program: 'builtin',
				process: 'none',
				isDefault: true,
				inRegistry: true,
				actions: []
			},
			{
				id: 'dsh',
				kind: 'extension',
				adapter: 'disabled',
				program: 'missing',
				process: 'none',
				isDefault: false,
				inRegistry: false,
				actions: ['enable']
			}
		]
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.engines[0]?.id, 'fast');
	assert.equal(result.engines[1]?.adapter, 'disabled');
	hub.closeAll();
});

test('listEngines still runs when host status is error but bridge is up', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-eng-fail-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	hub.failEngine('restore timeout');
	assert.equal(hub.getEngineStatus().status, 'error');

	const pending = hub.listEngines();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ListEngines'));
	bridge!.__inject({
		type: 'command_result',
		name: 'ListEngines',
		message: '1 engine',
		status: 'accepted',
		engines: [
			{
				id: 'fast',
				kind: 'builtin',
				adapter: 'ready',
				program: 'builtin',
				process: 'none',
				isDefault: true,
				inRegistry: true,
				actions: []
			}
		]
	});
	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.engines[0]?.id, 'fast');
	hub.closeAll();
});

test('writeEngine forwards Enable/Start and merges engines; Busy/Denied stay notices', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-eng-w-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const enablePending = hub.writeEngine('EnableEngine', 'dsh');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'EnableEngine' && c.id === 'dsh'));
	bridge!.__inject({
		type: 'command_result',
		name: 'EnableEngine',
		message: 'ok',
		status: 'accepted',
		engines: [
			{
				id: 'dsh',
				kind: 'extension',
				adapter: 'ready',
				program: 'installed',
				process: 'stopped',
				isDefault: false,
				inRegistry: false,
				actions: ['start']
			}
		]
	});
	const enabled = await enablePending;
	assert.equal(enabled.ok, true);
	if (enabled.ok) assert.equal(enabled.engines[0]?.actions[0], 'start');

	const startPending = hub.writeEngine('StartEngine', 'dsh');
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'StartEngine',
		message: 'ok',
		status: 'accepted',
		engines: [
			{
				id: 'dsh',
				kind: 'extension',
				adapter: 'ready',
				program: 'installed',
				process: 'running',
				processDetail: '127.0.0.1:3080',
				isDefault: false,
				inRegistry: true,
				actions: ['stop']
			}
		]
	});
	const started = await startPending;
	assert.equal(started.ok, true);
	if (started.ok) assert.equal(started.engines[0]?.process, 'running');
	assert.ok(hub.getActive()?.sessions.availableEngineIds().includes('dsh'));

	const busyPending = hub.writeEngine('DisableEngine', 'dsh');
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'DisableEngine',
		message: 'Busy',
		status: 'error'
	});
	const busy = await busyPending;
	assert.equal(busy.ok, false);
	if (!busy.ok) assert.equal(busy.notice, 'Busy');

	const deniedPending = hub.writeEngine('SetDefaultEngine', 'dsh');
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'SetDefaultEngine',
		message: 'denied',
		status: 'error'
	});
	const denied = await deniedPending;
	assert.equal(denied.ok, false);
	if (!denied.ok) assert.equal(denied.notice, 'denied');
	hub.closeAll();
});

test('extensionStatus returns the first extension row', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-ext-st-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.extensionStatus('probe');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ExtensionStatus' && c.id === 'probe'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ExtensionStatus',
		message: 'probe',
		status: 'accepted',
		extensions: [{id: 'probe', phase: 'Failed', hotUnload: true, fault: 'DescFault(InvalidYaml)'}]
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.extension?.id, 'probe');
	assert.equal(result.extension?.phase, 'Failed');
	assert.equal(result.extension?.fault, 'DescFault(InvalidYaml)');
	hub.closeAll();
});

/** Schema-valid reviewChange row for injected command_result payloads. */
const reviewChangeRow = (over: Record<string, unknown> = {}) => ({
	id: 'chg-1',
	checkpointId: 'ckpt-1',
	path: 'a.ts',
	kind: 'modified',
	state: {kind: 'pending'},
	...over
});

test('review: keep then review_changed push re-reads; stale plan refuses with daemon revision', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const seen: BridgeEvent[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = path.resolve(mkdtempSync(path.join(tmpdir(), 'proj-rev-keep-')));
	const project = hub.openProject(root, {
		onEvent: (projectId, event) => seen.push(event),
		onError: () => {},
		onExit: () => {}
	});
	await new Promise(r => setTimeout(r, 80));
	const hash = projectHash(root);
	const inject = (payload: Record<string, unknown>) =>
		bridge!.__inject({
			type: 'command_result',
			name: 'ListReviewChanges',
			message: 'fake',
			status: 'success',
			pathHash: hash,
			...payload
		});

	const listed = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	inject({
		review: {
			revision: 1,
			changes: [reviewChangeRow(), reviewChangeRow({id: 'chg-2', path: 'b.ts', kind: 'added'})]
		}
	});
	const listedAnswer = await listed;
	assert.equal(listedAnswer.ok, true);
	if (!listedAnswer.ok) return;
	assert.equal(listedAnswer.list.revision, 1);
	assert.equal(listedAnswer.list.changes.length, 2);

	const keep = hub.keepReviewChanges(project.id, ['chg-1'], 1);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		commands.some(
			c =>
				c.type === 'KeepChanges' &&
				c.workspaceId === hash &&
				'changeIds' in c &&
				c.changeIds.join() === 'chg-1' &&
				c.revision === 1
		)
	);
	bridge!.__inject({
		type: 'command_result',
		name: 'KeepChanges',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {revision: 1}
	});
	assert.equal((await keep).ok, true);

	// A restore lands from another window: the push must reach this checkout's handlers.
	bridge!.__inject({type: 'review_changed', pathHash: hash, revision: 2});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(seen.some(e => e.type === 'review_changed' && e.pathHash === hash));

	const relisted = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	inject({review: {revision: 2, changes: [reviewChangeRow({id: 'chg-2', path: 'b.ts', kind: 'added'})]}});
	const relistedAnswer = await relisted;
	assert.equal(relistedAnswer.ok, true);
	if (!relistedAnswer.ok) return;
	assert.equal(relistedAnswer.list.revision, 2);

	// Planning against a stale revision must come back refused, carrying the daemon revision.
	const plan = hub.previewRevert(project.id, {target: 'changes', revision: 1, changeIds: ['chg-2']});
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'PreviewRevert',
		message: 'stale',
		status: 'rejected',
		pathHash: hash,
		review: {revision: 2}
	});
	const planned = await plan;
	assert.equal(planned.ok, false);
	if (planned.ok) return;
	assert.equal(planned.revision, 2);
	hub.closeAll();
});

test('review: previewRevert → applyRevert → redoRevert round-trips preview and restore', async () => {
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
	const root = path.resolve(mkdtempSync(path.join(tmpdir(), 'proj-rev-undo-')));
	const project = hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const hash = projectHash(root);

	const plan = hub.previewRevert(project.id, {target: 'changes', revision: 1, changeIds: ['chg-2']});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		commands.some(
			c =>
				c.type === 'PreviewRevert' &&
				c.workspaceId === hash &&
				'changeIds' in c &&
				c.changeIds?.join() === 'chg-2' &&
				c.revision === 1
		)
	);
	bridge!.__inject({
		type: 'command_result',
		name: 'PreviewRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {
			revision: 2,
			preview: {
				id: 'pv-1',
				target: {kind: 'changes', changeIds: ['chg-2']},
				revision: 2,
				changes: [{path: 'b.ts', kind: 'deleted', previousPath: null}],
				conflicts: [],
				excludedPaths: [],
				forcePaths: [],
				mergedPaths: []
			}
		}
	});
	const planned = await plan;
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	assert.equal(planned.preview.id, 'pv-1');

	const apply = hub.applyRevert(project.id, 'pv-1');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ApplyRevert' && 'previewId' in c && c.previewId === 'pv-1'));
	bridge!.__inject({
		type: 'command_result',
		name: 'ApplyRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {restored: {restoreId: 'rs-1', fromTree: 't1', toTree: 't2', revision: 3}}
	});
	const applied = await apply;
	assert.equal(applied.ok, true);
	if (!applied.ok) return;
	assert.equal(applied.restored.restoreId, 'rs-1');

	const redo = hub.redoRevert(project.id, 'rs-1');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'RedoRevert' && 'restoreId' in c && c.restoreId === 'rs-1'));
	bridge!.__inject({
		type: 'command_result',
		name: 'RedoRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {restored: {restoreId: 'rs-1', fromTree: 't2', toTree: 't3', revision: 4}}
	});
	const redone = await redo;
	assert.equal(redone.ok, true);
	if (!redone.ok) return;
	assert.equal(redone.restored.revision, 4);
	hub.closeAll();
});

/** A review op issued before RegisterWorkspace settles parks, then proceeds once the hash lands. */
test('a review op racing RegisterWorkspace parks until the hash lands', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-park-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;
	assert.ok(!project.workspaceId);

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(!commands.some(c => c.type === 'ListReviewChanges'));

	bridge!.__releaseRegisters();
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges');
	assert.ok(sent);
	assert.equal((sent as {workspaceId?: string}).workspaceId, projectHash(root));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(root),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);
	hub.closeAll();
});

/**
 * 18:55 remount: Register minted agent_work (2cb2e3a3323b) but ListReviewChanges
 * still named cli (ce4a5bb09bcc). Meta pathHash is not a Slot — do not send it.
 */
test('review ignores a Meta pathHash that is not this folder and waits for Register', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const opened = mkdtempSync(path.join(tmpdir(), 'proj-agent-work-'));
	const sibling = mkdtempSync(path.join(tmpdir(), 'proj-cli-'));
	hub.openProject(opened, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const project = hub.getById(hub.listProjects().find(p => p.path === opened)!.id)!;

	bridge!.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-opened',
				projectType: 'coding',
				displayName: 'opened',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-opened',
					placement: 'local',
					rootPath: opened,
					pathHash: projectHash(sibling)
				}
			}
		],
		sessionsByProjectId: {}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 20));
	assert.notEqual(project.workspaceId, projectHash(sibling));

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		!commands.some(
			c =>
				c.type === 'ListReviewChanges' &&
				(c as {workspaceId?: string}).workspaceId === projectHash(sibling)
		),
		'must not review a sibling folder hash from Meta'
	);

	bridge!.__releaseRegisters();
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges') as
		| {workspaceId?: string}
		| undefined;
	assert.ok(sent);
	assert.equal(sent.workspaceId, projectHash(opened));
	assert.equal(project.slotLive, true);

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(opened),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);

	// A later workspace_meta must not replace the Register-minted hash with a sibling's.
	bridge!.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-opened',
				projectType: 'coding',
				displayName: 'opened',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-opened',
					placement: 'local',
					rootPath: opened,
					pathHash: projectHash(sibling)
				}
			}
		],
		sessionsByProjectId: {}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(project.workspaceId, projectHash(opened));
	assert.equal(project.slotLive, true);
	hub.closeAll();
});

/** A failed RegisterWorkspace must fail parked review ops instead of leaving them hanging. */
test('a failed RegisterWorkspace refuses parked review ops', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-fail-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'RegisterWorkspace',
		message: 'slot busy',
		status: 'error'
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.equal(answer.ok, false);
	if (answer.ok) return;
	assert.match(answer.notice, /slot busy/);
	hub.closeAll();
});

/** After a failed RegisterWorkspace, later review ops fail fast instead of re-waiting 12s. */
test('a failed RegisterWorkspace makes later review ops fail fast without re-registering', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-failfast-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	// First op parks on RegisterWorkspace, then the daemon rejects it.
	const first = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'RegisterWorkspace',
		message: 'slot busy',
		status: 'error'
	} as unknown as BridgeEvent);
	const firstAnswer = await first;
	assert.equal(firstAnswer.ok, false);

	// Second op must fail fast with the same reason and NOT re-send RegisterWorkspace.
	const registersBefore = commands.filter(c => c.type === 'RegisterWorkspace').length;
	const second = hub.listReviewChanges(project.id);
	const secondAnswer = await second;
	assert.equal(secondAnswer.ok, false);
	if (secondAnswer.ok) return;
	assert.match(secondAnswer.notice, /slot busy/);
	assert.equal(
		commands.filter(c => c.type === 'RegisterWorkspace').length,
		registersBefore,
		'failed registration must not be re-sent for a later op'
	);
	hub.closeAll();
});
