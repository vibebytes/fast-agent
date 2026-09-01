import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	activate,
	close,
	emptyOpenSet,
	ensureOpen,
	parseOpenSetChrome,
	projectIdGrouping,
	serializeOpenSet,
	stripItems,
	toggleGroupExpand,
	type EnsureOpenInput
} from './openSet.js';

const task = (id: string, projectId: string, title = id): EnsureOpenInput => ({
	id,
	kind: 'task',
	title,
	projectId
});

test('ensureOpen appends then activate sets active; duplicate ensure keeps order', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('t1', 'p1', 'One'), projectIdGrouping);
	assert.equal(set.tabs.length, 1);
	assert.equal(set.activeTabId, 't1');
	assert.equal(set.tabs[0]?.groupKey, 'p1');

	set = ensureOpen(set, task('t2', 'p1', 'Two'), projectIdGrouping);
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['t1', 't2']
	);
	assert.equal(set.activeTabId, 't2');

	set = ensureOpen(set, task('t1', 'p1', 'One renamed'), projectIdGrouping);
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['t1', 't2'],
		'existing tab stays in place'
	);
	assert.equal(set.activeTabId, 't1');
	assert.equal(set.tabs[0]?.title, 'One renamed');
});

test('close active prefers same-group neighbor; last close empties', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('a', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('b', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('c', 'p2'), projectIdGrouping);
	set = activate(set, 'b');
	set = close(set, 'b');
	assert.equal(set.activeTabId, 'a', 'prefer same-group neighbor over p2');
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['a', 'c']
	);

	set = close(set, 'a');
	assert.equal(set.activeTabId, 'c');
	set = close(set, 'c');
	assert.deepEqual(set.tabs, []);
	assert.equal(set.activeTabId, null);
	assert.equal(set.expandedGroupKey, null);
});

test('stripItems: bare when one per groupKey; Tab Group when two+', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('a', 'p1'), projectIdGrouping);
	assert.deepEqual(
		stripItems(set).map(i => i.type),
		['tab']
	);

	set = ensureOpen(set, task('b', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('c', 'p2'), projectIdGrouping);
	const items = stripItems(set);
	assert.equal(items[0]?.type, 'group');
	if (items[0]?.type === 'group') {
		assert.equal(items[0].groupKey, 'p1');
		assert.deepEqual(
			items[0].members.map(m => m.id),
			['a', 'b']
		);
	}
	assert.equal(items[1]?.type, 'tab');
	if (items[1]?.type === 'tab') assert.equal(items[1].tab.id, 'c');
});

test('activate expands grouped key; toggleGroupExpand does not change active', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('a', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('b', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('c', 'p2'), projectIdGrouping);
	set = ensureOpen(set, task('d', 'p2'), projectIdGrouping);
	assert.equal(set.expandedGroupKey, 'p2', 'ensureOpen activates and expands when grouped');

	set = activate(set, 'a');
	assert.equal(set.activeTabId, 'a');
	assert.equal(set.expandedGroupKey, 'p1');

	set = toggleGroupExpand(set, 'p1');
	assert.equal(set.expandedGroupKey, null);
	assert.equal(set.activeTabId, 'a', 'label toggle is expand-only');

	set = toggleGroupExpand(set, 'p2');
	assert.equal(set.expandedGroupKey, 'p2');
	assert.equal(set.activeTabId, 'a');
});

test('serialize / restore round-trip; drop vanished ids', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('a', 'p1', 'A'), projectIdGrouping);
	set = ensureOpen(set, task('b', 'p1', 'B'), projectIdGrouping);
	assert.equal(set.expandedGroupKey, 'p1');
	const roundTrip = parseOpenSetChrome(serializeOpenSet(set), new Set(['a', 'b']));
	assert.deepEqual(
		roundTrip.tabs.map(t => t.id),
		['a', 'b']
	);
	assert.equal(roundTrip.activeTabId, 'b');
	assert.equal(roundTrip.expandedGroupKey, 'p1');

	set = ensureOpen(set, task('gone', 'p2', 'Gone'), projectIdGrouping);
	assert.equal(set.activeTabId, 'gone');
	const pruned = parseOpenSetChrome(serializeOpenSet(set), new Set(['a', 'b']));
	assert.deepEqual(
		pruned.tabs.map(t => t.id),
		['a', 'b']
	);
	assert.equal(pruned.activeTabId, 'b', 'missing active falls back to last surviving tab');
	assert.equal(pruned.expandedGroupKey, null, 'expanded key for vanished group is dropped');
});

test('ensureOpen stores sessionId and remaps local id when session matches', () => {
	let set = emptyOpenSet();
	set = ensureOpen(
		set,
		{id: 'local-old', kind: 'task', title: 'A', projectId: 'p1', sessionId: 'sess-a'},
		projectIdGrouping
	);
	assert.equal(set.tabs[0]?.sessionId, 'sess-a');
	set = ensureOpen(
		set,
		{id: 'local-new', kind: 'task', title: 'A2', projectId: 'p1', sessionId: 'sess-a'},
		projectIdGrouping
	);
	assert.equal(set.tabs.length, 1, 'same sessionId must not duplicate tab');
	assert.equal(set.tabs[0]?.id, 'local-new');
	assert.equal(set.tabs[0]?.sessionId, 'sess-a');
	assert.equal(set.tabs[0]?.title, 'A2');
	assert.equal(set.activeTabId, 'local-new');
});

