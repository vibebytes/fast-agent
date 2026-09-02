import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {BridgeHost} from './BridgeHost.js';
import type {WsConnection, WsConnectionHandlers} from './wsConnection.js';

function openConn(url: string, wire: WsConnectionHandlers): WsConnection {
	return {
		url,
		send: () => true,
		close() {
			wire.onClose();
		}
	};
}

test('remote connect does not call ensureDaemon, omits cwd, and keeps token out of the URL', async () => {
	const urls: string[] = [];
	const hellos: Array<Record<string, unknown>> = [];
	let ensured = 0;
	const host = new BridgeHost({
		ensureDaemon: async () => {
			ensured += 1;
			throw new Error('ensureDaemon must not run for remote');
		},
		connectWs: async (url, wire) => {
			urls.push(url);
			const conn = openConn(url, wire);
			conn.send = cmd => {
				if (cmd.type === 'Hello') {
					hellos.push(cmd as unknown as Record<string, unknown>);
					queueMicrotask(() => wire.onEvent({type: 'HelloOk', hostHome: '/home/kai'}));
				}
				return true;
			};
			return conn;
		}
	});
	const logs: string[] = [];
	await host.connect(
		{
			clientKind: 'fast-ide',
			cwd: join(homedir(), 'local-project'),
			remote: {
				url: 'wss://10.0.0.2:1980/bridge',
				authToken: 'secret-token',
				timeoutMs: 200
			}
		},
		{
			onEvent: () => {},
			onError: () => {},
			onLog: message => logs.push(message),
			onClose: () => {}
		}
	);
	assert.equal(ensured, 0);
	assert.deepEqual(urls, ['wss://10.0.0.2:1980/bridge']);
	assert.equal(hellos[0]?.cwd, undefined);
	assert.equal(hellos[0]?.authToken, 'secret-token');
	assert.equal(
		logs.some(l => l.includes('secret-token')),
		false
	);
	host.stop();
});

test('local connect replaces host when packed engineId disagrees', async () => {
	let ensures = 0;
	const cmds: string[] = [];
	const helloId = ['old-id', 'new-id'];
	const host = new BridgeHost({
		ensureDaemon: async () => {
			ensures += 1;
			return {socketPath: `/tmp/bridge-replace-${ensures}.sock`, token: 'tok', spawned: ensures > 1};
		},
		connectUnix: async (_path, wire) => {
			const i = ensures - 1;
			return {
				socketPath: `/tmp/bridge-replace-${ensures}.sock`,
				send: cmd => {
					cmds.push(cmd.type);
					if (cmd.type === 'Hello') {
						queueMicrotask(() =>
							wire.onEvent({
								type: 'HelloOk',
								engineId: helloId[i] ?? 'new-id',
								daemonPid: 42
							})
						);
					}
					if (cmd.type === 'Shutdown') {
						queueMicrotask(() => wire.onEvent({type: 'daemon_shutting_down'}));
					}
					return true;
				},
				close() {
					wire.onClose();
				}
			};
		}
	});
	await host.connect(
		{
			clientKind: 'fast-ide',
			wantEngineId: 'new-id',
			env: {FAST_BUNDLED_ENGINE: '/pack/engine/bin/fast-cli'},
			commandLine: () => '/pack/engine/bin/fast-cli engine --mode bridge --transport unix',
			isPidAlive: () => false,
			heartbeatMs: 0
		},
		{onEvent: () => {}, onError: () => {}, onClose: () => {}}
	);
	assert.equal(ensures, 2);
	assert.ok(cmds.includes('Shutdown'));
	assert.equal(host.engineId, 'new-id');
	host.stop();
});

test('stopLocal Shutdown without SIGTERM when we own the host', async () => {
	const cmds: string[] = [];
	const killed: number[] = [];
	const host = new BridgeHost({
		ensureDaemon: async () => ({socketPath: '/tmp/stop-local.sock', token: 'tok', spawned: true}),
		connectUnix: async (_path, wire) => ({
			socketPath: '/tmp/stop-local.sock',
			send: cmd => {
				cmds.push(cmd.type);
				if (cmd.type === 'Hello') {
					queueMicrotask(() =>
						wire.onEvent({type: 'HelloOk', engineId: 'v1', daemonPid: 7})
					);
				}
				return true;
			},
			close() {
				wire.onClose();
			}
		})
	});
	await host.connect(
		{
			clientKind: 'fast-ide',
			env: {FAST_BUNDLED_ENGINE: '/pack/engine/bin/fast-cli'},
			commandLine: () => '/pack/engine/bin/fast-cli engine --mode bridge --transport unix',
			isPidAlive: () => false,
			killPid: pid => {
				killed.push(pid);
			},
			heartbeatMs: 0
		},
		{onEvent: () => {}, onError: () => {}, onClose: () => {}}
	);
	await host.stopLocal({env: {FAST_BUNDLED_ENGINE: '/pack/engine/bin/fast-cli'}});
	assert.ok(cmds.includes('Shutdown'));
	assert.ok(cmds.includes('Goodbye'));
	assert.deepEqual(killed, []);
});

test('Hello timeout closes the unix connection', async () => {
	let closed = 0;
	const host = new BridgeHost({
		ensureDaemon: async () => ({socketPath: '/tmp/hello-leak.sock', token: 'tok', spawned: true}),
		connectUnix: async (_path, wire) => ({
			socketPath: '/tmp/hello-leak.sock',
			send: () => true,
			close() {
				closed += 1;
				wire.onClose();
			}
		}),
		connectWs: async (_url, wire, opts) => {
			void opts;
			return {
				url: 'wss://10.0.0.2:1980/bridge',
				send: () => true,
				close() {
					closed += 1;
					wire.onClose();
				}
			};
		}
	});
	await assert.rejects(
		host.connect(
			{
				clientKind: 'fast-ide',
				remote: {url: 'wss://10.0.0.2:1980/bridge', authToken: 't', timeoutMs: 40},
				heartbeatMs: 0
			},
			{onEvent: () => {}, onError: () => {}, onClose: () => {}}
		),
		/Hello timed out/
	);
	assert.equal(closed, 1);
});

test('stop during remote open rejects instead of resolving without HelloOk', async () => {
	let release!: (conn: WsConnection) => void;
	const host = new BridgeHost({
		connectWs: (_url, wire) =>
			new Promise(resolve => {
				release = conn => resolve(conn);
				void wire;
			})
	});
	const pending = host.connect(
		{
			clientKind: 'fast-ide',
			remote: {url: 'wss://10.0.0.2:1980/bridge', authToken: 't', timeoutMs: 200}
		},
		{onEvent: () => {}, onError: () => {}, onClose: () => {}}
	);
	host.stop();
	release(openConn('wss://10.0.0.2:1980/bridge', {onEvent: () => {}, onError: () => {}, onClose: () => {}}));
	await assert.rejects(pending, err => err instanceof Error && err.name === 'AbortError');
});
