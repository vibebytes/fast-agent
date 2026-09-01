import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	emptyOpenSet,
	ensureOpen,
	parseOpenSetChrome,
	projectIdGrouping,
	serializeOpenSet,
	stripItems,
	toggleGroupExpand
} from './openSet.js';
import {
	closeOpenTab,
	DEFAULT_OPEN_TAB_PROJECT_ID,
	DEFAULT_TAB_GROUP_LABEL,
	dropOpenTabIds,
	dropOpenTabsByGroupKeys,
	ensureOpenTask,
	inventoryTaskIds,
	inventoryTaskRows,
	openTabLiveTaskIds,
	pruneOpenSet,
	resolveTaskOpenRef,
	syncOpenTabTitles,
	tabGroupLabel,
	tabGroupLabels,
	taskOpenInput
} from './openSetFocus.js';

test('taskOpenInput uses Default Project id when projectId omitted', () => {
	const input = taskOpenInput({id: 't1', title: 'New task'});
	assert.equal(input.projectId, DEFAULT_OPEN_TAB_PROJECT_ID);
	assert.equal(input.kind, 'task');
});

test('openTabLiveTaskIds is the Bind working set (not full inventory)', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'open-a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'open-b', title: 'B', projectId: 'p1'});
	assert.deepEqual(openTabLiveTaskIds(set), ['open-a', 'open-b']);
	const closed = closeOpenTab(set, 'open-a');
	assert.deepEqual(openTabLiveTaskIds(closed.set), ['open-b']);
	assert.deepEqual(openTabLiveTaskIds(emptyOpenSet()), []);
});

test('sidebar-style ensureOpenTask then close active focuses neighbor', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	assert.equal(set.activeTabId, 'b');

	const closed = closeOpenTab(set, 'b');
	assert.equal(closed.focusTaskId, 'a');
	assert.deepEqual(
		closed.set.tabs.map(t => t.id),
		['a']
	);
});

test('close last Open Tab yields empty set and null focus (no Archive semantics)', () => {
	let set = ensureOpenTask(emptyOpenSet(), {id: 'only', title: 'Only', projectId: 'p1'});
	const closed = closeOpenTab(set, 'only');
	assert.equal(closed.focusTaskId, null);
	assert.equal(closed.set.tabs.length, 0);
	assert.equal(closed.set.activeTabId, null);
});

test('closing inactive Open Tab does not change focus target', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	assert.equal(set.activeTabId, 'b');
	const closed = closeOpenTab(set, 'a');
	assert.equal(closed.focusTaskId, 'b');
	assert.equal(closed.set.activeTabId, 'b');
});

