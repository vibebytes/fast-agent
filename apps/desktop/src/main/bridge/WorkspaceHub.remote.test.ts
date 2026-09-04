import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {WorkspaceHub, type WorkspaceProjectHandlers} from './WorkspaceHub.js';
import type {BridgeClient, BridgeStartOptions} from './BridgeClient.js';
import {projectHash} from './projectHash.js';
import {discoverHostSlashSkills} from './hostSkillDiscovery.js';

type Fake = Pick<BridgeClient, 'start' | 'send' | 'stop'> & {
	commands: BridgeCommand[];
	handlers?: {
		onEvent: (e: BridgeEvent) => void;
		onError: (m: string) => void;
		onExit: (c: number | null, s: NodeJS.Signals | null) => void;
	};
	failStart?: Error;
	clientIds: string[];
};

function fakeBridge(failStart?: Error): Fake {
	const fake = {
		commands: [] as BridgeCommand[],
		clientIds: [] as string[],
		handlers: undefined as Fake['handlers'],
		failStart,
		start(_cwd: string, handlers: Fake['handlers'], opts?: {clientId?: string; remote?: {url?: string}}) {
			fake.handlers = handlers;
			if (opts?.clientId) fake.clientIds.push(opts.clientId);
			if (failStart) return Promise.reject(failStart);
			queueMicrotask(() => {
				handlers?.onEvent({type: 'HelloOk', hostHome: '/home/kai'});
				handlers?.onEvent({type: 'ready', protocolVersion: 1});
			});
			return Promise.resolve();
		},
		send(cmd: BridgeCommand) {
			fake.commands.push(cmd);
			if (cmd.type === 'RegisterWorkspace') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'RegisterWorkspace',
						status: 'accepted',
						message: projectHash(cmd.path)
					});
				});
			}
			if (cmd.type === 'ListHostDir') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'ListHostDir',
						status: 'accepted',
						requestId: cmd.requestId,
						message: 'ok',
						fs: {
							path: cmd.path ?? '/home/kai',
							home: '/home/kai',
							entries: [
								{name: 'code', path: '/home/kai/code', kind: 'dir'},
								{name: '.default_project', path: '/home/kai/.default_project', kind: 'dir'}
							]
						}
					});
				});
			}
			if (cmd.type === 'CreateHostDir') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'CreateHostDir',
						status: 'accepted',
						requestId: cmd.requestId,
						message: 'created',
						fs: {
							path: `${cmd.parent.replace(/[/\\]+$/, '')}/${cmd.name}`,
							home: '/home/kai',
							name: cmd.name
						}
					});
				});
			}
			return true;
		},
		stop() {}
	};
	return fake as Fake;
}

function handlers(): WorkspaceProjectHandlers {
	return {onEvent: () => {}, onError: () => {}, onExit: () => {}};
}

function remoteHub(create: () => Fake, persist?: (id: string) => void) {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-remote-home-'));
	const cwd = mkdtempSync(path.join(tmpdir(), 'hub-remote-cwd-'));
	const hub = new WorkspaceHub({
		createBridge: () => create() as unknown as BridgeClient,
		hostCwd: cwd,
		homeDir: home,
		persistActiveId: persist,
		requestWaitMs: 200,
		registerWaitMs: 200
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	return hub;
}

test('remote applyWorkspaceMeta adopts a path that does not exist locally', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'srv-1',
				projectType: 'coding',
				displayName: 'foo',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-1', placement: 'local', rootPath: '/home/kai/foo', pathHash: 'abc'}
			}
		],
		sessionsByProjectId: {}
	});
	const listed = hub.listProjects();
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.path, '/home/kai/foo');
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('remote openProject is refused and sends no CreateProject', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 10));
	assert.throws(() => hub.openProject('/tmp/local-only', handlers()), /remote edge/);
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('remote ensureDefaultProject throws when host home is unknown and does not mkdir a local row', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	assert.throws(() => hub.ensureDefaultProject(handlers()), /host home is unknown/);
	assert.equal(hub.listAllProjects().length, 0);
	hub.closeAll();
});

