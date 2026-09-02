import assert from 'node:assert/strict';
import test from 'node:test';
import {stopOwnedLocal} from './stopOwnedLocal.js';

const bundled = '/pack/engine/bin/fast-cli';
const ourCmd = `${bundled} engine --mode bridge --transport unix`;
const serverCmd = './bin/agent-cli engine --mode bridge --transport unix --ws 0.0.0.0:1979';

test('stopOwnedLocal no-ops when the unix socket is down', async () => {
	let connected = 0;
	await stopOwnedLocal({
		env: {FAST_BRIDGE_SOCK: '/tmp/missing.sock'},
		tryConnect: async () => false,
		connectUnix: async () => {
			connected += 1;
			throw new Error('must not connect');
		}
	});
	assert.equal(connected, 0);
});

test('stopOwnedLocal still Shutdown when connect is delayed', async () => {
	const cmds: string[] = [];
	await stopOwnedLocal({
		env: {
			FAST_BRIDGE_SOCK: '/tmp/slow.sock',
			FAST_WANT_ENGINE_ID: 'pack-v1',
			HOME: '/tmp'
		},
		tryConnect: async () => true,
		readToken: () => 'tok',
		commandLine: () =>
			'/pack/engine/jre/bin/java -cp /pack/engine/lib/* ai.fastllm.agent.cli.CliApp engine --mode bridge',
		isPidAlive: () => false,
		connectUnix: async (_path, wire) => {
			await new Promise(r => setTimeout(r, 40));
			return {
				socketPath: '/tmp/slow.sock',
				send: cmd => {
					cmds.push(cmd.type);
					if (cmd.type === 'Hello') {
						queueMicrotask(() =>
							wire.onEvent({type: 'HelloOk', engineId: 'pack-v1', daemonPid: 9})
						);
					}
					return true;
				},
				close() {}
			};
		}
	});
	assert.deepEqual(cmds, ['Hello', 'Shutdown']);
});

test('stopOwnedLocal Shutdown when pack stamp matches', async () => {
	const cmds: string[] = [];
	let alive = true;
	await stopOwnedLocal({
		env: {
			FAST_BRIDGE_SOCK: '/tmp/owned.sock',
			FAST_WANT_ENGINE_ID: 'pack-v1',
			HOME: '/tmp'
		},
		tryConnect: async () => true,
		readToken: () => 'tok',
		commandLine: () => ourCmd,
		isPidAlive: () => {
			alive = false;
			return false;
		},
		connectUnix: async (_path, wire) => ({
			socketPath: '/tmp/owned.sock',
			send: cmd => {
				cmds.push(cmd.type);
				if (cmd.type === 'Hello') {
					queueMicrotask(() =>
						wire.onEvent({type: 'HelloOk', engineId: 'pack-v1', daemonPid: 9})
					);
				}
				return true;
			},
			close() {}
		})
	});
	assert.deepEqual(cmds, ['Hello', 'Shutdown']);
	assert.equal(alive, false);
});

test('stopOwnedLocal leaves a public ws host running', async () => {
	const cmds: string[] = [];
	await stopOwnedLocal({
		env: {
			FAST_BRIDGE_SOCK: '/tmp/public.sock',
			FAST_BUNDLED_ENGINE: bundled,
			FAST_WANT_ENGINE_ID: 'pack-v1',
			HOME: '/tmp'
		},
		tryConnect: async () => true,
		readToken: () => 'tok',
		commandLine: () => serverCmd,
		connectUnix: async (_path, wire) => ({
			socketPath: '/tmp/public.sock',
			send: cmd => {
				cmds.push(cmd.type);
				if (cmd.type === 'Hello') {
					queueMicrotask(() =>
						wire.onEvent({type: 'HelloOk', engineId: 'other', daemonPid: 9})
					);
				}
				return true;
			},
			close() {}
		})
	});
	assert.deepEqual(cmds, ['Hello', 'Goodbye']);
});
