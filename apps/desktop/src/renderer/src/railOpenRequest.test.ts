import assert from 'node:assert/strict';
import test from 'node:test';
import {initialHandledRequestNonce} from './railOpenRequest.js';

test('manual rail expansion suppresses stale open-request replay', () => {
	assert.equal(initialHandledRequestNonce(true, 42), 42);
});

test('content-driven rail expansion replays the request that opened it', () => {
	assert.equal(initialHandledRequestNonce(false, 42), null);
});

test('manual rail expansion without a pending request has no handled nonce', () => {
	assert.equal(initialHandledRequestNonce(true, undefined), null);
});
