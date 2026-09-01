import assert from 'node:assert/strict';
import test from 'node:test';
import {bridgeErrorText} from './bridgeErrorText.js';

const t = ((key: string, params?: Record<string, unknown>) => {
	if (key === 'errors.session.create_failed') return 'Failed to create session';
	if (key === 'errors.session.create_failed_detail') {
		return `Failed to create session: ${params?.detail ?? ''}`;
	}
	return key;
}) as typeof import('i18next').t;

test('bridgeErrorText prefers code over message', () => {
	assert.equal(
		bridgeErrorText({message: 'legacy', code: 'session.create_failed'}, t),
		'Failed to create session'
	);
});

test('bridgeErrorText interpolates params', () => {
	assert.equal(
		bridgeErrorText(
			{message: '', code: 'session.create_failed_detail', params: {detail: 'timeout'}},
			t
		),
		'Failed to create session: timeout'
	);
});

test('bridgeErrorText falls back to bare message', () => {
	assert.equal(bridgeErrorText({message: 'boom'}, t), 'boom');
});

test('bridgeErrorText empty clears', () => {
	assert.equal(bridgeErrorText({message: ''}, t), '');
	assert.equal(bridgeErrorText(null, t), '');
});
