import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {ensurePlanPrefix, stripAutoPlanPrefix} from './planPrefix.js';

describe('planPrefix', () => {
	it('ensure adds /plan without duplicating', () => {
		assert.equal(ensurePlanPrefix(''), '/plan ');
		assert.equal(ensurePlanPrefix('explore'), '/plan explore');
		assert.equal(ensurePlanPrefix('/plan explore'), '/plan explore');
	});

	it('strip removes auto prefix only', () => {
		assert.equal(stripAutoPlanPrefix('/plan '), '');
		assert.equal(stripAutoPlanPrefix('/plan explore'), 'explore');
		assert.equal(stripAutoPlanPrefix('/ask hi'), '/ask hi');
	});
});
