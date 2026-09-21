/** WorkspaceHub.remote.test — switchEdge / bind / rebind. Loaded by WorkspaceHub.remote.test.ts. */
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {WorkspaceHub} from '../WorkspaceHub.js';
import type {BridgeClient, BridgeStartOptions} from '../BridgeClient.js';
import {projectHash} from '../projectHash.js';
import {type Fake, fakeBridge, handlers, remoteHub} from './kit.js';


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
