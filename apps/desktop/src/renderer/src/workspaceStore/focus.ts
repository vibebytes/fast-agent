/** workspaceStore.test — reduce workspace:focus / focus:*. Loaded by workspaceStore.test.ts. */
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

test('workspace:focus applies availableEngineIds', () => {
	const state = fold([
		{
			type: 'workspace:focus',
			payload: {
				focusEpoch: 1,
				projects: [],
				activeProjectId: null,
				project: null,
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
				availableEngineIds: ['fast', 'dsh']
			}
		}
	]);
	assert.deepEqual(state.availableEngineIds, ['fast', 'dsh']);
});

test('workspace:focus goalCard is host truth — stale renderer cache never survives a switch', () => {
	// Review fix: background goal_updated never patches the renderer cache; the
	// focus payload must carry (and override with) the main-process goalCard.
	const confirmCard = {
		goalId: 'g1',
		phase: 'awaiting_confirm' as const,
		status: 'awaiting_confirm',
		statement: 'ship widget'
	};
	let state = fold([
		focus({focusEpoch: 1, activeTaskId: 'task-a', goalCard: null}),
		focus({focusEpoch: 2, activeTaskId: 'task-b', goalCard: confirmCard})
	]);
	assert.equal(activeTranscript(state).goalCard?.goalId, 'g1', 'host goalCard must land on focus');

	// Switching back with a host goalCard=null must clear the stale local card.
	state = reduceWorkspace(state, focus({focusEpoch: 3, activeTaskId: 'task-b', goalCard: null}));
	assert.equal(activeTranscript(state).goalCard ?? null, null, 'host null must override stale cache');
});

test('workspace:focus keeps host goalCard even when an empty transcript keeps the existing body', () => {
	const confirmCard = {
		goalId: 'g2',
		phase: 'awaiting_confirm' as const,
		status: 'awaiting_confirm'
	};
	const state = fold([
		{type: 'focus:optimistic', payload: {taskId: 'task-a', focusEpoch: 1}},
		patch('task-a', [{id: 'e1', role: 'user', text: 'history', status: 'done'}]),
		focus({focusEpoch: 1, activeTaskId: 'task-a', transcript: [], goalCard: confirmCard})
	]);
	assert.equal(activeTranscript(state).entries[0]?.text, 'history', 'body kept');
	assert.equal(activeTranscript(state).goalCard?.goalId, 'g2', 'host goalCard still applied');
});

test('workspace:focus switches active without losing prior body', () => {
	const state = fold([
		focus({
			focusEpoch: 1,
			activeTaskId: 'task-a',
			transcript: [{id: 'e1', role: 'user', text: 'A', status: 'done'}]
		}),
		focus({
			focusEpoch: 2,
			activeTaskId: 'task-b',
			transcript: [{id: 'e2', role: 'user', text: 'B', status: 'done'}]
		})
	]);
	assert.equal(state.activeTaskId, 'task-b');
	assert.equal(activeTranscript(state).entries[0]?.text, 'B');
	assert.equal(transcriptForTask(state, 'task-a').entries[0]?.text, 'A');
});

test('late empty workspace:focus must not wipe session_restored body', () => {
	// Open existing task: optimistic/IPC focus often arrives with transcript:[],
	// while session_restored may patch first. A same-epoch empty focus must not
	// blank the thread (symptom: history missing until reopen).
	const state = fold([
		{type: 'focus:optimistic', payload: {taskId: 'task-a', focusEpoch: 1}},
		patch('task-a', [
			{id: 'e1', role: 'user', text: 'from history', status: 'done'},
			{id: 'e2', role: 'assistant', text: 'restored reply', status: 'done'}
		]),
		focus({
			focusEpoch: 1,
			activeTaskId: 'task-a',
			transcript: []
		})
	]);
	assert.equal(state.activeTaskId, 'task-a');
	assert.equal(activeTranscript(state).entries.length, 2);
	assert.equal(activeTranscript(state).entries[0]?.text, 'from history');
	assert.equal(activeTranscript(state).entries[1]?.text, 'restored reply');
});

test('late structure/pull cannot steal focus after workspace:focus', () => {
	const state = fold([
		focus({
			focusEpoch: 1,
			activeTaskId: 'task-a',
			transcript: [{id: 'e1', role: 'user', text: 'old', status: 'done'}]
		}),
		focus({focusEpoch: 2, activeTaskId: 'task-b', transcript: []}),
		tasksMeta({activeTaskId: 'task-a'}),
		tasksPull({
			activeTaskId: 'task-a',
			entries: [{id: 'e1', role: 'user', text: 'old', status: 'done'}]
		})
	]);
	assert.equal(state.activeTaskId, 'task-b', 'late pull must not steal focus back to A');
	assert.equal(activeTranscript(state).entries.length, 0);
	assert.equal(transcriptForTask(state, 'task-a').entries[0]?.text, 'old');
});