test('remote ensureDefaultProject adopts $HOME/fast_workspace/.default_project after HelloOk', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = hub.ensureDefaultProject(handlers());
	assert.equal(snap.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(hub.getDefaultProject()?.isDefault, true);
	assert.equal(hub.getDefaultProject()?.sessions.tasksHydrated, true);
	assert.equal(hub.listProjects().length, 0);
	assert.equal(hub.listAllProjects().length, 1);
	hub.closeAll();
});

test('remote isDefault meta does not call local ensureDefaultProject', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	const localDefaultBefore = hub.getDefaultProject();
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'remote-default',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-def',
					placement: 'local',
					rootPath: '/home/kai/fast_workspace/.default_project',
					pathHash: 'def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.listProjects().length, 0);
	assert.ok(hub.getDefaultProject());
	assert.equal(hub.getDefaultProject()?.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(localDefaultBefore, null);
	hub.closeAll();
});

test('trailing-slash remote path dedups with workspace_meta', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = await hub.openRemoteProject('/home/kai/foo/', handlers());
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'srv-foo',
				projectType: 'coding',
				displayName: 'foo',
				status: 'active',
				isDefault: false,
				workspace: {
					id: 'ws-foo',
					placement: 'local',
					rootPath: '/home/kai/foo',
					pathHash: projectHash('/home/kai/foo')
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.listProjects().length, 1);
	assert.equal(hub.listProjects()[0]?.id, snap.id);
	hub.closeAll();
});

test('remote workspace_meta stale probe with pathHash skips RegisterWorkspace', async () => {
	const stale = '/var/folders/3s/yfml71wx6rb9qx_b59fdxbkm0000gn/T/queue-echo-probe-SNj4wy';
	const engineErrors: string[] = [];
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine({
		...handlers(),
		onError: (id, message) => {
			if (id === 'engine') engineErrors.push(message);
		}
	});
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'probe',
				projectType: 'coding',
				displayName: 'queue-echo-probe-SNj4wy',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-probe', placement: 'local', rootPath: stale, pathHash: 'deadbeef'}
			}
		],
		sessionsByProjectId: {}
	});
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(engineErrors, []);
	assert.equal(fake.commands.filter(c => c.type === 'RegisterWorkspace').length, 0);
	assert.equal(hub.listProjects().length, 1);
	assert.equal(hub.listProjects()[0]?.path, stale);
	hub.closeAll();
});

test('remote RegisterWorkspace not-a-directory stays on that project', async () => {
	const stale = '/var/folders/3s/yfml71wx6rb9qx_b59fdxbkm0000gn/T/queue-echo-probe-Gone';
	const engineErrors: string[] = [];
	const fake = fakeBridge();
	const origSend = fake.send.bind(fake);
	fake.send = (cmd: BridgeCommand) => {
		if (cmd.type === 'RegisterWorkspace') {
			fake.commands.push(cmd);
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'RegisterWorkspace',
					status: 'error',
					message: `not a directory: ${stale}`
				});
			});
			return true;
		}
		return origSend(cmd);
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine({
		...handlers(),
		onError: (id, message) => {
			if (id === 'engine') engineErrors.push(message);
		}
	});
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'probe',
				projectType: 'coding',
				displayName: 'gone',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-gone', placement: 'local', rootPath: stale}
			}
		],
		sessionsByProjectId: {}
	});
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(engineErrors, []);
	assert.equal(hub.listProjects().length, 1);
	assert.match(hub.listProjects()[0]?.error ?? '', /not a directory/);
	hub.closeAll();
});

