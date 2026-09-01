import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	archiveTask,
	forgetSessionChrome,
	expandActiveIfEmpty,
	toggleExpand,
	togglePinProject,
	togglePinTask
} from './sidebarChrome.js';
import {buildSidebarModel, projectDisplayName} from './sidebarModel.js';
import type {SidebarUiState} from './sidebarUiState.js';

const emptyUi = (): SidebarUiState => ({
	expandedProjectPaths: [],
	pinnedProjectPaths: [],
	pinnedTasks: [],
	archivedTasks: [],
	projectsSectionOpen: true,
	projectGroupMode: 'byProject',
	projectSortMode: 'priority'
});

test('projectDisplayName uses Engine name then basename fallback', () => {
	assert.equal(projectDisplayName({path: '/Users/me/work/fast-ide'}), 'fast-ide');
	assert.equal(
		projectDisplayName({path: '/Users/me/work/fast-ide', displayName: 'Fast'}),
		'Fast'
	);
	assert.equal(
		projectDisplayName({path: '/Users/me/work/fast-ide', displayName: '  '}),
		'fast-ide'
	);
});

test('togglePinTask adds then removes', () => {
	let ui = emptyUi();
	ui = togglePinTask(ui, '/p', 's1', 'T');
	assert.equal(ui.pinnedTasks.length, 1);
	assert.equal(ui.pinnedTasks[0]?.title, 'T');
	ui = togglePinTask(ui, '/p', 's1', 'T');
	assert.equal(ui.pinnedTasks.length, 0);
});

test('archiveTask removes pin and marks archived', () => {
	let ui = togglePinTask(emptyUi(), '/p', 's1', 'T');
	ui = archiveTask(ui, '/p', 's1');
	assert.equal(ui.pinnedTasks.length, 0);
	assert.equal(ui.archivedTasks[0]?.sessionId, 's1');
});

test('forgetSessionChrome clears pin and archive for session', () => {
	let ui = togglePinTask(emptyUi(), '/p', 's1', 'T');
	ui = archiveTask(ui, '/p', 's2');
	ui = forgetSessionChrome(ui, '/p', 's1');
	ui = forgetSessionChrome(ui, '/p', 's2');
	assert.equal(ui.pinnedTasks.length, 0);
	assert.equal(ui.archivedTasks.length, 0);
});

test('toggleExpand and expandActiveIfEmpty', () => {
	let ui = toggleExpand(emptyUi(), '/a');
	assert.deepEqual(ui.expandedProjectPaths, ['/a']);
	ui = expandActiveIfEmpty(ui, '/b');
	assert.deepEqual(ui.expandedProjectPaths, ['/a'], 'non-empty expand list is left alone');
	ui = expandActiveIfEmpty(emptyUi(), '/b');
	assert.deepEqual(ui.expandedProjectPaths, ['/b']);
});

test('togglePinProject', () => {
	let ui = togglePinProject(emptyUi(), '/a');
	assert.deepEqual(ui.pinnedProjectPaths, ['/a']);
	ui = togglePinProject(ui, '/a');
	assert.deepEqual(ui.pinnedProjectPaths, []);
});

test('buildSidebarModel filters archived and marks active/pinned', () => {
	const ui: SidebarUiState = {
		...emptyUi(),
		archivedTasks: [{projectPath: '/proj', sessionId: 'gone'}],
		pinnedTasks: [{projectPath: '/proj', sessionId: 'keep', title: 'Keep'}],
		expandedProjectPaths: ['/proj'],
		pinnedProjectPaths: ['/proj']
	};
	const model = buildSidebarModel({
		projects: [{id: 'p1', path: '/proj', status: 'ready', active: true}],
		projectTasks: {
			p1: [
				{id: 't1', title: 'Keep', sessionId: 'keep'},
				{id: 't2', title: 'Gone', sessionId: 'gone'}
			]
		},
		defaultTasks: [{id: 'd1', title: 'Default', sessionId: 'def'}],
		defaultProjectPath: '__default__',
		ui,
		activeTaskId: 't1'
	});
	assert.equal(model.projects.length, 1);
	assert.equal(model.projects[0]?.tasks.length, 1);
	assert.equal(model.projects[0]?.tasks[0]?.task.title, 'Keep');
	assert.equal(model.projects[0]?.tasks[0]?.isActive, true);
	assert.equal(model.projects[0]?.tasks[0]?.pinned, true);
	assert.equal(model.projects[0]?.expanded, true);
	assert.equal(model.projects[0]?.pinned, true);
	assert.equal(model.defaultTasks.length, 1);
	assert.equal(model.defaultTasks[0]?.task.title, 'Default');
	assert.equal(model.pinned.length, 1);
	assert.equal(model.pinned[0]?.taskId, 't1');
});

