import test from 'node:test';
import assert from 'node:assert/strict';
import {TEAMS_LIST_PAGE_SIZE, clampPage, pageIndexForId} from './teamsListPaging.js';

test('TEAMS_LIST_PAGE_SIZE is 20', () => {
	assert.equal(TEAMS_LIST_PAGE_SIZE, 20);
});

test('pageIndexForId maps ids across pages', () => {
	const list = Array.from({length: 45}, (_, i) => ({id: `id-${i}`}));
	assert.equal(pageIndexForId(list, 'id-0'), 0);
	assert.equal(pageIndexForId(list, 'id-19'), 0);
	assert.equal(pageIndexForId(list, 'id-20'), 1);
	assert.equal(pageIndexForId(list, 'id-44'), 2);
	assert.equal(pageIndexForId(list, 'missing'), 0);
	assert.equal(pageIndexForId(list, null), 0);
});

test('clampPage bounds', () => {
	assert.equal(clampPage(-1, 45), 0);
	assert.equal(clampPage(0, 45), 0);
	assert.equal(clampPage(1, 45), 1);
	assert.equal(clampPage(9, 45), 2);
	assert.equal(clampPage(0, 0), 0);
});