test('openRemoteProject missing dir deletes the row and sends no CreateProject', async () => {
	const fake = fakeBridge();
	const origSend = fake.send.bind(fake);
	fake.send = (cmd: BridgeCommand) => {
		if (cmd.type === 'RegisterWorkspace') {
			fake.commands.push(cmd);
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'RegisterWorkspace',
					status: 'error',
					message: 'not a directory'
				});
			});
			return true;
		}
		return origSend(cmd);
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(() => hub.openRemoteProject('/no/such', handlers()));
	assert.equal(hub.listProjects().length, 0);
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('openRemoteProject existing dir becomes ready after Register', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = await hub.openRemoteProject('/home/kai/code', handlers());
	assert.equal(snap.path, '/home/kai/code');
	assert.equal(snap.status, 'ready');
	assert.ok(fake.commands.some(c => c.type === 'RegisterWorkspace' && c.path === '/home/kai/code'));
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('Register timeout deletes the registering row', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(() => hub.openRemoteProject('/home/kai/hung', handlers()), /timeout/i);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('listHostDir defaults to hostHome and hides .default_project', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir();
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.home, '/home/kai');
		assert.equal(
			res.entries.some(e => e.name === '.default_project'),
			false
		);
		assert.ok(res.entries.some(e => e.name === 'code'));
	}
	hub.closeAll();
});

test('listHostDir unknown command falls back', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'ListHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'ListHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'Unknown command type: ListHostDir'
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir('/home/kai');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.fallback, true);
		assert.equal(res.code, 'unknown-command');
	}
	hub.closeAll();
});

test('createHostDir sends parent+name and returns the created path', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.path, '/home/kai/code');
		assert.equal(res.name, 'code');
	}
	assert.ok(
		fake.commands.some(
			c => c.type === 'CreateHostDir' && c.parent === '/home/kai' && c.name === 'code'
		)
	);
	hub.closeAll();
});

test('createHostDir unknown command does not drop the folder tree', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'CreateHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'CreateHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'Unknown command type: CreateHostDir'
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'unknown-command');
		assert.equal(res.fallback, true);
	}
	hub.closeAll();
});

test('createHostDir maps exists', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'CreateHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'CreateHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'exists',
					fs: {code: 'exists', home: '/home/kai'}
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'exists');
	hub.closeAll();
});

test('listHostDir timeout is not fallback', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir('/home/kai');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'timeout');
		assert.equal(res.fallback, undefined);
	}
	hub.closeAll();
});

test('remote isDefault meta without rootPath adopts via hostHome', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'default-project',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(hub.getDefaultProject()?.sessions.tasksHydrated, true);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('local hub refuses openRemoteProject and listHostDir', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-local-home-'));
	mkdirSync(path.join(home, 'fast_workspace'), {recursive: true});
	const hub = new WorkspaceHub({
		createBridge: () => fakeBridge() as unknown as BridgeClient,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-local-cwd-')),
		homeDir: home
	});
	await assert.rejects(() => hub.openRemoteProject('/home/kai/x', handlers()), /only available/);
	const listed = await hub.listHostDir();
	assert.equal(listed.ok, false);
	const created = await hub.createHostDir('/home/kai', 'x');
	assert.equal(created.ok, false);
	if (!created.ok) assert.equal(created.code, 'denied');
	hub.closeAll();
});