test('buildSidebarModel defaultTasks archive uses defaultProjectPath', () => {
	const ui: SidebarUiState = {
		...emptyUi(),
		archivedTasks: [{projectPath: '__default__', sessionId: 'x'}]
	};
	const model = buildSidebarModel({
		projects: [],
		projectTasks: {},
		defaultTasks: [
			{id: 'd1', title: 'A', sessionId: 'x'},
			{id: 'd2', title: 'B', sessionId: 'y'}
		],
		defaultProjectPath: '__default__',
		ui,
		activeTaskId: null
	});
	assert.equal(model.defaultTasks.length, 1);
	assert.equal(model.defaultTasks[0]?.task.title, 'B');
});

test('buildSidebarModel defaultTasks isActive follows activeTaskId only', () => {
	const model = buildSidebarModel({
		projects: [],
		projectTasks: {},
		defaultTasks: [
			{id: 'd1', title: 'First', sessionId: 's1', active: true},
			{id: 'd2', title: 'Second', sessionId: 's2', active: true},
			{id: 'd3', title: 'Third', sessionId: 's3', active: false}
		],
		defaultProjectPath: '__default__',
		ui: emptyUi(),
		activeTaskId: 'd3'
	});
	assert.equal(model.defaultTasks.length, 3);
	assert.equal(model.defaultTasks.filter(r => r.isActive).length, 1);
	assert.equal(model.defaultTasks.find(r => r.isActive)?.task.id, 'd3');
});

test('buildSidebarModel priority flatTasks sorts pinned first', () => {
	const ui: SidebarUiState = {
		...emptyUi(),
		projectGroupMode: 'flat',
		projectSortMode: 'priority',
		pinnedTasks: [{projectPath: '/a', sessionId: 's2', title: 'Pinned'}]
	};
	const model = buildSidebarModel({
		projects: [
			{id: 'p1', path: '/a', status: 'ready', active: false},
			{id: 'p2', path: '/b', status: 'ready', active: false}
		],
		projectTasks: {
			p1: [{id: 't1', title: 'Zebra', sessionId: 's1'}],
			p2: [{id: 't2', title: 'Pinned', sessionId: 's2'}]
		},
		defaultTasks: [],
		defaultProjectPath: '__default__',
		ui,
		activeTaskId: null
	});
	assert.equal(model.flatTasks[0]?.task.sessionId, 's2');
});

test('projects stay name-sorted when a later-named project is active or has newer tasks', () => {
	for (const projectSortMode of ['priority', 'recent', 'manual'] as const) {
		const model = buildSidebarModel({
			projects: [
				{id: 'z', path: '/z', status: 'ready', active: true, displayName: 'Zebra'},
				{id: 'a', path: '/a', status: 'ready', active: false, displayName: 'Apple'}
			],
			projectTasks: {
				z: [
					{
						id: 'tz',
						title: 'Fresh',
						sessionId: 'sz',
						lastModified: '2026-08-17T12:00:00.000Z'
					}
				],
				a: [
					{
						id: 'ta',
						title: 'Stale',
						sessionId: 'sa',
						lastModified: '2026-01-01T00:00:00.000Z'
					}
				]
			},
			defaultTasks: [],
			defaultProjectPath: '__default__',
			ui: {...emptyUi(), projectSortMode},
			activeTaskId: 'tz'
		});
		assert.deepEqual(
			model.projects.map(p => p.displayName),
			['Apple', 'Zebra'],
			`projects must stay name-sorted in ${projectSortMode} mode`
		);
	}
});

