/** workspaceStore.test — reduce projects:changed / projects:pull. Loaded by workspaceStore.test.ts. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	BODY_CACHE_MAX,
	activeTranscript,
	beginOptimisticFocus,
	bodyNeedsPull,
	createWorkspaceStore,
	initialWorkspaceState,
	reduceWorkspace,
	transcriptForTask,
	type WorkspaceEvent,
	type WorkspaceState
} from '../workspaceStore.js';
import {
	entry,
	focus,
	fold,
	idleGate,
	patch,
	runningGate,
	slimFocus,
	tailPatched,
	tasksMeta,
	tasksPull
} from './kit.js';

test('projects:changed writes projectTasks + hydrated; workspace:focus does not touch lists', () => {
	let state = fold([
		{
			type: 'projects:changed',
			payload: {
				projects: [{id: 'p1', path: '/a', status: 'ready', active: true}],
				activeProjectId: 'p1',
				projectTasks: {p1: [{id: 't1', title: 'T'}]},
				projectTasksHydrated: {p1: true}
			}
		}
	]);
	assert.equal(state.projectTasks.p1?.[0]?.id, 't1');
	assert.equal(state.projectTasksHydrated.p1, true);
	state = reduceWorkspace(state, {
		type: 'workspace:focus',
		payload: {
			focusEpoch: 1,
			projects: [{id: 'p1', path: '/a', status: 'ready', active: true}],
			activeProjectId: 'p1',
			project: {id: 'p1', path: '/a', status: 'ready'},
			tasks: [{id: 't1', title: 'T', active: true}],
			chats: [],
			defaultTasks: [],
			activeTaskId: 't1',
			activeKind: 'task',
			gate: idleGate,
			model: 'default',
			modelDisplay: 'Default',
			modelCatalog: [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: [],
			queuePaused: false,
			transcript: [{id: 'e1', role: 'user', text: 'hi', status: 'done'}],
			approvals: [],
			questions: [],
			codeChanges: []
		}
	});
	assert.equal(state.projectTasks.p1?.[0]?.id, 't1', 'focus must keep prior projectTasks');
	assert.equal(state.activeTaskId, 't1');
	assert.equal(activeTranscript(state).entries[0]?.text, 'hi');
	assert.equal(state.focusEpoch, 1);
});

test('late projects:changed does not steal activeProjectId after focus', () => {
	const state = fold([
		{
			type: 'projects:changed',
			payload: {
				projects: [
					{id: 'p1', path: '/a', status: 'ready', active: true},
					{id: 'p2', path: '/b', status: 'ready', active: false}
				],
				activeProjectId: 'p1',
				projectTasks: {}
			}
		},
		focus({focusEpoch: 1, activeTaskId: 't2', activeProjectId: 'p2'}),
		{
			type: 'projects:changed',
			payload: {
				projects: [
					{id: 'p1', path: '/a', status: 'ready', active: true},
					{id: 'p2', path: '/b', status: 'ready', active: false}
				],
				activeProjectId: 'p1',
				projectTasks: {}
			}
		}
	]);
	assert.equal(state.activeProjectId, 'p2');
	assert.equal(state.projects.find(p => p.id === 'p2')?.active, true);
	assert.equal(state.projects.find(p => p.id === 'p1')?.active, false);
});

test('late projects:pull does not overwrite after projects:changed', () => {
	const state = fold([
		{
			type: 'projects:changed',
			payload: {
				projects: [{id: 'p-new', path: '/new', status: 'ready', active: true}],
				activeProjectId: 'p-new',
				projectTasks: {}
			}
		},
		focus({focusEpoch: 1, activeTaskId: null, activeProjectId: 'p-new'}),
		{
			type: 'projects:pull',
			payload: {
				path: '/old',
				projects: [{id: 'p-old', path: '/old', status: 'ready', active: true}],
				activeProjectId: 'p-old'
			}
		}
	]);
	assert.equal(state.activeProjectId, 'p-new');
});

test('projects:changed alone never sets activeProjectId', () => {
	const state = fold([
		{
			type: 'projects:changed',
			payload: {
				projects: [{id: 'p1', path: '/a', status: 'ready', active: true}],
				activeProjectId: 'p1',
				projectTasks: {}
			}
		}
	]);
	assert.equal(state.activeProjectId, null);
	assert.equal(state.projects[0]?.active, false);
});

test('projects:changed preserves project and task-list identities when content unchanged', () => {
	const proj = {id: 'p1', path: '/x', status: 'ready' as const, active: false};
	const list = [{id: 'k1', title: 'One', active: false}];
	const base = fold([
		{
			type: 'projects:changed',
			payload: {projects: [proj], activeProjectId: null, projectTasks: {p1: list}}
		} as WorkspaceEvent
	]);
	const next = fold(
		[
			{
				type: 'projects:changed',
				payload: {
					projects: [{id: 'p1', path: '/x', status: 'ready', active: false}],
					activeProjectId: null,
					projectTasks: {p1: [{id: 'k1', title: 'One', active: false}]}
				}
			} as WorkspaceEvent
		],
		base
	);
	assert.equal(next.projects[0], base.projects[0], 'same-content project keeps identity');
	assert.equal(next.projectTasks['p1'], base.projectTasks['p1'], 'same-content list keeps identity');
	assert.equal(next.projectTasks['p1']![0], base.projectTasks['p1']![0]);
});
