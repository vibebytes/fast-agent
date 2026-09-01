import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {resolveEngineLaunch} from './engineLaunch.js';
import {BridgeClient} from './BridgeClient.js';
import type {BridgeEvent} from '@fastllm/bridge-protocol';

test('resolveEngineLaunch uses workspace cwd and FAST_ENGINE_* env', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/my-project',
		env: {
			FAST_ENGINE_COMMAND: 'node',
			FAST_ENGINE_ARGS: 'scripts/dev/mock-engine.mjs'
		}
	});
	assert.equal(launch.cwd, '/tmp/my-project');
	assert.equal(launch.command, 'node');
	assert.deepEqual(launch.args, ['scripts/dev/mock-engine.mjs', '--continue']);
});

test('resolveEngineLaunch defaults to fast-cli bridge unix when env unset', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/ws',
		env: {},
		bundledEnginePath: '/opt/engine/bin/fast-cli',
		existsSync: () => true
	});
	assert.equal(launch.command, '/opt/engine/bin/fast-cli');
	assert.deepEqual(launch.args, [
		'engine',
		'--mode',
		'bridge',
		'--transport',
		'unix',
		'--continue'
	]);
	assert.equal(launch.cwd, '/tmp/ws');
});

test('resolveEngineLaunch uses stdio when transport forced', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/ws',
		env: {},
		bundledEnginePath: '/opt/engine/bin/fast-cli',
		existsSync: () => true,
		transport: 'stdio'
	});
	assert.deepEqual(launch.args, [
		'engine',
		'--mode',
		'bridge',
		'--transport',
		'stdio',
		'--continue'
	]);
});

test('resolveEngineLaunch uses FAST_BUNDLED_ENGINE when env unset of command', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/ws',
		env: {FAST_BUNDLED_ENGINE: '/pack/engine/bin/fast-cli'},
		existsSync: p => p === '/pack/engine/bin/fast-cli'
	});
	assert.equal(launch.command, '/pack/engine/bin/fast-cli');
	assert.ok(launch.args.includes('unix'));
});

test('resolveEngineLaunch tells you to fetch-engine when nothing is set', () => {
	assert.throws(
		() =>
			resolveEngineLaunch({
				workspaceRoot: '/tmp/ws',
				env: {},
				existsSync: () => false
			}),
		/fetch-engine/
	);
});

test('resolveEngineLaunch respects FAST_SESSION=new', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/ws',
		env: {FAST_ENGINE_COMMAND: 'node', FAST_ENGINE_ARGS: 'engine', FAST_SESSION: 'new'},
		existsSync: () => true
	});
	assert.deepEqual(launch.args, ['engine', '--new']);
});

test('resolveEngineLaunch does not duplicate session flags already in FAST_ENGINE_ARGS', () => {
	const launch = resolveEngineLaunch({
		workspaceRoot: '/tmp/ws',
		env: {
			FAST_ENGINE_COMMAND: 'node',
			FAST_ENGINE_ARGS: 'engine --mode bridge --continue'
		}
	});
	assert.deepEqual(launch.args, ['engine', '--mode', 'bridge', '--continue']);
});

test('BridgeClient reaches ready when mock engine emits ready NDJSON', async () => {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 4242,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});

	const events: BridgeEvent[] = [];
	const errors: string[] = [];
	let readyStatus: string | undefined;

	const client = new BridgeClient({
		spawnImpl: () => child as never
	});

	await new Promise<void>((resolve, reject) => {
		client.start('/tmp/ws', {
			onEvent(event) {
				events.push(event);
				if (event.type === 'ready') {
					readyStatus = 'ready';
					resolve();
				}
			},
			onError(message) {
				errors.push(message);
				reject(new Error(message));
			},
			onExit() {}
		}, {
			env: {FAST_ENGINE_COMMAND: 'mock', FAST_ENGINE_ARGS: 'engine'},
			bundledEnginePath: '/unused'
		});

		queueMicrotask(() => {
			stdout.write(`${JSON.stringify({
				type: 'ready',
				protocolVersion: 2,
				cwd: '/tmp/ws',
				mode: 'bridge',
				sessionId: 's1'
			})}\n`);
		});
	});

	assert.equal(readyStatus, 'ready');
	assert.ok(events.some(e => e.type === 'ready'));
	assert.equal(errors.length, 0);
	client.stop();
});

test('BridgeClient logs invalid engine JSON without failing the engine', async () => {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill() {
			this.killed = true;
		}
	});

	const client = new BridgeClient({
		spawnImpl: () => child as never
	});

	const message = await new Promise<string>(resolve => {
		client.start('/tmp/ws', {
			onEvent() {},
			onError(msg) {
				resolve(`error:${msg}`);
			},
			onLog(msg) {
				resolve(msg);
			},
			onExit() {}
		}, {
			env: {FAST_ENGINE_COMMAND: 'mock', FAST_ENGINE_ARGS: 'x'},
			bundledEnginePath: '/unused'
		});
		queueMicrotask(() => {
			stdout.write('{not-json\n');
		});
	});

	assert.match(message, /Invalid engine event/);
	assert.ok(!message.startsWith('error:'), 'parse failure must not call onError');
	client.stop();
});

test('BridgeClient delivers CommandLoop turn_finished without eventSeq', async () => {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 2,
		kill() {
			this.killed = true;
		}
	});

	const events: BridgeEvent[] = [];
	const logs: string[] = [];
	const client = new BridgeClient({
		spawnImpl: () => child as never
	});

	const got = await new Promise<BridgeEvent>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('turn_finished never reached onEvent')), 1000);
		client.start(
			'/tmp/ws',
			{
				onEvent(event) {
					events.push(event);
					if (event.type === 'turn_finished') {
						clearTimeout(timer);
						resolve(event);
					}
				},
				onError(msg) {
					clearTimeout(timer);
					reject(new Error(msg));
				},
				onLog(msg) {
					logs.push(msg);
				},
				onExit() {}
			},
			{
				env: {FAST_ENGINE_COMMAND: 'mock', FAST_ENGINE_ARGS: 'x'},
				bundledEnginePath: '/unused'
			}
		);
		queueMicrotask(() => {
			stdout.write(`${JSON.stringify({type: 'turn_finished', turnId: 'run-9', success: true})}\n`);
		});
	});

	assert.equal(got.type, 'turn_finished');
	assert.equal(logs.some(l => l.includes('Invalid engine event')), false);
	assert.equal(events.filter(e => e.type === 'turn_finished').length, 1);
	client.stop();
});

