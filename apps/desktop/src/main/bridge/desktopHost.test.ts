import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createDesktopHost} from './desktopHost.js';
import {isSessionStreamEvent} from './sessionEvents.js';
import {WorkspaceHub} from './WorkspaceHub.js';
import {createUiPublisher} from './uiPublisher.js';
import {projectHash} from './projectHash.js';
import {loadClusterHomes, clusterHomesPath} from './clusterHomes.js';

test('plan_build_submitted is a session-stream event for multi-task demux', () => {
	assert.equal(isSessionStreamEvent('plan_build_submitted'), true);
	assert.equal(isSessionStreamEvent('message_patched'), true);
});

test('subagent_* are session-stream events for multi-task demux', () => {
	assert.equal(isSessionStreamEvent('subagent_started'), true);
	assert.equal(isSessionStreamEvent('subagent_updated'), true);
	assert.equal(isSessionStreamEvent('subagent_finished'), true);
});

test('createDesktopHost has no electron import and serves project:get', async () => {
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start() {},
				stop() {},
				send: () => true,
				onEvent() {},
				onError() {},
				onExit() {},
				onLog() {}
			}) as never
	});
	const publisher = createUiPublisher({
		hub,
		send: () => {}
	});
	const host = createDesktopHost({
		hub,
		publisher,
		getRestoreState: () => ({done: true, failed: false}),
		startHeartbeat: () => {},
		stopHeartbeat: () => {},
		openProjectPath: () => {},
		projectHandlers: () => ({
			onEvent() {},
			onError() {},
			onExit() {}
		}),
		pickDirectory: async () => null,
		documentsDir: () => '/tmp',
		pathExists: () => false,
		mkdirp: () => {},
		showInFolder: () => {},
		readMedia: async () => ({ok: false as const, error: 'x'})
	});

	assert.equal('pet:getVisible' in host, false);
	assert.equal('locale:getSystem' in host, false);
	assert.equal('locale:set' in host, false);
	assert.equal('fs:listDir' in host, false);
	assert.equal('fs:readFile' in host, false);
	assert.equal(typeof host.listWorkspaceDir, 'function');
	assert.equal(typeof host.getWorkspaceFile, 'function');
	assert.equal(typeof host.saveWorkspaceFile, 'function');
	assert.equal(typeof host['project:gitStatus'], 'function');
	assert.equal(typeof host['project:get'], 'function');
	assert.equal(typeof host['task:send'], 'function');
	assert.equal(typeof host['task:buildPlan'], 'function');
	assert.equal(typeof host['task:ensureLive'], 'function');
	assert.equal(typeof host['mention:suggest'], 'function');
	assert.equal(typeof host['workspace:checkRestore'], 'function');
	assert.equal(typeof host['edges:list'], 'function');
	assert.equal(typeof host['host:listDir'], 'function');
	assert.equal(typeof host['host:createDir'], 'function');
	assert.equal(typeof host['project:openRemote'], 'function');
	assert.equal(typeof host['dsh:call'], 'function');
	assert.equal(typeof host['dsh:models'], 'function');
	assert.equal(typeof host['dsh:selectModel'], 'function');
	assert.equal(typeof host['dsh:skills'], 'function');
	assert.equal(typeof host['dsh:settings'], 'function');

	const listed = await Promise.resolve(host.listWorkspaceDir(''));
	assert.equal(listed.ok, false);
	assert.match(listed.ok === false ? listed.error : '', /project not ready/i);

	const live = await Promise.resolve(host['task:ensureLive']([]));
	assert.deepEqual(live, {ok: [], skipped: []});

	const restored = await Promise.resolve(host['workspace:checkRestore']());
	assert.equal(restored.done, true);

	const snap = await Promise.resolve(host['project:get']());
	assert.equal(snap.path, null);
	assert.ok(Array.isArray(snap.projects));

	const pairing = await Promise.resolve(host['mobile:pairingInfo']());
	assert.deepEqual(pairing, {
		available: false,
		reason: 'engine',
		host: '',
		port: 0,
		serverUrl: '',
		token: '',
		fingerprint: ''
	});

	const setPairing = await Promise.resolve(host['mobile:setLanPairing'](true));
	assert.deepEqual(setPairing, {
		available: false,
		reason: 'engine',
		host: '',
		port: 0,
		serverUrl: '',
		token: '',
		fingerprint: ''
	});
});

