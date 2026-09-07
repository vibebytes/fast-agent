import assert from 'node:assert/strict';
import {test} from 'node:test';

import {parsePairingPayload} from './pairing.ts';

test('parsePairingPayload keeps lan wss url, token, and fingerprint from desktop QR', () => {
	const url = 'wss://192.168.1.5:1979/bridge';
	const token = '_roJ45abcdefghijklmnopqrstuvwx';
	const fingerprint = 'sha256:' + 'ab'.repeat(32);
	const raw = `fast-bridge://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&fingerprint=${encodeURIComponent(fingerprint)}`;
	const parsed = parsePairingPayload(raw);
	assert.deepEqual(parsed, {serverUrl: url, token, fingerprint});
});

test('parsePairingPayload reads cloudflare QR trust=public and serverKey, no fingerprint', () => {
	const url = 'https://abc-123.trycloudflare.com/bridge';
	const token = '_roJ45abcdefghijklmnopqrstuvwx';
	const serverKey = '0d3f6a2e-1c4b-4a5f-9e2d-7f8a1b2c3d4e';
	const raw = `fast-bridge://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&trust=public&serverKey=${encodeURIComponent(serverKey)}`;
	const parsed = parsePairingPayload(raw);
	assert.deepEqual(parsed, {serverUrl: url, token, fingerprint: null, trust: 'public', serverKey});
});

test('parsePairingPayload falls back to pinned when trust value is unknown', () => {
	const url = 'wss://192.168.1.5:1979/bridge';
	const raw = `fast-bridge://pair?url=${encodeURIComponent(url)}&token=abc&trust=weird`;
	const parsed = parsePairingPayload(raw);
	assert.deepEqual(parsed, {serverUrl: url, token: 'abc', fingerprint: null});
});

test('parsePairingPayload reads trust and serverKey from JSON payloads', () => {
	const raw = JSON.stringify({serverUrl: 'https://x.trycloudflare.com/bridge', token: 't1', trust: 'public', serverKey: 'key-1'});
	const parsed = parsePairingPayload(raw);
	assert.deepEqual(parsed, {serverUrl: 'https://x.trycloudflare.com/bridge', token: 't1', fingerprint: null, trust: 'public', serverKey: 'key-1'});
});

test('parsePairingPayload ignores blank serverKey', () => {
	const url = 'https://abc-123.trycloudflare.com/bridge';
	const raw = `fast-bridge://pair?url=${encodeURIComponent(url)}&token=abc&trust=public&serverKey=%20%20`;
	const parsed = parsePairingPayload(raw);
	assert.deepEqual(parsed, {serverUrl: url, token: 'abc', fingerprint: null, trust: 'public'});
});
