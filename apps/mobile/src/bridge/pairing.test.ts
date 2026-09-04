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