test('edges:delete of the current edge waits for local HelloOk', async () => {
	const {mkdtempSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const {saveEdgesFile, edgesPath, loadEdgesFile, LOCAL_EDGE_ID} = await import('../remoteEdges.js');
	const dir = mkdtempSync(path.join(tmpdir(), 'host-del-'));
	saveEdgesFile(edgesPath(dir), {
		version: 1,
		activeId: 'edge-1',
		servers: [{id: 'edge-1', name: 'lab', ip: '10.0.0.2', port: 1980, token: {plain: 'tok'}}]
	});
	let n = 0;
	const hub = new WorkspaceHub({
		createBridge: () => {
			n += 1;
			return {
				start(_cwd: string, handlers: {onEvent: (e: {type: string}) => void}) {
					queueMicrotask(() => handlers.onEvent({type: 'HelloOk'}));
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			} as never;
		}
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		getRestoreState: () => ({done: true, failed: false}),
		startHeartbeat: () => {},
		stopHeartbeat: () => {},
		openProjectPath: () => {},
		projectHandlers: () => ({onEvent() {}, onError() {}, onExit() {}}),
		pickDirectory: async () => null,
		documentsDir: () => '/tmp',
		pathExists: () => false,
		mkdirp: () => {},
		showInFolder: () => {},
		readMedia: async () => ({ok: false as const, error: 'x'}),
		userData: () => dir
	});
	const res = await host['edges:delete']('edge-1');
	assert.equal(res.ok, true);
	assert.equal(hub.edgeSnapshot().activeId, LOCAL_EDGE_ID);
	assert.equal(loadEdgesFile(edgesPath(dir)).servers.length, 0);
});

test('edges:delete keeps the row when switch to local fails', async () => {
	const {mkdtempSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const {saveEdgesFile, edgesPath, loadEdgesFile} = await import('../remoteEdges.js');
	const dir = mkdtempSync(path.join(tmpdir(), 'host-del-fail-'));
	saveEdgesFile(edgesPath(dir), {
		version: 1,
		activeId: 'edge-1',
		servers: [{id: 'edge-1', name: 'lab', ip: '10.0.0.2', port: 1980, token: {plain: 'tok'}}]
	});
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start: () => Promise.reject(new Error('Hello timed out')),
				send: () => true,
				stop() {}
			}) as never
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 50
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		getRestoreState: () => ({done: true, failed: false}),
		startHeartbeat: () => {},
		stopHeartbeat: () => {},
		openProjectPath: () => {},
		projectHandlers: () => ({onEvent() {}, onError() {}, onExit() {}}),
		pickDirectory: async () => null,
		documentsDir: () => '/tmp',
		pathExists: () => false,
		mkdirp: () => {},
		showInFolder: () => {},
		readMedia: async () => ({ok: false as const, error: 'x'}),
		userData: () => dir
	});
	const res = await host['edges:delete']('edge-1');
	assert.equal(res.ok, false);
	assert.equal(loadEdgesFile(edgesPath(dir)).servers.length, 1);
	assert.equal(hub.edgeSnapshot().activeId, 'edge-1');
});

test('task:create without projectId does not mkdir on a remote edge', async () => {
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start() {
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			}) as never
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	let mkdir = 0;
	const errors: string[] = [];
	const host = createDesktopHost({
		hub,
		publisher,
		getRestoreState: () => ({done: true, failed: false}),
		startHeartbeat: () => {},
		stopHeartbeat: () => {},
		openProjectPath: () => {},
		projectHandlers: () => ({
			onEvent() {},
			onError(_id, message) {
				errors.push(message);
			},
			onExit() {}
		}),
		pickDirectory: async () => {
			throw new Error('showOpenDialog must not run');
		},
		documentsDir: () => '/tmp',
		pathExists: () => false,
		mkdirp: () => {
			mkdir += 1;
		},
		showInFolder: () => {},
		readMedia: async () => ({ok: false as const, error: 'x'})
	});
	const created = host['task:create']();
	assert.equal(created, null);
	assert.equal(mkdir, 0);
	assert.equal(hub.listAllProjects().length, 0);
	assert.ok(errors.some(m => /host home is unknown/.test(m)));
});

const PIN = `sha256:${'ab'.repeat(32)}`;

function hostStub() {
	return {
		getRestoreState: () => ({done: true, failed: false}),
		startHeartbeat: () => {},
		stopHeartbeat: () => {},
		openProjectPath: () => {},
		projectHandlers: () => ({onEvent() {}, onError() {}, onExit() {}}),
		pickDirectory: async () => null,
		documentsDir: () => '/tmp',
		pathExists: () => false,
		mkdirp: () => {},
		showInFolder: () => {},
		readMedia: async () => ({ok: false as const, error: 'x'})
	};
}