test('parseOpenSetChrome remaps by sessionId after hydrate remints local ids', () => {
	const chrome = {
		tabs: [
			{
				id: 'old-local-a',
				kind: 'task' as const,
				groupKey: 'p1',
				title: 'A',
				sessionId: 'sess-a'
			},
			{
				id: 'old-local-b',
				kind: 'task' as const,
				groupKey: 'p1',
				title: 'B',
				sessionId: 'sess-b'
			}
		],
		activeTabId: 'old-local-b',
		expandedGroupKey: 'p1'
	};
	const restored = parseOpenSetChrome(chrome, [
		{id: 'new-local-a', sessionId: 'sess-a'},
		{id: 'new-local-b', sessionId: 'sess-b'},
		{id: 'new-local-c', sessionId: 'sess-c'}
	]);
	assert.deepEqual(
		restored.tabs.map(t => t.id),
		['new-local-a', 'new-local-b']
	);
	assert.deepEqual(
		restored.tabs.map(t => t.sessionId),
		['sess-a', 'sess-b']
	);
	assert.equal(restored.activeTabId, 'new-local-b', 'active remapped by sessionId');
	assert.equal(restored.expandedGroupKey, 'p1');
});

test('parseOpenSetChrome drops tabs with no sessionId when local id vanished', () => {
	const chrome = {
		tabs: [
			{id: 'optimistic-only', kind: 'task' as const, groupKey: 'p1', title: 'Pending'},
			{
				id: 'old-a',
				kind: 'task' as const,
				groupKey: 'p1',
				title: 'A',
				sessionId: 'sess-a'
			}
		],
		activeTabId: 'optimistic-only',
		expandedGroupKey: 'p1'
	};
	const restored = parseOpenSetChrome(chrome, [{id: 'new-a', sessionId: 'sess-a'}]);
	assert.deepEqual(
		restored.tabs.map(t => t.id),
		['new-a']
	);
	assert.equal(restored.activeTabId, 'new-a');
});

test('parseOpenSetChrome drops tab when Engine session is gone', () => {
	const chrome = {
		tabs: [
			{
				id: 'old-a',
				kind: 'task' as const,
				groupKey: 'p1',
				title: 'A',
				sessionId: 'sess-deleted'
			}
		],
		activeTabId: 'old-a',
		expandedGroupKey: null
	};
	const restored = parseOpenSetChrome(chrome, [{id: 'other', sessionId: 'sess-other'}]);
	assert.equal(restored.tabs.length, 0);
	assert.equal(restored.activeTabId, null);
});

test('legacy prefs without sessionId still match by local id', () => {
	const chrome = {
		tabs: [{id: 'same-id', kind: 'task' as const, groupKey: 'p1', title: 'A'}],
		activeTabId: 'same-id',
		expandedGroupKey: null
	};
	const restored = parseOpenSetChrome(chrome, [{id: 'same-id', sessionId: 'sess-a'}]);
	assert.equal(restored.tabs[0]?.id, 'same-id');
	assert.equal(restored.tabs[0]?.sessionId, 'sess-a', 'inventory sessionId stamped on restore');
});

test('chat kind is a valid Open Tab kind', () => {
	let set = emptyOpenSet();
	set = ensureOpen(
		set,
		{id: 'chat1', kind: 'chat', title: 'Chat', projectId: 'p1'},
		projectIdGrouping
	);
	assert.equal(set.tabs[0]?.kind, 'chat');
});

test('Default Project id groups like any projectId', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('d1', '__default__', 'A'), projectIdGrouping);
	set = ensureOpen(set, task('d2', '__default__', 'B'), projectIdGrouping);
	assert.equal(set.tabs[0]?.groupKey, '__default__');
	assert.equal(stripItems(set)[0]?.type, 'group');
});

test('two Projects each with two tabs yield two Tab Groups', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, task('a1', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('a2', 'p1'), projectIdGrouping);
	set = ensureOpen(set, task('b1', 'p2'), projectIdGrouping);
	set = ensureOpen(set, task('b2', 'p2'), projectIdGrouping);
	const items = stripItems(set);
	assert.equal(items.length, 2);
	assert.equal(items[0]?.type, 'group');
	assert.equal(items[1]?.type, 'group');
	if (items[0]?.type === 'group' && items[1]?.type === 'group') {
		assert.equal(items[0].groupKey, 'p1');
		assert.equal(items[1].groupKey, 'p2');
		assert.equal(items[1].expanded, true);
		assert.equal(items[0].expanded, false);
	}
});

test('grouping policy is injectable', () => {
	const byTitlePrefix = {
		groupKey: (input: EnsureOpenInput) => input.title.slice(0, 1)
	};
	let set = emptyOpenSet();
	set = ensureOpen(set, task('1', 'ignored', 'Alpha'), byTitlePrefix);
	set = ensureOpen(set, task('2', 'ignored', 'Apple'), byTitlePrefix);
	assert.equal(set.tabs[0]?.groupKey, 'A');
	assert.equal(set.tabs[1]?.groupKey, 'A');
	const items = stripItems(set);
	assert.equal(items[0]?.type, 'group');
});
