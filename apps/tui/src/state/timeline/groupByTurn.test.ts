import test from 'node:test';
import assert from 'node:assert/strict';
import {groupTimelineByTurn, splitTurnItems} from './groupByTurn.js';
import type {TimelineItem} from './model.js';

test('groupTimelineByTurn groups consecutive turn items', () => {
	const items: TimelineItem[] = [
		{kind: 'user_message', id: 'u1', turnId: 't1', text: 'hi'},
		{kind: 'assistant_message', id: 'a1', turnId: 't1', text: 'hello'},
		{kind: 'user_message', id: 'u2', turnId: 't2', text: 'next'}
	];
	const groups = groupTimelineByTurn(items);
	assert.equal(groups.length, 2);
	assert.equal(groups[0]?.items.length, 2);
	assert.equal(groups[1]?.items.length, 1);
});

test('splitTurnItems separates assistant from tools and thinking', () => {
	const items: TimelineItem[] = [
		{kind: 'thinking_message', id: 'th1', turnId: 't1', text: 'hmm'},
		{kind: 'tool_group', id: 'tg1', turnId: 't1', tools: []},
		{kind: 'assistant_message', id: 'a1', turnId: 't1', text: 'done'}
	];
	const split = splitTurnItems(items);
	assert.equal(split.left.length, 2);
	assert.equal(split.right.length, 1);
});