test('edges:test without a pin returns confirm and does not Hello', async () => {
	const seen: Array<{fingerprint?: string; authToken?: string}> = [];
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		probe: async opts => {
			seen.push({fingerprint: opts.fingerprint, authToken: opts.authToken});
			if (!opts.fingerprint) {
				return {ok: false, code: 'confirm', fingerprint: PIN, display: 'AA:BB', message: 'confirm'};
			}
			return {ok: true, fingerprint: opts.fingerprint};
		}
	});
	const res = await host['edges:test']({ip: '10.0.0.2', port: 1979, token: 'tok'});
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'confirm');
		assert.equal(res.fingerprint, PIN);
	}
	assert.equal(seen[0]?.fingerprint, undefined);
});

test('edges:upsert without a pin does not write; with a pin writes after Hello', async () => {
	const {mkdtempSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const {loadEdgesFile, edgesPath} = await import('../remoteEdges.js');
	const dir = mkdtempSync(path.join(tmpdir(), 'host-tofu-'));
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		userData: () => dir,
		probe: async opts => {
			if (!opts.fingerprint) {
				return {ok: false, code: 'confirm', fingerprint: PIN, display: 'AA:BB', message: 'confirm'};
			}
			return {ok: true, fingerprint: opts.fingerprint};
		}
	});
	const pending = await host['edges:upsert']({name: 'lab', ip: '10.0.0.2', port: 1979, token: 'tok'});
	assert.equal(pending.ok, false);
	if (!pending.ok) assert.equal(pending.code, 'confirm');
	assert.equal(loadEdgesFile(edgesPath(dir)).servers.length, 0);

	const saved = await host['edges:upsert']({
		name: 'lab',
		ip: '10.0.0.2',
		port: 1979,
		token: 'tok',
		fingerprint: PIN
	});
	assert.equal(saved.ok, true);
	assert.equal(loadEdgesFile(edgesPath(dir)).servers[0]?.fingerprint, PIN);
});

test('edges:upsert refuses to write on fingerprint mismatch', async () => {
	const {mkdtempSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const {loadEdgesFile, edgesPath} = await import('../remoteEdges.js');
	const dir = mkdtempSync(path.join(tmpdir(), 'host-mismatch-'));
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		userData: () => dir,
		probe: async () => ({ok: false, code: 'mismatch', message: 'nope'})
	});
	const res = await host['edges:upsert']({
		name: 'lab',
		ip: '10.0.0.2',
		port: 1979,
		token: 'tok',
		fingerprint: PIN
	});
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'mismatch');
	assert.equal(loadEdgesFile(edgesPath(dir)).servers.length, 0);
});

test('edges:select refuses an unpinned stored server', async () => {
	const {mkdtempSync} = await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const {saveEdgesFile, edgesPath} = await import('../remoteEdges.js');
	const dir = mkdtempSync(path.join(tmpdir(), 'host-unpin-'));
	saveEdgesFile(edgesPath(dir), {
		version: 1,
		activeId: 'local',
		servers: [{id: 'edge-1', name: 'lab', ip: '10.0.0.2', port: 1980, token: {plain: 'tok'}}]
	});
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		userData: () => dir
	});
	const res = await host['edges:select']('edge-1');
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'unpinned');
});

test('cluster:open switches via wss like a remote server', async () => {
	const remotes: Array<{url?: string; authToken?: string; fingerprint?: string}> = [];
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start(_cwd: string, handlers: {onEvent: (e: {type: string}) => void}, opts?: {remote?: {url?: string; authToken?: string; fingerprint?: string}}) {
					remotes.push({
						url: opts?.remote?.url,
						authToken: opts?.remote?.authToken,
						fingerprint: opts?.remote?.fingerprint
					});
					queueMicrotask(() => handlers.onEvent({type: 'HelloOk'}));
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			}) as never
	});
	hub.rememberClusterRoster([
		{
			id: 'b',
			displayName: '小B',
			endpoints: ['wss://127.0.0.1:1982/bridge'],
			token: 'tok-b',
			fingerprint: PIN
		}
	]);
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		inspect: async () => PIN
	});
	const res = await host['cluster:open']({agentId: 'b'});
	assert.equal(res.ok, true);
	assert.equal(res.message, '没有主会话');
	assert.equal(remotes[0]?.url, 'wss://127.0.0.1:1982/bridge');
	assert.equal(remotes[0]?.authToken, 'tok-b');
	assert.equal(remotes[0]?.fingerprint, PIN);
});

