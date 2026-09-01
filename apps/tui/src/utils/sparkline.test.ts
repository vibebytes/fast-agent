import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSparkline, computeTokenRate} from './sparkline.js';

test('buildSparkline renders scaled glyphs', () => {
	assert.equal(buildSparkline([]), '');
	assert.match(buildSparkline([0, 1, 2, 4, 8, 16]), /[▁-█]/);
});

test('computeTokenRate uses recent samples', () => {
	const now = Date.now();
	const rate = computeTokenRate([
		{timestamp: now - 2000, tokens: 0},
		{timestamp: now, tokens: 20}
	]);
	assert.equal(rate, 10);
});
