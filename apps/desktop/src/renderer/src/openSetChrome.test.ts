import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyOpenSet, ensureOpen, projectIdGrouping, serializeOpenSet} from './openSet.js';
import {loadOpenSetChrome, saveOpenSetChrome} from './openSetChrome.js';

const mem = new Map<string, string>();

test('loadOpenSetChrome round-trips via localStorage prefs key', () => {
	const original = globalThis.localStorage;
	const stub = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => {
			mem.set(k, v);
		},
		removeItem: (k: string) => {
			mem.delete(k);
		},
		clear: () => mem.clear(),
		key: () => null,
		length: 0
	};
	Object.defineProperty(globalThis, 'localStorage', {value: stub, configurable: true});
	mem.clear();

	let set = emptyOpenSet();
	set = ensureOpen(
		set,
		{id: 'a', kind: 'task', title: 'A', projectId: 'p1', sessionId: 'sess-a'},
		projectIdGrouping
	);
	set = ensureOpen(
		set,
		{id: 'b', kind: 'task', title: 'B', projectId: 'p1', sessionId: 'sess-b'},
		projectIdGrouping
	);
	saveOpenSetChrome(set);
	assert.ok(mem.has('fast-ide.open-tab-set'));
	assert.notEqual(mem.get('fast-ide.open-tab-set'), undefined);
	assert.ok(mem.get('fast-ide.open-tab-set')!.includes('sess-a'));

	const restored = loadOpenSetChrome(new Set(['a', 'b']));
	assert.deepEqual(serializeOpenSet(restored), serializeOpenSet(set));
	assert.equal(restored.expandedGroupKey, 'p1');
	assert.equal(restored.activeTabId, 'b');

	const reminted = loadOpenSetChrome([
		{id: 'na', sessionId: 'sess-a'},
		{id: 'nb', sessionId: 'sess-b'}
	]);
	assert.deepEqual(
		reminted.tabs.map(t => t.id),
		['na', 'nb']
	);
	assert.equal(reminted.activeTabId, 'nb');

	const pruned = loadOpenSetChrome(new Set(['a']));
	assert.deepEqual(
		pruned.tabs.map(t => t.id),
		['a']
	);
	assert.equal(pruned.expandedGroupKey, null);

	Object.defineProperty(globalThis, 'localStorage', {value: original, configurable: true});
});
