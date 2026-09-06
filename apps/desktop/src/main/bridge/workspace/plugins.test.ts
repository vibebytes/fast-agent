import assert from 'node:assert/strict';
import test from 'node:test';
import {engineWriteTimeout} from './plugins.js';

test('EnableEngine/StartEngine wait longer than DSH first-boot ready', () => {
	assert.equal(engineWriteTimeout('EnableEngine'), 60_000);
	assert.equal(engineWriteTimeout('StartEngine'), 60_000);
	assert.ok(engineWriteTimeout('EnableEngine') > 20_000);
	assert.equal(engineWriteTimeout('DisableEngine'), 12_000);
	assert.equal(engineWriteTimeout('InstallEngine'), 15 * 60_000);
});
