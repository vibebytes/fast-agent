/** WorkspaceHub tests — ensureEngine / share / rebind. Loaded by WorkspaceHub.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorkspaceHub} from '../WorkspaceHub.js';
import {BridgeClient} from '../BridgeClient.js';
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
