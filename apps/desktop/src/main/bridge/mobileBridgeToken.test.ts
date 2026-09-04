import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileBridgeEnabled} from './mobileBridgeToken.js';

test('mobile bridge is off unless FAST_MOBILE_BRIDGE is on', () => {
	assert.equal(mobileBridgeEnabled({}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: '0'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'false'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'off'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'no'}), false);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: '1'}), true);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'true'}), true);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'on'}), true);
	assert.equal(mobileBridgeEnabled({FAST_MOBILE_BRIDGE: 'yes'}), true);
});