test('cluster:open refuses a card without wss', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub()
	});
	const res = await host['cluster:open']({
		agentId: 'b',
		endpoints: ['unix:///tmp/b.sock'],
		token: 'tok-b'
	});
	assert.equal(res.ok, false);
	assert.equal(res.message, '不可连接');
});

test('cluster:open attaches the main session even when meta has not listed it', async () => {
	const starts: string[] = [];
	const commands: Array<{type: string; sessionId?: string}> = [];
	let live: {onEvent: (e: {type: string; hostHome?: string; name?: string; status?: string; message?: string}) => void} | undefined;
	const home = mkdtempSync(path.join(tmpdir(), 'cluster-open-home-'));
	const data = mkdtempSync(path.join(tmpdir(), 'cluster-open-data-'));
	const hub = new WorkspaceHub({
		homeDir: home,
		createBridge: () =>
			({
				start(_cwd: string, handlers: typeof live, opts?: {remote?: {url?: string}}) {
					live = handlers;
					starts.push(opts?.remote?.url ?? 'local');
					queueMicrotask(() => handlers?.onEvent({type: 'HelloOk', hostHome: '/home/kai'}));
					return Promise.resolve();
				},
				send(cmd: {type: string; path?: string; sessionId?: string}) {
					commands.push(cmd);
					if (cmd.type === 'RegisterWorkspace' && cmd.path) {
						const message = projectHash(cmd.path);
						queueMicrotask(() =>
							live?.onEvent({
								type: 'command_result',
								name: 'RegisterWorkspace',
								status: 'accepted',
								message
							})
						);
					}
					return true;
				},
				stop() {}
			}) as never
	});
	hub.rememberClusterRoster([
		{
			id: 'b',
			displayName: '小B',
			endpoints: ['wss://127.0.0.1:1982/bridge'],
			token: 'tok-b',
			fingerprint: PIN,
			mainSessionId: 'sess-b'
		}
	]);
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		userData: () => data,
		inspect: async () => PIN
	});
	const res = await host['cluster:open']({agentId: 'b'});
	assert.equal(res.ok, true);
	assert.equal(res.message, undefined);
	const task = hub.getDefaultProject()?.sessions.listTasks().find(t => t.sessionId === 'sess-b');
	assert.equal(task?.sessionType, 'main');
	assert.equal(hub.getDefaultProject()?.sessions.getActiveTask()?.sessionId, 'sess-b');
	await new Promise(r => setTimeout(r, 30));
	assert.ok(commands.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-b'));
	assert.equal(loadClusterHomes(clusterHomesPath(data)).b?.sessionId, 'sess-b');
	const again = await host['cluster:open']({
		agentId: 'b',
		endpoints: ['wss://127.0.0.1:1982/bridge'],
		token: 'tok-b',
		fingerprint: PIN,
		mainSessionId: 'sess-b'
	});
	assert.equal(again.ok, true);
	assert.equal(starts.length, 1);
});

test('cluster:open refuses a fingerprint that does not match and does not Hello', async () => {
	let started = 0;
	const hub = new WorkspaceHub({
		createBridge: () =>
			({
				start() {
					started += 1;
					return Promise.resolve();
				},
				send: () => true,
				stop() {}
			}) as never
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		inspect: async () => 'sha256:other'
	});
	const res = await host['cluster:open']({
		agentId: 'b',
		endpoints: ['wss://127.0.0.1:1982/bridge'],
		token: 'tok-b',
		fingerprint: PIN,
		mainSessionId: 'sess-b'
	});
	assert.equal(res.ok, false);
	assert.equal(res.message, '指纹不符');
	assert.equal(started, 0);
});