test('conversations within a project sort by lastModified desc', () => {
	const model = buildSidebarModel({
		projects: [{id: 'p', path: '/p', status: 'ready', active: false, displayName: 'P'}],
		projectTasks: {
			p: [
				{
					id: 'old',
					title: 'Old',
					sessionId: 's1',
					lastModified: '2026-01-01T00:00:00.000Z'
				},
				{
					id: 'fresh',
					title: 'Fresh',
					sessionId: 's2',
					lastModified: '2026-08-17T12:00:00.000Z'
				},
				{
					id: 'mid',
					title: 'Mid',
					sessionId: 's3',
					lastModified: '2026-06-01T00:00:00.000Z'
				}
			]
		},
		defaultTasks: [
			{
				id: 'd-old',
				title: 'Default old',
				sessionId: 'd1',
				lastModified: '2026-02-01T00:00:00.000Z'
			},
			{
				id: 'd-new',
				title: 'Default new',
				sessionId: 'd2',
				lastModified: '2026-08-01T00:00:00.000Z'
			}
		],
		defaultProjectPath: '__default__',
		ui: emptyUi(),
		activeTaskId: null
	});
	assert.deepEqual(
		model.projects[0]?.tasks.map(t => t.task.title),
		['Fresh', 'Mid', 'Old']
	);
	assert.deepEqual(
		model.defaultTasks.map(t => t.task.title),
		['Default new', 'Default old']
	);
});

test('updating a conversation does not reorder sibling projects', () => {
	const projects = [
		{id: 'b', path: '/b', status: 'ready' as const, active: false, displayName: 'Beta'},
		{id: 'a', path: '/a', status: 'ready' as const, active: false, displayName: 'Alpha'}
	];
	const before = buildSidebarModel({
		projects,
		projectTasks: {
			a: [
				{
					id: 'ta',
					title: 'A1',
					sessionId: 'sa',
					lastModified: '2026-01-01T00:00:00.000Z'
				}
			],
			b: [
				{
					id: 'tb-old',
					title: 'B-old',
					sessionId: 'sb1',
					lastModified: '2026-02-01T00:00:00.000Z'
				},
				{
					id: 'tb-mid',
					title: 'B-mid',
					sessionId: 'sb2',
					lastModified: '2026-03-01T00:00:00.000Z'
				}
			]
		},
		defaultTasks: [],
		defaultProjectPath: '__default__',
		ui: {...emptyUi(), projectSortMode: 'recent'},
		activeTaskId: null
	});
	const after = buildSidebarModel({
		projects: projects.map(p => (p.id === 'b' ? {...p, active: true} : p)),
		projectTasks: {
			a: [
				{
					id: 'ta',
					title: 'A1',
					sessionId: 'sa',
					lastModified: '2026-01-01T00:00:00.000Z'
				}
			],
			b: [
				{
					id: 'tb-old',
					title: 'B-old',
					sessionId: 'sb1',
					lastModified: '2026-02-01T00:00:00.000Z'
				},
				{
					id: 'tb-mid',
					title: 'B-mid',
					sessionId: 'sb2',
					lastModified: '2026-08-17T12:00:00.000Z'
				}
			]
		},
		defaultTasks: [],
		defaultProjectPath: '__default__',
		ui: {...emptyUi(), projectSortMode: 'recent'},
		activeTaskId: 'tb-mid'
	});
	assert.deepEqual(
		before.projects.map(p => p.displayName),
		['Alpha', 'Beta']
	);
	assert.deepEqual(
		after.projects.map(p => p.displayName),
		['Alpha', 'Beta'],
		'project order must not follow conversation recency'
	);
	assert.deepEqual(
		after.projects[1]?.tasks.map(t => t.task.title),
		['B-mid', 'B-old']
	);
});
