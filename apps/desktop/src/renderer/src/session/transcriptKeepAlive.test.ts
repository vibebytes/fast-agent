import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	KEEP_ALIVE_MAX,
	stashOnSwitch,
	type KeepAliveEntry
} from './transcriptKeepAlive.js';

const entry = (taskId: string): KeepAliveEntry<string> => ({taskId, pane: `pane-${taskId}`});

test('leaving pane moves to the front of the stash', () => {
	const next = stashOnSwitch([entry('b')], entry('a'), 'c');
	assert.deepEqual(next.map(e => e.taskId), ['a', 'b']);
});

test('activating a stashed Task removes it (it renders live)', () => {
	const next = stashOnSwitch([entry('a'), entry('b')], entry('c'), 'a');
	assert.deepEqual(next.map(e => e.taskId), ['c', 'b']);
});

test('re-leaving a Task replaces its stale stash copy', () => {
	const stale = entry('a');
	const fresh: KeepAliveEntry<string> = {taskId: 'a', pane: 'pane-a-fresh'};
	const next = stashOnSwitch([stale, entry('b')], fresh, 'c');
	assert.deepEqual(next.map(e => e.pane), ['pane-a-fresh', 'pane-b']);
});

test('stash is MRU-capped at KEEP_ALIVE_MAX', () => {
	const next = stashOnSwitch([entry('b'), entry('c')], entry('a'), 'd');
	assert.equal(next.length, KEEP_ALIVE_MAX);
	assert.deepEqual(next.map(e => e.taskId), ['a', 'b']);
});

test('null leaving pane only evicts the newly active Task', () => {
	const next = stashOnSwitch([entry('a'), entry('b')], null, 'a');
	assert.deepEqual(next.map(e => e.taskId), ['b']);
});

test('leaving equal to active never stashes itself', () => {
	const next = stashOnSwitch([], entry('a'), 'a');
	assert.deepEqual(next, []);
});