test('switchEdge failure keeps old projects and does not persist', async () => {
	const persisted: string[] = [];
	let n = 0;
	const first = fakeBridge();
	const hub = new WorkspaceHub({
		createBridge: () => {
			n += 1;
			return (n === 1 ? first : fakeBridge(new Error('Hello timed out'))) as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-sw-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-sw-home-')),
		persistActiveId: id => persisted.push(id)
	});
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const folder = mkdtempSync(path.join(tmpdir(), 'hub-sw-proj-'));
	hub.openProject(folder, handlers());
	const before = hub.listProjects();
	assert.equal(before.length, 1);
	await assert.rejects(
		() =>
			hub.switchEdge(
				{id: 'dead', remote: {url: 'wss://10.255.255.1:9/bridge', authToken: 'x', timeoutMs: 50}},
				handlers()
			),
		/timed out|Hello/
	);
	assert.equal(hub.listProjects()[0]?.id, before[0]?.id);
	assert.equal(hub.edgeSnapshot().activeId, 'local');
	assert.deepEqual(persisted, []);
	hub.closeAll();
});

test('rapid switch aborts the first candidate without persisting it', async () => {
	const persisted: string[] = [];
	let starts = 0;
	const hub = new WorkspaceHub({
		createBridge: () => {
			starts += 1;
			const id = starts;
			return {
				commands: [],
				start(_c: string, _h: {onEvent: (e: BridgeEvent) => void}, opts?: BridgeStartOptions) {
					if (id === 1) {
						return new Promise((_resolve, reject) => {
							setTimeout(
								() => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})),
								30
							);
						});
					}
					queueMicrotask(() => _h.onEvent({type: 'HelloOk', hostHome: '/h'}));
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			} as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-ab-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-ab-home-')),
		persistActiveId: id => persisted.push(id)
	});
	const first = hub.switchEdge(
		{id: 'a', remote: {url: 'wss://10.0.0.1:1/bridge', authToken: 't', timeoutMs: 200}},
		handlers()
	);
	const second = hub.switchEdge(
		{id: 'b', remote: {url: 'wss://10.0.0.2:2/bridge', authToken: 't', timeoutMs: 200}},
		handlers()
	);
	await assert.rejects(first, /aborted/i);
	await second;
	assert.equal(hub.edgeSnapshot().activeId, 'b');
	assert.deepEqual(persisted, ['b']);
	hub.closeAll();
});

test('remote Hello start is given a unique clientId and no local mkdir of hostCwd is required', async () => {
	const ids: string[] = [];
	const fake = fakeBridge();
	const orig = fake.start.bind(fake);
	fake.start = ((cwd, h, opts) => {
		if (opts?.clientId) ids.push(opts.clientId);
		assert.ok(opts?.remote?.url);
		return orig(cwd, h, opts);
	}) as Fake['start'];
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	assert.equal(ids.length, 1);
	assert.match(ids[0] ?? '', /^fast-ide-/);
	hub.closeAll();
});

test('remote drop scheduleRebind reconnects the same committed edge', async () => {
	const remotes: Array<string | undefined> = [];
	const persisted: string[] = [];
	const fakes: Fake[] = [];
	const url = 'wss://10.0.0.2:1980/bridge';
	const hub = new WorkspaceHub({
		createBridge: () => {
			const fake = fakeBridge();
			const orig = fake.start.bind(fake);
			fake.start = ((cwd, h, opts) => {
				remotes.push(opts?.remote?.url);
				return orig(cwd, h, opts);
			}) as Fake['start'];
			fakes.push(fake);
			return fake as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-rebind-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-rebind-home-')),
		rebindBaseMs: 5,
		persistActiveId: id => persisted.push(id)
	});
	hub.bindCommittedEdge('edge-1', {url, authToken: 'tok', timeoutMs: 200});
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 30));
	assert.equal(hub.edgeSnapshot().activeId, 'edge-1');
	assert.equal(remotes[0], url);
	assert.equal(fakes.length, 1);
	fakes[0]?.handlers?.onExit(1, null);
	await new Promise(r => setTimeout(r, 40));
	assert.equal(hub.edgeSnapshot().activeId, 'edge-1');
	assert.equal(hub.edgeSnapshot().pendingEdgeId, null);
	assert.equal(fakes.length, 2);
	assert.equal(remotes[1], url);
	assert.equal(
		remotes.some(u => u === undefined),
		false,
		'rebind must pass the committed remote, not fall back to local unix'
	);
	assert.deepEqual(persisted, []);
	hub.closeAll();
});