test('syncOpenTabTitles refreshes title without reordering', () => {
	let set = ensureOpenTask(emptyOpenSet(), {id: 'a', title: 'Old', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	set = syncOpenTabTitles(
		set,
		new Map([['a', {id: 'a', title: 'Renamed', projectId: 'p1'}]])
	);
	assert.equal(set.tabs[0]?.title, 'Renamed');
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['a', 'b']
	);
	assert.equal(set.activeTabId, 'b');
});

test('chat kind is preserved in ensureOpenTask', () => {
	const set = ensureOpenTask(emptyOpenSet(), {
		id: 'c1',
		title: 'Chat',
		kind: 'chat',
		projectId: 'p1'
	});
	assert.equal(set.tabs[0]?.kind, 'chat');
});

test('tabGroupLabel uses Tasks for Default Project and project display name otherwise', () => {
	assert.equal(tabGroupLabel(DEFAULT_OPEN_TAB_PROJECT_ID, []), DEFAULT_TAB_GROUP_LABEL);
	const projects = [
		{id: 'p1', path: '/Users/me/work/fast-ide', status: 'ready' as const, active: false}
	];
	assert.equal(tabGroupLabel('p1', projects), 'fast-ide');
	assert.equal(
		tabGroupLabel('p1', [
			{id: 'p1', path: '/Users/me/work/fast-ide', status: 'ready', active: false, displayName: 'Fast'}
		]),
		'Fast'
	);
	assert.equal(tabGroupLabel('missing', projects), 'missing');
});

test('stripItems + toggleGroupExpand: label toggle does not change active', () => {
	let set = emptyOpenSet();
	set = ensureOpen(set, {id: 'a', kind: 'task', title: 'A', projectId: 'p1'}, projectIdGrouping);
	set = ensureOpen(set, {id: 'b', kind: 'task', title: 'B', projectId: 'p1'}, projectIdGrouping);
	assert.equal(set.activeTabId, 'b');
	assert.equal(stripItems(set)[0]?.type, 'group');
	set = toggleGroupExpand(set, 'p1');
	assert.equal(set.expandedGroupKey, null);
	assert.equal(set.activeTabId, 'b');
	const labels = tabGroupLabels(['p1', DEFAULT_OPEN_TAB_PROJECT_ID], []);
	assert.equal(labels.p1, 'p1');
	assert.equal(labels[DEFAULT_OPEN_TAB_PROJECT_ID], DEFAULT_TAB_GROUP_LABEL);
});

test('dropOpenTabIds removes archived Open Tabs; active neighbor when active dropped', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'c', title: 'C', projectId: 'p2'});
	assert.equal(set.activeTabId, 'c');
	set = dropOpenTabIds(set, new Set(['b']));
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['a', 'c']
	);
	assert.equal(set.activeTabId, 'c', 'inactive drop leaves focus');

	set = dropOpenTabIds(set, new Set(['c']));
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['a']
	);
	assert.equal(set.activeTabId, 'a', 'dropping active activates neighbor');
});

test('dropOpenTabsByGroupKeys clears tabs when Project leaves open set', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'c', title: 'C', projectId: 'p2'});
	set = dropOpenTabsByGroupKeys(set, new Set(['p1']));
	assert.deepEqual(
		set.tabs.map(t => t.id),
		['c']
	);
	assert.equal(set.activeTabId, 'c');
});

test('pruneOpenSet drops vanished ids and preserves surviving order', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {id: 'a', title: 'A', projectId: 'p1'});
	set = ensureOpenTask(set, {id: 'b', title: 'B', projectId: 'p1'});
	assert.equal(set.expandedGroupKey, 'p1');
	set = ensureOpenTask(set, {id: 'gone', title: 'Gone', projectId: 'p2'});
	assert.equal(set.activeTabId, 'gone');
	const pruned = pruneOpenSet(set, new Set(['a', 'b']));
	assert.deepEqual(
		pruned.tabs.map(t => t.id),
		['a', 'b']
	);
	assert.equal(pruned.activeTabId, 'b', 'missing active falls back to last surviving');
	assert.equal(pruned.expandedGroupKey, null);
});

test('pruneOpenSet remaps by sessionId when local ids change', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {
		id: 'old-a',
		title: 'A',
		projectId: 'p1',
		sessionId: 'sess-a'
	});
	set = ensureOpenTask(set, {
		id: 'old-b',
		title: 'B',
		projectId: 'p1',
		sessionId: 'sess-b'
	});
	const pruned = pruneOpenSet(set, [
		{id: 'new-a', sessionId: 'sess-a'},
		{id: 'new-b', sessionId: 'sess-b'}
	]);
	assert.deepEqual(
		pruned.tabs.map(t => t.id),
		['new-a', 'new-b']
	);
	assert.equal(pruned.activeTabId, 'new-b');
});

test('inventoryTaskIds unions project, default, chat, and tasks lists', () => {
	const ids = inventoryTaskIds({
		projectTasks: {p1: [{id: 't1'}]},
		defaultTasks: [{id: 'd1'}],
		chats: [{id: 'c1'}],
		tasks: [{id: 'x1'}]
	});
	assert.deepEqual([...ids].sort(), ['c1', 'd1', 't1', 'x1']);
});

