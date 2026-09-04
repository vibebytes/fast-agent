import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDesktopHost} from './desktopHost.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';
import {WorkspaceHub} from './WorkspaceHub.js';
import {createUiPublisher} from './uiPublisher.js';

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
