import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyProbeError, probeBridge} from './probe.js';
import type {WsConnection, WsConnectionHandlers} from './wsConnection.js';

const PIN = `sha256:${'ab'.repeat(32)}`;

test('classifyProbeError maps tls / timeout / HelloReject codes', () => {
	assert.equal(classifyProbeError(new Error('self-signed certificate')).code, 'tls');
	assert.equal(classifyProbeError(new Error('WebSocket connect timed out')).code, 'timeout');
	const abort = Object.assign(new Error('aborted'), {name: 'AbortError'});
	assert.equal(classifyProbeError(abort).code, 'timeout');
	assert.equal(classifyProbeError(new Error('HelloReject: UNAUTHORIZED — bad token')).code, 'auth');
	assert.equal(classifyProbeError(new Error('HelloReject: VERSION_MISMATCH')).code, 'protocol');
	assert.equal(classifyProbeError(new Error('Certificate fingerprint does not match')).code, 'mismatch');
	const boring = new Error(
		'1219771550976:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:../../third_party/boringssl/src/ssl/tls_record.cc:127:'
	);
	assert.equal(classifyProbeError(boring).code, 'plaintext');
});

test('probeBridge maps a plaintext port to plaintext, not a raw TLS dump', async () => {
	const res = await probeBridge(
		{url: 'wss://10.0.0.2:1980/bridge', authToken: 't', timeoutMs: 200},
		async () => {
			throw new Error('connect must not run');
		},
		async () => {
			throw new Error(
				'1219771550976:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:../../third_party/boringssl/src/ssl/tls_record.cc:127:'
			);
		}
	);
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'plaintext');
		assert.match(res.message, /plaintext/i);
		assert.equal(res.message.includes('WRONG_VERSION_NUMBER'), false);
	}
});

test('probeBridge on plaintext ws skips fingerprint inspect and Hellos', async () => {
	const res = await probeBridge(
		{url: 'ws://127.0.0.1:1979/bridge', authToken: 'tok', timeoutMs: 200},
		async (url, wire) => {
			queueMicrotask(() => wire.onEvent({type: 'HelloOk'}));
			return {url, send: () => true, close() {}};
		},
		async () => {
			throw new Error('inspect must not run for ws://');
		}
	);
	assert.equal(res.ok, true);
});

test('probeBridge without a pin inspects TLS and does not Hello', async () => {
	let connected = 0;
	const res = await probeBridge(
		{url: 'wss://10.0.0.2:1980/bridge', authToken: 'secret', timeoutMs: 200},
		async () => {
			connected += 1;
			throw new Error('connect must not run before confirm');
		},
		async url => {
			assert.equal(url, 'wss://10.0.0.2:1980/bridge');
			return {fingerprint: PIN, display: 'AA:BB'};
		}
	);
	assert.equal(connected, 0);
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'confirm');
		assert.equal(res.fingerprint, PIN);
		assert.equal(res.display, 'AA:BB');
	}
});

test('probeBridge fails HelloReject UNAUTHORIZED as auth', async () => {
	const res = await probeBridge(
		{url: 'wss://10.0.0.2:1980/bridge', authToken: 'bad', fingerprint: PIN, timeoutMs: 200},
		async (url, wire) => {
			queueMicrotask(() =>
				wire.onEvent({type: 'HelloReject', code: 'UNAUTHORIZED', message: 'bad token'})
			);
			return {
				url,
				send: () => true,
				close() {}
			} satisfies WsConnection;
		}
	);
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'auth');
});

test('probeBridge fails when TCP opens but Hello never arrives', async () => {
	const res = await probeBridge(
		{url: 'wss://10.0.0.2:1980/bridge', authToken: 't', fingerprint: PIN, timeoutMs: 40},
		async url =>
			({
				url,
				send: () => true,
				close() {}
			}) satisfies WsConnection
	);
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'timeout');
});

test('probeBridge times out a dead socket within the deadline', async () => {
	const started = Date.now();
	const res = await probeBridge(
		{url: 'wss://10.255.255.1:9/bridge', authToken: 't', fingerprint: PIN, timeoutMs: 40},
		(_url, _wire, opts) =>
			new Promise<WsConnection>((_resolve, reject) => {
				opts?.signal?.addEventListener(
					'abort',
					() => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})),
					{once: true}
				);
			})
	);
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'timeout');
	assert.ok(Date.now() - started < 200);
});

test('probeBridge connect URL has no token query', async () => {
	const urls: string[] = [];
	const res = await probeBridge(
		{url: 'wss://10.0.0.2:1980/bridge', authToken: 'secret-token', fingerprint: PIN, timeoutMs: 200},
		async (url, wire: WsConnectionHandlers) => {
			urls.push(url);
			queueMicrotask(() => wire.onEvent({type: 'HelloOk'}));
			return {url, send: () => true, close() {}};
		}
	);
	assert.equal(urls[0], 'wss://10.0.0.2:1980/bridge');
	assert.equal(urls[0]?.includes('secret'), false);
	assert.equal(res.ok, true);
	if (res.ok) assert.equal(res.fingerprint, PIN);
});