test('inventoryTaskRows carries sessionId for restore', () => {
	const rows = inventoryTaskRows({
		projectTasks: {p1: [{id: 't1', sessionId: 'sess-1'}]},
		defaultTasks: [{id: 'd1'}],
		chats: [{id: 'c1', sessionId: 'sess-c'}],
		tasks: []
	});
	assert.deepEqual(
		rows.sort((a, b) => a.id.localeCompare(b.id)),
		[
			{id: 'c1', sessionId: 'sess-c'},
			{id: 'd1'},
			{id: 't1', sessionId: 'sess-1'}
		]
	);
});

test('ensureOpenTask + serialize round-trip keeps sessionId across remint', () => {
	let set = emptyOpenSet();
	set = ensureOpenTask(set, {
		id: 'local-1',
		title: 'One',
		projectId: 'p1',
		sessionId: 'sess-1'
	});
	set = ensureOpenTask(set, {
		id: 'local-2',
		title: 'Two',
		projectId: 'p1',
		sessionId: 'sess-2'
	});
	const saved = serializeOpenSet(set);
	assert.equal(saved.tabs[0]?.sessionId, 'sess-1');
	const restored = parseOpenSetChrome(saved, [
		{id: 'reminted-1', sessionId: 'sess-1'},
		{id: 'reminted-2', sessionId: 'sess-2'}
	]);
	assert.deepEqual(
		restored.tabs.map(t => ({id: t.id, sessionId: t.sessionId})),
		[
			{id: 'reminted-1', sessionId: 'sess-1'},
			{id: 'reminted-2', sessionId: 'sess-2'}
		]
	);
	assert.equal(restored.activeTabId, 'reminted-2');
});

test('syncOpenTabTitles stamps sessionId when inventory gains it', () => {
	let set = ensureOpenTask(emptyOpenSet(), {id: 't1', title: 'A', projectId: 'p1'});
	assert.equal(set.tabs[0]?.sessionId, undefined);
	const refs = new Map([
		['t1', {id: 't1', title: 'A', projectId: 'p1', sessionId: 'sess-later', kind: 'task'}]
	]);
	set = syncOpenTabTitles(set, refs);
	assert.equal(set.tabs[0]?.sessionId, 'sess-later');
});

test('resolveTaskOpenRef finds project and default tasks', () => {
	const state = {
		projectTasks: {
			p1: [{id: 't1', title: 'In project', kind: 'task' as const}]
		},
		defaultTasks: [{id: 'd1', title: 'Default', kind: 'task' as const}],
		chats: [{id: 'c1', title: 'Chat', kind: 'chat' as const}],
		tasks: [],
		activeProjectId: 'p1'
	};
	assert.deepEqual(resolveTaskOpenRef(state, 't1'), {
		id: 't1',
		title: 'In project',
		kind: 'task',
		projectId: 'p1'
	});
	assert.equal(resolveTaskOpenRef(state, 'd1')?.projectId, DEFAULT_OPEN_TAB_PROJECT_ID);
	assert.equal(resolveTaskOpenRef(state, 'c1')?.kind, 'chat');
	assert.equal(resolveTaskOpenRef(state, 'missing'), null);
});

test('resolveTaskOpenRef accepts Engine sessionId (LivingTask click)', () => {
	const state = {
		projectTasks: {
			p1: [{id: 'local-1', title: 'S', kind: 'task' as const, sessionId: 'sess-abc'}]
		},
		defaultTasks: [],
		chats: [],
		tasks: [],
		activeProjectId: 'p1'
	};
	assert.deepEqual(resolveTaskOpenRef(state, 'sess-abc'), {
		id: 'local-1',
		title: 'S',
		kind: 'task',
		projectId: 'p1',
		sessionId: 'sess-abc'
	});
});
