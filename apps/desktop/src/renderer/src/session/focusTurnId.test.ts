import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {turnIdMatches} from './focusTurnId';

describe('turnIdMatches', () => {
	it('exact match', () => {
		assert.equal(turnIdMatches('run-abc', 'run-abc'), true);
	});

	it('suffix after hyphen (timeline compound ids)', () => {
		assert.equal(turnIdMatches('turn-run-abc', 'run-abc'), true);
	});

	it('contains match for nested ids', () => {
		assert.equal(turnIdMatches('prefix-run-abc-suffix', 'run-abc'), true);
	});

	it('rejects empty / mismatch', () => {
		assert.equal(turnIdMatches('run-abc', ''), false);
		assert.equal(turnIdMatches('run-xyz', 'run-abc'), false);
	});
});