test('stale workspace:focus is dropped by focusEpoch', () => {
	const state = fold([
		{
			type: 'workspace:focus',
			payload: {
				focusEpoch: 2,
				projects: [],
				activeProjectId: null,
				project: null,
				tasks: [],
				chats: [],
				defaultTasks: [],
				activeTaskId: 't-new',
				activeKind: 'task',
				gate: idleGate,
				model: 'default',
				modelDisplay: 'Default',
				modelCatalog: [],
				slashCatalog: [],
				slashCatalogHydrated: false,
				queue: [],
				queuePaused: false,
				transcript: [],
				approvals: [],
				questions: [],
				codeChanges: []
			}
		},
		{
			type: 'workspace:focus',
			payload: {
				focusEpoch: 1,
				projects: [],
				activeProjectId: null,
				project: null,
				tasks: [],
				chats: [],
				defaultTasks: [],
				activeTaskId: 't-stale',
				activeKind: 'task',
				gate: idleGate,
				model: 'default',
				modelDisplay: 'Default',
				modelCatalog: [],
				slashCatalog: [],
				slashCatalogHydrated: false,
				queue: [],
				queuePaused: false,
				transcript: [],
				approvals: [],
				questions: [],
				codeChanges: []
			}
		}
	]);
	assert.equal(state.activeTaskId, 't-new');
	assert.equal(state.focusEpoch, 2);
});

test('focus:optimistic rollback restores focus without decreasing the epoch', () => {
	let state = fold([
		{
			type: 'projects:changed',
			payload: {
				projects: [
					{id: 'p1', path: '/a', status: 'ready', active: true},
					{id: 'p2', path: '/b', status: 'ready', active: false}
				],
				activeProjectId: 'p1',
				projectTasks: {
					p1: [{id: 't1', title: 'A', active: true}],
					p2: [{id: 't2', title: 'B'}]
				},
				projectTasksHydrated: {p1: true, p2: true}
			}
		},
		{
			type: 'workspace:focus',
			payload: {
				focusEpoch: 1,
				projects: [
					{id: 'p1', path: '/a', status: 'ready', active: true},
					{id: 'p2', path: '/b', status: 'ready', active: false}
				],
				activeProjectId: 'p1',
				project: {id: 'p1', path: '/a', status: 'ready'},
				tasks: [{id: 't1', title: 'A', active: true}],
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
				transcript: [{id: 'e1', role: 'user', text: 'A', status: 'done'}],
				approvals: [],
				questions: [],
				codeChanges: []
			}
		}
	]);
	const prep = beginOptimisticFocus(state, 't2');
	assert.ok(prep);
	state = reduceWorkspace(state, prep!.event);
	assert.equal(state.activeTaskId, 't2');
	assert.equal(state.activeProjectId, 'p2');
	assert.equal(state.focusEpoch, 2);
	state = reduceWorkspace(state, {
		type: 'focus:rollback',
		payload: {failedEpoch: prep!.focusEpoch, snapshot: prep!.snapshot}
	});
	assert.equal(state.activeTaskId, 't1');
	assert.equal(state.activeProjectId, 'p1');
	assert.equal(state.focusEpoch, 2);
});

test('late focus rollback cannot override a newer focus epoch', () => {
	const snapshot = {...initialWorkspaceState(), activeTaskId: 't1', focusEpoch: 1};
	const current = {...snapshot, activeTaskId: 't3', focusEpoch: 3};
	const next = reduceWorkspace(current, {
		type: 'focus:rollback',
		payload: {failedEpoch: 2, snapshot}
	});
	assert.equal(next, current);
});

test('focus rollback preserves Transcript pushes received while select was pending', () => {
	const body = {
		entries: [{id: 'e2', role: 'assistant' as const, text: 'new', status: 'done' as const}],
		approvals: [],
		questions: [],
		codeChanges: []
	};
	const snapshot = {...initialWorkspaceState(), activeTaskId: 't1', focusEpoch: 1};
	const pending = {
		...snapshot,
		activeTaskId: 't2',
		focusEpoch: 2,
		byTaskId: {t1: body},
		bodyFromPush: {t1: true as const}
	};
	const next = reduceWorkspace(pending, {
		type: 'focus:rollback',
		payload: {failedEpoch: 2, snapshot}
	});
	assert.equal(next.activeTaskId, 't1');
	assert.equal(next.focusEpoch, 2);
	assert.equal(next.byTaskId.t1, body);
	assert.equal(next.bodyFromPush.t1, true);
});

