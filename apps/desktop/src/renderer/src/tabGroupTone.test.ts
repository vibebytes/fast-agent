import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tabGroupTone} from './tabGroupTone.js';

test('tabGroupTone is stable for the same groupKey', () => {
	assert.equal(tabGroupTone('proj-a').shell, tabGroupTone('proj-a').shell);
});

test('tabGroupTone differs across several distinct keys', () => {
	const shells = new Set(
		['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(k => tabGroupTone(k).shell)
	);
	assert.ok(shells.size >= 4, `expected several tones, got ${shells.size}`);
});
