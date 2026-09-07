import assert from 'node:assert/strict';
import {test} from 'node:test';

import {pairingPayload} from './pairingPayload.ts';

test('public payload omits fingerprint and carries encoded trust + serverKey', () => {
	const payload = pairingPayload({
		serverUrl: 'https://abc-123.trycloudflare.com/bridge',
		token: 't/1?x',
		trust: 'public',
		serverKey: 'k 1'
	});
	assert.equal(
		payload,
		'fast-bridge://pair?url=https%3A%2F%2Fabc-123.trycloudflare.com%2Fbridge&token=t%2F1%3Fx&trust=public&serverKey=k%201'
	);
});

test('pinned payload keeps encoded fingerprint and omits trust/serverKey', () => {
	const payload = pairingPayload({
		serverUrl: 'wss://192.168.1.10:1979/bridge',
		token: 'tok',
		fingerprint: 'ab:cd'
	});
	assert.equal(
		payload,
		'fast-bridge://pair?url=wss%3A%2F%2F192.168.1.10%3A1979%2Fbridge&token=tok&fingerprint=ab%3Acd'
	);
});
