import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {formatCountdown} from './scheduleCountdown';

describe('formatCountdown', () => {
	const now = Date.parse('2026-07-27T00:00:00Z');

	it('empty / invalid → empty string', () => {
		assert.equal(formatCountdown(undefined, now), '');
		assert.equal(formatCountdown(null, now), '');
		assert.equal(formatCountdown('not-a-date', now), '');
	});

	it('past or now → due', () => {
		assert.equal(formatCountdown('2026-07-27T00:00:00Z', now), 'due');
		assert.equal(formatCountdown('2026-07-26T23:59:00Z', now), 'due');
	});

	it('seconds / minutes / hours branches', () => {
		assert.equal(formatCountdown('2026-07-27T00:00:45Z', now), 'in 45s');
		assert.equal(formatCountdown('2026-07-27T00:10:00Z', now), 'in 10m');
		assert.equal(formatCountdown('2026-07-27T02:15:00Z', now), 'in 2h 15m');
	});
});
