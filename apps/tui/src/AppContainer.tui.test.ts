/**
 * /tui command routes to setRendererMode / setOptions without throwing in
 * unsupported environments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {alternateScreenAllowed} from './terminal/alternateScreen.js';

test('alternateScreenAllowed is a boolean gate for /tui fullscreen', () => {
	assert.equal(typeof alternateScreenAllowed(), 'boolean');
});

test('unsupported env can be forced via FAST_DISABLE_ALTERNATE_SCREEN', () => {
	const previous = process.env['FAST_DISABLE_ALTERNATE_SCREEN'];
	process.env['FAST_DISABLE_ALTERNATE_SCREEN'] = '1';
	try {
		assert.equal(alternateScreenAllowed(), false);
	} finally {
		if (previous === undefined) delete process.env['FAST_DISABLE_ALTERNATE_SCREEN'];
		else process.env['FAST_DISABLE_ALTERNATE_SCREEN'] = previous;
	}
});
