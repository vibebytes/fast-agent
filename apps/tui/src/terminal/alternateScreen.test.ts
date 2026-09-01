import test from 'node:test';
import assert from 'node:assert/strict';
import {alternateScreenAllowed} from './alternateScreen.js';

function withEnv<T>(patch: Record<string, string | undefined>, callback: () => T): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(patch)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return callback();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('alternateScreenAllowed is vetoed by FAST_DISABLE_ALTERNATE_SCREEN=1', () => {
	withEnv({FAST_DISABLE_ALTERNATE_SCREEN: '1'}, () => {
		assert.equal(alternateScreenAllowed(), false);
	});
});

test('alternateScreenAllowed is vetoed for screen readers', () => {
	withEnv({FAST_SCREEN_READER: '1', FAST_DISABLE_ALTERNATE_SCREEN: undefined}, () => {
		assert.equal(alternateScreenAllowed(), false);
	});
});

test('alternateScreenAllowed is vetoed for dumb terminals and non-TTY stdout', () => {
	withEnv({TERM: 'dumb', FAST_SCREEN_READER: undefined, FAST_DISABLE_ALTERNATE_SCREEN: undefined}, () => {
		assert.equal(alternateScreenAllowed(), false);
	});
	// Test runners are not TTYs, so the plain environment is also vetoed.
	if (!process.stdout.isTTY) {
		withEnv({TERM: 'xterm-256color', FAST_SCREEN_READER: undefined, FAST_DISABLE_ALTERNATE_SCREEN: undefined}, () => {
			assert.equal(alternateScreenAllowed(), false);
		});
	}
});
