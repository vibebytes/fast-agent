import test from 'node:test';
import assert from 'node:assert/strict';
import {interpolateColor} from './useAnimatedScrollbar.js';

test('interpolateColor blends hex endpoints', () => {
	assert.equal(interpolateColor('#000000', '#ffffff', 0), '#000000');
	assert.equal(interpolateColor('#000000', '#ffffff', 1), '#ffffff');
	assert.equal(interpolateColor('#000000', '#ffffff', 0.5), '#808080');
});

test('interpolateColor falls back when either side is not hex', () => {
	assert.equal(interpolateColor('gray', '#ffffff', 0.3), 'gray');
	assert.equal(interpolateColor('#000000', 'gray', 1), 'gray');
});