test('local → remote → local leaves local default metaProjectId uncontaminated', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-round-home-'));
	mkdirSync(path.join(home, 'fast_workspace'), {recursive: true});
	let current = fakeBridge();
	const hub = new WorkspaceHub({
		createBridge: () => {
			current = fakeBridge();
			return current as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-round-cwd-')),
		homeDir: home,
		requestWaitMs: 200,
		registerWaitMs: 200
	});
	const h = handlers();
	hub.ensureEngine(h);
	await new Promise(r => setTimeout(r, 20));
	hub.ensureDefaultProject(h);
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'default-project');
	const localPath = hub.getDefaultProject()!.path;
	current.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'keep-local',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-local-def',
					placement: 'local',
					rootPath: localPath,
					pathHash: 'local-def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'keep-local');

	await hub.switchEdge(
		{
			id: 'edge-1',
			remote: {url: 'wss://10.0.0.2:1980/bridge', authToken: 'tok', timeoutMs: 200}
		},
		h
	);
	current.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'poison-remote',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-remote-def',
					placement: 'local',
					rootPath: '/home/kai/fast_workspace/.default_project',
					pathHash: 'remote-def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'poison-remote');
	assert.notEqual(hub.getDefaultProject()?.path, localPath);

	await hub.switchEdge({id: 'local'}, h);
	const restored = hub.ensureDefaultProject(h);
	assert.equal(restored.path, localPath);
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'default-project');
	assert.notEqual(hub.getDefaultProject()?.metaProjectId, 'poison-remote');

	current.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'keep-local',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-local-def',
					placement: 'local',
					rootPath: localPath,
					pathHash: 'local-def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'keep-local');
	assert.notEqual(hub.getDefaultProject()?.metaProjectId, 'poison-remote');
	hub.closeAll();
});

test('capabilities flip on remote bind', () => {
	const hub = remoteHub(() => fakeBridge());
	assert.equal(hub.edgeSnapshot().capabilities.canOpenLocalFolder, false);
	assert.equal(hub.edgeSnapshot().capabilities.canOpenRemoteFolder, true);
	hub.closeAll();
});

test('openRemoteProject rejects server .default_project', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(
		() => hub.openRemoteProject('/home/kai/fast_workspace/.default_project', handlers()),
		/hidden Default Project/
	);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('pendingEdgeId blocks listHostDir and openRemoteProject', async () => {
	const first = fakeBridge();
	let n = 0;
	const hub = new WorkspaceHub({
		createBridge: () => {
			n += 1;
			if (n === 1) return first as unknown as BridgeClient;
			return {
				start: () =>
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Hello timed out')), 80)
					),
				send: () => true,
				stop() {}
			} as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-pend-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-pend-home-')),
		requestWaitMs: 200,
		registerWaitMs: 200
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const hung = hub.switchEdge(
		{id: 'edge-2', remote: {url: 'wss://10.0.0.9:9/bridge', authToken: 't', timeoutMs: 80}},
		handlers()
	);
	assert.equal(hub.edgeSnapshot().pendingEdgeId, 'edge-2');
	const before = first.commands.filter(c => c.type === 'ListHostDir').length;
	const listed = await hub.listHostDir('/home/kai');
	assert.equal(listed.ok, false);
	assert.equal(first.commands.filter(c => c.type === 'ListHostDir').length, before);
	const created = await hub.createHostDir('/home/kai', 'x');
	assert.equal(created.ok, false);
	await assert.rejects(() => hub.openRemoteProject('/home/kai/x', handlers()), /in progress/);
	await hung.catch(() => {});
	hub.closeAll();
});

test('candidate HelloOk is not persisted if a later switch supersedes it', async () => {
	const persisted: string[] = [];
	let starts = 0;
	const hub = new WorkspaceHub({
		createBridge: () => {
			starts += 1;
			const id = starts;
			return {
				start(_c: string, _h: Fake['handlers']) {
					if (id === 1) {
						return new Promise<void>(resolve => {
							setTimeout(() => {
								_h?.onEvent({type: 'HelloOk', hostHome: '/h'});
								resolve();
							}, 40);
						});
					}
					queueMicrotask(() => _h?.onEvent({type: 'HelloOk', hostHome: '/h'}));
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			} as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-sup-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-sup-home-')),
		persistActiveId: id => persisted.push(id)
	});
	const first = hub.switchEdge(
		{id: 'a', remote: {url: 'wss://10.0.0.1:1/bridge', authToken: 't', timeoutMs: 200}},
		handlers()
	);
	const second = hub.switchEdge(
		{id: 'b', remote: {url: 'wss://10.0.0.2:2/bridge', authToken: 't', timeoutMs: 200}},
		handlers()
	);
	await assert.rejects(first, /aborted/i);
	await second;
	assert.equal(hub.edgeSnapshot().activeId, 'b');
	assert.deepEqual(persisted, ['b']);
	hub.closeAll();
});

test('crash before candidate HelloOk does not persist the unverified edge', async () => {
	const persisted: string[] = [];
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start() {
					return new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Hello timed out')), 40)
					);
				},
				send: () => true,
				stop() {}
			}) as unknown as BridgeClient,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-crash-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-crash-home-')),
		persistActiveId: id => persisted.push(id)
	});
	const pending = hub.switchEdge(
		{id: 'never', remote: {url: 'wss://10.0.0.9:9/bridge', authToken: 't', timeoutMs: 50}},
		handlers()
	);
	assert.deepEqual(persisted, []);
	assert.equal(hub.edgeSnapshot().activeId, 'local');
	await pending.catch(() => {});
	assert.deepEqual(persisted, []);
	hub.closeAll();
});

