import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	OVERFLOW_BTN_PX,
	partitionStripOverflow,
	stripItemContainsTab,
	stripItemKey
} from './openTabStripOverflow.js';
import type {StripItem} from './openSet.js';

test('partitionStripOverflow keeps all items when they fit', () => {
	const result = partitionStripOverflow({
		widths: [80, 80, 80],
		containerWidth: 300,
		activeIndex: 1
	});
	assert.deepEqual(result.visibleIndexes, [0, 1, 2]);
	assert.deepEqual(result.overflowIndexes, []);
});

test('partitionStripOverflow hides trailing items and reserves overflow button', () => {
	const result = partitionStripOverflow({
		widths: [100, 100, 100, 100],
		containerWidth: 250,
		activeIndex: 0,
		gapPx: 0,
		overflowBtnPx: OVERFLOW_BTN_PX
	});
	// avail = 250 - 32 = 218 → two 100px items from left
	assert.deepEqual(result.visibleIndexes, [0, 1]);
	assert.deepEqual(result.overflowIndexes, [2, 3]);
});

test('partitionStripOverflow keeps active item visible when left pack would drop it', () => {
	const result = partitionStripOverflow({
		widths: [100, 100, 100, 100],
		containerWidth: 250,
		activeIndex: 3,
		gapPx: 0,
		overflowBtnPx: OVERFLOW_BTN_PX
	});
	assert.ok(result.visibleIndexes.includes(3));
	assert.ok(result.overflowIndexes.length > 0);
	assert.ok(!result.overflowIndexes.includes(3));
});

test('stripItemKey / contains helpers', () => {
	const tab: StripItem = {
		type: 'tab',
		tab: {id: 't1', kind: 'task', groupKey: 'p1', title: 'One'}
	};
	const group: StripItem = {
		type: 'group',
		groupKey: 'p1',
		members: [
			{id: 't1', kind: 'task', groupKey: 'p1', title: 'One'},
			{id: 't2', kind: 'task', groupKey: 'p1', title: 'Two'}
		],
		expanded: true
	};
	assert.equal(stripItemKey(tab), 'tab:t1');
	assert.equal(stripItemKey(group), 'group:p1');
	assert.equal(stripItemContainsTab(tab, 't1'), true);
	assert.equal(stripItemContainsTab(group, 't2'), true);
	assert.equal(stripItemContainsTab(group, 'x'), false);
});
