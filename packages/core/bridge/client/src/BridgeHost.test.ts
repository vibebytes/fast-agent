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
