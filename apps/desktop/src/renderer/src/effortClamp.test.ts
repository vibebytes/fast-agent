import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {clampEffort} from './effortClamp.js';

describe('effortClamp', () => {
	it('keeps current when supported', () => {
		assert.equal(clampEffort('high', ['low', 'medium', 'high']), 'high');
	});

	it('clamps to medium then default then head', () => {
		assert.equal(clampEffort('xhigh', ['low', 'medium', 'high']), 'medium');
		assert.equal(clampEffort('xhigh', ['low', 'high'], 'high'), 'high');
		assert.equal(clampEffort('xhigh', ['low', 'high']), 'low');
		assert.equal(clampEffort('xhigh', []), undefined);
	});
});
