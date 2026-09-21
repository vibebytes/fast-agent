/** WorkspaceHub tests — catalog / listEngines / pairing. Loaded by WorkspaceHub.test.ts. */
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

test('engineCall times out with requestId when Engine emits no command_result', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		requestWaitMs: 200
	});
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-dsh-to-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const result = await hub.engineCall('settings.describe', {});
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.match(result.error.message ?? '', /timeout waiting for requestId /);
	const sent = commands.find(c => c.type === 'EngineCall');
	assert.ok(sent && sent.type === 'EngineCall');
	if (sent.type === 'EngineCall') {
		assert.ok(sent.requestId);
		assert.match(result.error.message ?? '', new RegExp(sent.requestId));
		assert.equal(sent.engineKind, 'fast');
	}
	hub.closeAll();
});

test('engineCall resolves settings.describe by requestId', async () => {
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

	const pending = hub.engineCall('settings.describe', {});
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'EngineCall');
	assert.ok(sent && sent.type === 'EngineCall');
	if (sent.type !== 'EngineCall') return;

	bridge!.__inject({
		type: 'command_result',
		name: 'GetSettings',
		message: 'wrong name must not steal',
		status: 'accepted',
		requestId: 'not-the-dsh-call'
	});
	bridge!.__inject({
		type: 'command_result',
		name: 'EngineCall',
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

test('engineCall sends the Composer engineKind so session.models can hit dsh before submit', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-')),
		requestWaitMs: 200
	});
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-dsh-kind-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const project = hub.getActive();
	assert.ok(project);
	project.sessions.setAvailableEngines(['fast', 'dsh']);
	assert.equal(project.sessions.setEngineKind('dsh'), true);

	void hub.engineCall('session.models', {}, project.sessions.getActiveTask()?.sessionId ?? undefined);
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'EngineCall');
	assert.ok(sent && sent.type === 'EngineCall');
	if (sent.type === 'EngineCall') {
		assert.equal(sent.engineKind, 'dsh');
	}
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
	await settleReadyEngines(bridge, commands);

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

test('listEngines offers dsh when adapter is ready even if not yet inRegistry', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-eng-ready-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	assert.ok(commands.some(c => c.type === 'ListEngines'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListEngines',
		message: '2 engines',
		status: 'accepted',
		engines: [
			engineRow('fast', {inRegistry: true}),
			engineRow('dsh', {inRegistry: false, process: 'stopped', actions: ['start']})
		]
	});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(hub.getActive()?.sessions.availableEngineIds().includes('dsh'));
	hub.closeAll();
});

test('new project inherits picker engines from last ListEngines', async () => {
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
	const first = mkdtempSync(path.join(tmpdir(), 'proj-eng-a-'));
	hub.openProject(first, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	assert.ok(commands.some(c => c.type === 'ListEngines'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListEngines',
		message: '2 engines',
		status: 'accepted',
		engines: [
			engineRow('fast', {inRegistry: true}),
			engineRow('dsh', {inRegistry: true, process: 'running', actions: ['stop']})
		]
	});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(hub.getActive()?.sessions.availableEngineIds().includes('dsh'));

	const second = mkdtempSync(path.join(tmpdir(), 'proj-eng-b-'));
	const opened = hub.openProject(second, noopHandlers());
	assert.ok(
		hub.getById(opened.id)?.sessions.availableEngineIds().includes('dsh'),
		'late-opened project must keep DSH in the engine picker'
	);
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
	await settleReadyEngines(bridge, commands);
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
	await settleReadyEngines(bridge, commands);

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
test('getBridgePairing is unavailable with reason engine when the daemon is down', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => {
			throw new Error('no engine');
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const info = await hub.getBridgePairing();
	assert.deepEqual(info, {
		available: false,
		reason: 'engine',
		host: '',
		port: 0,
		serverUrl: '',
		token: '',
		fingerprint: ''
	});
});

test('getBridgePairing maps an available engine snapshot', async () => {
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
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-pair-ok-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.getBridgePairing();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'GetBridgePairing'));
	bridge!.__inject({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: '',
		status: 'accepted',
		pairing: {
			available: true,
			host: '192.168.1.8',
			port: 1979,
			serverUrl: 'wss://192.168.1.8:1979/bridge',
			token: 'tok',
			fingerprint: 'sha256:' + 'ab'.repeat(32)
		}
	});
	const info = await pending;
	assert.equal(info.available, true);
	assert.equal(info.host, '192.168.1.8');
	assert.equal(info.port, 1979);
	assert.equal(info.serverUrl, 'wss://192.168.1.8:1979/bridge');
	assert.equal(info.token, 'tok');
	hub.closeAll();
});

test('getBridgePairing is off when the engine pairing is disabled', async () => {
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
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-pair-off-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.getBridgePairing();
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: '',
		status: 'accepted',
		pairing: {available: false, reason: 'off'}
	});
	const info = await pending;
	assert.equal(info.available, false);
	assert.equal(info.reason, 'off');
	hub.closeAll();
});

test('getBridgePairing is no_lan when the engine has loopback_only', async () => {
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
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-pair-nolan-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.getBridgePairing();
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: '',
		status: 'accepted',
		pairing: {available: false, reason: 'loopback_only'}
	});
	const info = await pending;
	assert.equal(info.available, false);
	assert.equal(info.reason, 'no_lan');
	hub.closeAll();
});

test('getBridgePairing keeps the engine token when the snapshot is unavailable', async () => {
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
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-pair-token-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.getBridgePairing();
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'GetBridgePairing',
		message: '',
		status: 'accepted',
		pairing: {available: false, reason: 'no_wss', token: 'engine-token', fingerprint: ''}
	});
	const info = await pending;
	assert.equal(info.available, false);
	assert.equal(info.reason, 'off');
	assert.equal(info.token, 'engine-token');
	hub.closeAll();
});

test('setLanPairing sends SetLanPairing command to bridge and awaits result', async () => {
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
	hub.openProject(mkdtempSync(path.join(tmpdir(), 'proj-set-lan-')), noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.setLanPairing(true);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'SetLanPairing' && (c as any).enabled === true));
	bridge!.__inject({
		type: 'command_result',
		name: 'SetLanPairing',
		message: '',
		status: 'accepted',
		pairing: {
			available: true,
			host: '192.168.1.10',
			port: 1979,
			serverUrl: 'wss://192.168.1.10:1979/bridge',
			token: 'tok-2',
			fingerprint: 'sha256:' + 'cd'.repeat(32)
		}
	});
	const info = await pending;
	assert.equal(info.available, true);
	assert.equal(info.host, '192.168.1.10');
	assert.equal(info.serverUrl, 'wss://192.168.1.10:1979/bridge');
	hub.closeAll();
});