test('cluster:open self switches back to local and drops the peer projects', async () => {
	const starts: string[] = [];
	const commands: Array<{type: string; sessionId?: string}> = [];
	let live: {onEvent: (e: {type: string; hostHome?: string; name?: string; status?: string; message?: string; tenantId?: string; appId?: string; projects?: unknown[]; sessionsByProjectId?: Record<string, unknown>}) => void} | undefined;
	const home = mkdtempSync(path.join(tmpdir(), 'cluster-self-home-'));
	const data = mkdtempSync(path.join(tmpdir(), 'cluster-self-data-'));
	const hub = new WorkspaceHub({
		hostCwd: mkdtempSync(path.join(tmpdir(), 'cluster-self-cwd-')),
		homeDir: home,
		createBridge: () =>
			({
				start(_cwd: string, handlers: typeof live, opts?: {remote?: {url?: string}}) {
					live = handlers;
					starts.push(opts?.remote?.url ?? 'local');
					queueMicrotask(() => handlers?.onEvent({type: 'HelloOk', hostHome: '/home/kai'}));
					return Promise.resolve();
				},
				send(cmd: {type: string; path?: string; sessionId?: string}) {
					commands.push(cmd);
					if (cmd.type === 'RegisterWorkspace' && cmd.path) {
						const message = projectHash(cmd.path);
						queueMicrotask(() =>
							live?.onEvent({
								type: 'command_result',
								name: 'RegisterWorkspace',
								status: 'accepted',
								message
							})
						);
					}
					return true;
				},
				stop() {}
			}) as never
	});
	hub.rememberClusterRoster([
		{
			id: 'local',
			displayName: '本机',
			self: true,
			mainSessionId: 'sess-a'
		},
		{
			id: 'b',
			displayName: '小B',
			endpoints: ['wss://127.0.0.1:1982/bridge'],
			token: 'tok-b',
			fingerprint: PIN,
			mainSessionId: 'sess-b'
		}
	]);
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		userData: () => data,
		inspect: async () => PIN
	});
	const remote = await host['cluster:open']({agentId: 'b'});
	assert.equal(remote.ok, true);
	assert.ok(starts.includes('wss://127.0.0.1:1982/bridge'));
	live?.onEvent({
		type: 'workspace_meta',
		tenantId: 'b',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-b',
				projectType: 'general',
				displayName: 'B Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-b',
					placement: 'local',
					rootPath: '/home/kai/fast_workspace/.default_project',
					pathHash: 'b-def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.metaProjectId, 'proj-b');
	const back = await host['cluster:open']({
		self: true,
		agentId: 'local',
		mainSessionId: 'sess-a'
	});
	assert.equal(back.ok, true);
	assert.equal(hub.edgeSnapshot().activeId, 'local');
	assert.ok(starts.includes('local'));
	assert.notEqual(hub.getDefaultProject()?.metaProjectId, 'proj-b');
	assert.equal(
		hub.listAllProjects().some(p => p.displayName === 'B Project'),
		false
	);
	await new Promise(r => setTimeout(r, 30));
	assert.ok(commands.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-a'));
});

test('cluster:probe marks a dead wss down and a missing main session separately', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({
		hub,
		publisher,
		...hostStub(),
		inspect: async url => (url.includes('1982') ? PIN : null)
	});
	const probed = await host['cluster:probe']([
		{id: 'down', endpoints: ['unix:///tmp/b.sock'], fingerprint: PIN, mainSessionId: 's'},
		{id: 'bad', endpoints: ['wss://127.0.0.1:1982/bridge'], fingerprint: 'sha256:nope', mainSessionId: 's'},
		{id: 'plain', endpoints: ['wss://127.0.0.1:1982/bridge'], fingerprint: PIN}
	]);
	assert.equal(probed.items.find(row => row.agentId === 'down')?.message, '不可连接');
	assert.equal(probed.items.find(row => row.agentId === 'bad')?.message, '指纹不符');
	assert.equal(probed.items.find(row => row.agentId === 'plain')?.reach, 'no-main');
});

test('edges:list names the local cluster self', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	hub.rememberClusterRoster([
		{id: 'a', displayName: '小A', self: true, mainSessionId: 'sess-a'},
		{id: 'b', displayName: '小B', mainSessionId: 'sess-b'}
	]);
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({hub, publisher, ...hostStub()});
	const listed = await host['edges:list']();
	assert.equal(listed.activeId, 'local');
	assert.equal(listed.nodeName, '小A');
});

test('edges:list names the open cluster individual', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never)
	});
	hub.bindCommittedEdge('individual:b');
	hub.rememberClusterRoster([
		{id: 'a', displayName: '小A', self: true},
		{id: 'b', displayName: '小B'}
	]);
	const publisher = createUiPublisher({hub, send: () => {}});
	const host = createDesktopHost({hub, publisher, ...hostStub()});
	const listed = await host['edges:list']();
	assert.equal(listed.activeId, 'individual:b');
	assert.equal(listed.nodeName, '小B');
});
