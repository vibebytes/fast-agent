import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {hasConflictMarkers, merge3} from './documentMerge.js';

describe('hasConflictMarkers', () => {
	it('detects unresolved markers', () => {
		assert.equal(
			hasConflictMarkers('<<<<<<< Ours\na\n=======\nb\n>>>>>>> Disk'),
			true
		);
	});

	it('is false for ordinary text', () => {
		assert.equal(hasConflictMarkers('hello\nworld'), false);
		assert.equal(hasConflictMarkers('======= alone'), false);
	});
});

describe('merge3', () => {
	it('marks unclean when both sides diverge', () => {
		const r = merge3('base', 'ours', 'theirs');
		assert.equal(r.clean, false);
		assert.equal(hasConflictMarkers(r.text), true);
	});

	it('is clean when ours equals theirs', () => {
		const r = merge3('base', 'same', 'same');
		assert.equal(r.clean, true);
		assert.equal(hasConflictMarkers(r.text), false);
	});
});
