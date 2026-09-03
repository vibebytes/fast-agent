import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	MOBILE_BRIDGE_TOKEN_FILE,
	mobileBridgeEnabled,
	resolveMobileBridgeToken
} from './mobileBridgeToken.js';

test('mobile bridge is on unless FAST_MOBILE_BRIDGE is off', () => {
	assert.equal(mobileBridgeEnabled({}), true);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: '1'}), true);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: '0'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'false'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'off'}), false);
});

test('env token wins over the persisted file', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mb-token-'));
	writeFileSync(join(dir, MOBILE_BRIDGE_TOKEN_FILE), 'disk-token\n');
	assert.equal(
		resolveMobileBridgeToken({
			env: {FAST_MOBILE_BRIDGE_TOKEN: 'env-token'},
			userDataPath: dir
		}),
		'env-token'
	);
});

test('reuses a persisted token and mints one when missing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mb-token-'));
	const first = resolveMobileBridgeToken({env: {}, userDataPath: dir});
	assert.ok(first.length >= 24);
	const path = join(dir, MOBILE_BRIDGE_TOKEN_FILE);
	assert.equal(existsSync(path), true);
	assert.equal(resolveMobileBridgeToken({env: {}, userDataPath: dir}), first);
	assert.equal(readFileSync(path, 'utf8').trim(), first);
});