test('focus:optimistic on defaultTasks marks only that task active', () => {
	let state = fold([
		{
			type: 'tasks:changed',
			payload: {
				tasks: [],
				chats: [],
				defaultTasks: [
					{id: 'd1', title: 'First', sessionId: 's1', active: true},
					{id: 'd2', title: 'Second', sessionId: 's2', active: false},
					{id: 'd3', title: 'Third', sessionId: 's3', active: false}
				],
				defaultTasksHydrated: true,
				activeTaskId: 'd1',
				activeKind: 'task',
				gate: idleGate,
				model: 'default',
				modelDisplay: 'Default',
				modelCatalog: [],
				slashCatalog: [],
				slashCatalogHydrated: false,
				queue: [],
				queuePaused: false
			}
		}
	]);
	assert.equal(state.activeTaskId, null, 'structure does not own focus');
	const prep = beginOptimisticFocus(state, 'd3');
	assert.ok(prep);
	state = reduceWorkspace(state, prep!.event);
	assert.equal(state.activeTaskId, 'd3');
	assert.equal(state.defaultTasks.find(t => t.id === 'd3')?.active, true);
	assert.equal(state.defaultTasks.find(t => t.id === 'd1')?.active, false);
	assert.equal(state.defaultTasks.filter(t => t.active).length, 1);
});

test('focus:clear drops activeTaskId without touching project inventory', () => {
	let state = fold([focus({activeTaskId: 'task-a', gate: idleGate})]);
	assert.equal(state.activeTaskId, 'task-a');
	state = reduceWorkspace(state, {
		type: 'focus:clear',
		payload: {focusEpoch: state.focusEpoch + 1}
	});
	assert.equal(state.activeTaskId, null);
	assert.equal(state.activeKind, null);
	assert.equal(state.gate.runState, 'idle');
});

// --- P1-6: slim workspace:focus (no body fields) ---

test('slim focus keeps the cached body (does not blank a warm task)', () => {
	const base = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'history')]),
		focus({focusEpoch: 2, activeTaskId: 'k2'}),
		patch('k2', [entry('x1', 'other')])
	]);
	const back = reduceWorkspace(base, slimFocus({focusEpoch: 3, activeTaskId: 'k1'}));
	assert.equal(back.activeTaskId, 'k1');
	assert.deepEqual(
		back.byTaskId['k1']!.entries.map(e => e.text),
		['history'],
		'warm body must survive a slim focus'
	);
});

test('slim focus revision mismatch refreshes a warm body and rejects an older pull', () => {
	let state = fold([
		slimFocus({focusEpoch: 1, activeTaskId: 'k1', bodyRevision: 10}),
		patch('k1', [entry('e1', 'cached')], idleGate, 10)
	]);
	state = reduceWorkspace(
		state,
		slimFocus({focusEpoch: 2, activeTaskId: 'k1', bodyRevision: 11})
	);
	assert.equal(state.byTaskId.k1!.entries[0]!.text, 'cached');
	assert.equal(state.bodyRevision.k1, 10);
	assert.equal(state.activeBodyRevision, 11);
	assert.equal(bodyNeedsPull(state, 'k1'), true);

	state = reduceWorkspace(
		state,
		tasksPull({activeTaskId: 'k1', bodyRevision: 11, entries: [entry('e2', 'fresh')]})
	);
	assert.equal(state.byTaskId.k1!.entries[0]!.text, 'fresh');
	assert.equal(state.bodyRevision.k1, 11);
	assert.equal(state.bodyFromPush.k1, true, 'revisioned pull marks the body authoritative');
	assert.equal(bodyNeedsPull(state, 'k1'), false);

	const afterStalePull = reduceWorkspace(
		state,
		tasksPull({activeTaskId: 'k1', bodyRevision: 10, entries: [entry('e3', 'stale')]})
	);
	assert.equal(afterStalePull.byTaskId.k1!.entries[0]!.text, 'fresh');
});

test('slim focus on a cold task leaves body absent so the pull can fill it', () => {
	const state = fold([slimFocus({activeTaskId: 'cold-1'})]);
	assert.equal(state.activeTaskId, 'cold-1');
	assert.equal(state.byTaskId['cold-1'], undefined);
	assert.equal(state.bodyFromPush['cold-1'], undefined);
	assert.equal(bodyNeedsPull(state, 'cold-1'), true);

	// Cold pull then fills the body.
	const pulled = fold([tasksPull({activeTaskId: 'cold-1', entries: [entry('e1', 'restored')]})], state);
	assert.deepEqual(
		pulled.byTaskId['cold-1']!.entries.map(e => e.text),
		['restored']
	);
	assert.equal(bodyNeedsPull(pulled, 'cold-1'), false);
});

test('slim focus updates goalCard as host truth without claiming a body push', () => {
	const goal = {goalId: 'g1', phase: 'busy', title: 'Goal'} as import('./env').GoalCardView;
	const warm = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'history')])
	]);
	const updated = reduceWorkspace(warm, slimFocus({focusEpoch: 2, activeTaskId: 'k1', goalCard: goal}));
	assert.equal(updated.byTaskId['k1']!.goalCard, goal);
	assert.deepEqual(updated.byTaskId['k1']!.entries.map(e => e.text), ['history']);

	const cold = fold([slimFocus({activeTaskId: 'k9', goalCard: goal})]);
	assert.equal(cold.byTaskId['k9']!.goalCard, goal);
	assert.equal(cold.bodyFromPush['k9'], undefined, 'goal-only slice must not block the cold pull');
});