test('rebind Register remounts a session with AttachSession lastEventSeq', async () => {
	const fakes: Fake[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => {
			const fake = fakeBridge();
			fakes.push(fake);
			return fake as unknown as BridgeClient;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-att-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-att-home-')),
		rebindBaseMs: 5,
		requestWaitMs: 200,
		registerWaitMs: 200
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = await hub.openRemoteProject('/home/kai/code', handlers());
	const project = hub.getById(snap.id);
	assert.ok(project);
	project.sessions.hydrateFromMeta([{id: 'sess-keep', title: 'keep'}]);
	const task = project.sessions.listTasks().find(t => t.sessionId === 'sess-keep');
	assert.ok(task);
	task.lastEventSeq = 7;
	project.sessions.selectTask(task.id);
	fakes[0]?.handlers?.onExit(1, null);
	await new Promise(r => setTimeout(r, 40));
	const second = fakes[1];
	assert.ok(second);
	second.handlers?.onEvent({type: 'ready', protocolVersion: 1});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(second.commands.some(c => c.type === 'RegisterWorkspace' && c.path === '/home/kai/code'));
	const hash = projectHash('/home/kai/code');
	second.handlers?.onEvent({
		type: 'command_result',
		name: 'RegisterWorkspace',
		status: 'accepted',
		message: hash
	});
	await new Promise(r => setTimeout(r, 20));
	project.sessions.selectTask(task.id);
	assert.equal(task.lastEventSeq, 7);
	assert.ok(
		second.commands.some(
			c => c.type === 'AttachSession' && c.sessionId === 'sess-keep' && c.lastEventSeq === 7
		)
	);
	hub.closeAll();
});

test('listHostDir maps file and missing fs codes', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'ListHostDir') {
			const code = cmd.path?.includes('notes.txt') ? 'not-dir' : 'not-found';
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'ListHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: code,
					fs: {code, home: '/home/kai'}
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const file = await hub.listHostDir('/home/kai/notes.txt');
	assert.equal(file.ok, false);
	if (!file.ok) assert.equal(file.code, 'not-dir');
	const missing = await hub.listHostDir('/home/kai/nope');
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.code, 'not-found');
	hub.closeAll();
});

test('hostSkillDiscovery on a missing remote path adds no project skills', () => {
	const found = discoverHostSlashSkills('/no/such/remote/workspace');
	assert.equal(
		found.some(s => s.badge === 'project'),
		false
	);
});
