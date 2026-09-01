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
} from './workspaceStore.js';

const idleGate = {
	runState: 'idle' as const,
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};

const runningGate = {
	...idleGate,
	runState: 'running' as const,
	canCancel: true,
	canEnqueue: true
};

function fold(events: WorkspaceEvent[], start: WorkspaceState = initialWorkspaceState()): WorkspaceState {
	return events.reduce((s, e) => reduceWorkspace(s, e), start);
}

test('tasks:changed upgrades Default modelDisplay even without focus match', () => {
	const state = fold([
		focus({activeTaskId: 't1', focusEpoch: 1}),
		{
			type: 'tasks:changed',
			payload: {
				tasks: [{id: 't2', title: 'Other', active: true}],
				chats: [],
				defaultTasks: [],
				activeTaskId: 't2',
				activeKind: 'task',
				gate: runningGate,
				model: 'default',
				modelDisplay: 'openai/gpt-5.6-luna',
				modelCatalog: [],
				slashCatalog: [],
				slashCatalogHydrated: false,
				queue: [{id: 'q1', text: 'queued'}],
				queuePaused: false
			}
		}
	]);
	assert.equal(
		state.modelDisplay,
		'openai/gpt-5.6-luna',
		'resolved engine label must replace the Default stub'
	);
	assert.equal(state.activeTaskId, 't1', 'structural publish must not steal focus');
	assert.equal(state.gate.runState, 'idle', 'gate stays focus-scoped');
	assert.deepEqual(state.queue, [], 'queue stays focus-scoped');
});

function tasksMeta(partial: {
	activeTaskId: string | null;
	gate?: typeof idleGate;
	queue?: Array<{id: string; text: string}>;
}): WorkspaceEvent {
	return {
		type: 'tasks:changed',
		payload: {
			tasks: partial.activeTaskId
				? [{id: partial.activeTaskId, title: 'T', active: true}]
				: [],
			chats: [],
			defaultTasks: [],
			activeTaskId: partial.activeTaskId,
			activeKind: 'task',
			gate: partial.gate ?? idleGate,
			model: 'default',
			modelDisplay: 'Default',
			modelCatalog: [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: partial.queue ?? [],
			queuePaused: false
		}
	};
}

function tasksPull(partial: {
	activeTaskId: string | null;
	bodyRevision?: number;
	model?: string;
	modelDisplay?: string;
	modelCatalog?: WorkspaceState['modelCatalog'];
	entries?: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>;
}): WorkspaceEvent {
	return {
		type: 'tasks:pull',
		payload: {
			tasks: [],
			chats: [],
			defaultTasks: [],
			activeTaskId: partial.activeTaskId,
			bodyRevision: partial.bodyRevision,
			activeKind: 'task',
			gate: idleGate,
			model: partial.model ?? 'default',
			modelDisplay: partial.modelDisplay ?? 'Default',
			modelCatalog: partial.modelCatalog ?? [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: [],
			queuePaused: false,
			transcript: partial.entries ?? [],
			approvals: [],
			questions: [],
			codeChanges: []
		}
	};
}

function patch(
	taskId: string,
	entries: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>,
	gate = idleGate,
	bodyRevision?: number
): WorkspaceEvent {
	return {
		type: 'transcript:patched',
		payload: {
			taskId,
			bodyRevision,
			entries,
			approvals: [],
			questions: [],
			codeChanges: [],
			gate
		}
	};
}

function focus(partial: {
	focusEpoch?: number;
	activeTaskId: string | null;
	bodyRevision?: number;
	slim?: boolean;
	activeProjectId?: string | null;
	gate?: typeof idleGate;
	queue?: Array<{id: string; text: string}>;
	transcript?: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>;
	tasks?: Array<{id: string; title: string; active: boolean}>;
	defaultTasks?: Array<{id: string; title: string; sessionId?: string; active: boolean}>;
	goalCard?: import('./env').GoalCardView | null;
}): WorkspaceEvent {
	const activeTaskId = partial.activeTaskId;
	return {
		type: 'workspace:focus',
		payload: {
			focusEpoch: partial.focusEpoch ?? 1,
			projects: partial.activeProjectId
				? [{id: partial.activeProjectId, path: '/p', status: 'ready', active: true}]
				: [],
			activeProjectId: partial.activeProjectId ?? null,
			project: partial.activeProjectId
				? {id: partial.activeProjectId, path: '/p', status: 'ready'}
				: null,
			tasks:
				partial.tasks ??
				(activeTaskId ? [{id: activeTaskId, title: 'T', active: true}] : []),
			chats: [],
			defaultTasks: partial.defaultTasks ?? [],
			activeTaskId,
			bodyRevision: partial.bodyRevision,
			activeKind: activeTaskId ? 'task' : null,
			gate: partial.gate ?? idleGate,
			model: 'default',
			modelDisplay: 'Default',
			modelCatalog: [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: partial.queue ?? [],
			queuePaused: false,
			...(partial.slim
				? {}
				: {
						transcript: partial.transcript ?? [],
						approvals: [],
						questions: [],
						codeChanges: []
					}),
			goalCard: partial.goalCard ?? null
		}
	};
}

test('transcript:patched writes body; gate only when task is focused', () => {
	const state = fold([
		focus({activeTaskId: 'task-a'}),
		patch('task-a', [{id: 'e1', role: 'user', text: 'hi', status: 'done'}], runningGate)
	]);
	assert.equal(state.activeTaskId, 'task-a');
	assert.equal(activeTranscript(state).entries[0]?.text, 'hi');
	assert.equal(state.gate.runState, 'running');
});

test('transcript:patched for non-focused task does not steal focus or gate', () => {
	const state = fold([
		focus({activeTaskId: 'task-a', gate: idleGate}),
		patch('task-b', [{id: 'e1', role: 'user', text: 'other', status: 'done'}], runningGate)
	]);
	assert.equal(state.activeTaskId, 'task-a');
	assert.equal(state.gate.runState, 'idle');
	assert.equal(transcriptForTask(state, 'task-b').entries[0]?.text, 'other');
});

test('switching Task via focus keeps prior Transcript in byTaskId', () => {
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

test('tasks:changed never owns focus — late structure cannot yank selection', () => {
	const state = fold([
		{
			type: 'tasks:changed',
			payload: {
				tasks: [
					{id: 'task-a', title: 'New task', active: true},
					{id: 'task-b', title: 'Older', active: false}
				],
				chats: [],
				defaultTasks: [],
				activeTaskId: 'task-a',
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
		},
		{type: 'focus:optimistic', payload: {taskId: 'task-b', focusEpoch: 1}},
		{
			type: 'tasks:changed',
			payload: {
				tasks: [
					{id: 'task-a', title: 'New task', active: true},
					{id: 'task-b', title: 'Older', active: false}
				],
				chats: [],
				defaultTasks: [],
				activeTaskId: 'task-a',
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
	assert.equal(state.activeTaskId, 'task-b', 'structure publish must not yank focus');
	assert.equal(state.focusEpoch, 1);
	assert.equal(state.tasks.find(t => t.id === 'task-b')?.active, true);
	assert.equal(state.tasks.find(t => t.id === 'task-a')?.active, false);
});

test('tasks:changed alone never sets activeTaskId (cold focus via workspace:focus)', () => {
	const state = fold([tasksMeta({activeTaskId: 'task-a'})]);
	assert.equal(state.focusEpoch, 0);
	assert.equal(state.activeTaskId, null);
});

test('tasks:changed refreshes chrome only for the focused Task', () => {
	const state = fold([
		focus({
			activeTaskId: 'task-a',
			gate: runningGate,
			transcript: [{id: 'e1', role: 'assistant', text: 'keep', status: 'streaming'}]
		}),
		tasksMeta({activeTaskId: 'task-a', gate: idleGate, queue: [{id: 'q1', text: 'queued'}]})
	]);
	assert.equal(activeTranscript(state).entries[0]?.text, 'keep');
	assert.equal(state.gate.runState, 'idle');
	assert.equal(state.queue[0]?.text, 'queued');
});

test('tasks:changed chrome for another Task does not overwrite focused gate', () => {
	const state = fold([
		focus({activeTaskId: 'task-b', gate: runningGate}),
		tasksMeta({activeTaskId: 'task-a', gate: idleGate, queue: [{id: 'q1', text: 'x'}]})
	]);
	assert.equal(state.activeTaskId, 'task-b');
	assert.equal(state.gate.runState, 'running');
	assert.equal(state.queue.length, 0);
});

test('push wins: late tasks:pull does not overwrite body from patch', () => {
	const state = fold([
		focus({activeTaskId: 'task-a'}),
		patch('task-a', [{id: 'e1', role: 'assistant', text: 'fresh', status: 'streaming'}], runningGate),
		tasksPull({
			activeTaskId: 'task-a',
			entries: [{id: 'e1', role: 'assistant', text: 'stale', status: 'done'}]
		})
	]);
	assert.equal(activeTranscript(state).entries[0]?.text, 'fresh');
	assert.equal(state.gate.runState, 'running');
});

test('push wins: late tasks:pull does not overwrite meta after tasks:changed', () => {
	const state = fold([
		focus({activeTaskId: 'task-b', gate: runningGate}),
		tasksMeta({activeTaskId: 'task-b', gate: runningGate}),
		tasksPull({
			activeTaskId: 'task-a',
			entries: [{id: 'e1', role: 'user', text: 'pull', status: 'done'}]
		})
	]);
	assert.equal(state.activeTaskId, 'task-b');
	assert.equal(state.gate.runState, 'running');
	assert.equal(transcriptForTask(state, 'task-a').entries[0]?.text, 'pull');
});

test('tasks:pull heals empty modelCatalog after a restore push', () => {
	const catalog = [
		{
			id: 'deepseek/deepseek-v4-flash',
			display: 'DeepSeek V4 Flash',
			current: true,
			aliases: [] as string[]
		}
	];
	const state = fold([
		tasksMeta({activeTaskId: 'task-a'}),
		tasksPull({
			activeTaskId: 'task-a',
			model: 'deepseek/deepseek-v4-flash',
			modelDisplay: 'DeepSeek V4 Flash',
			modelCatalog: catalog,
			entries: [{id: 'e1', role: 'user', text: 'pull', status: 'done'}]
		})
	]);
	assert.equal(state.tasksMetaFromPush, true);
	assert.equal(state.modelCatalog.length, 1);
	assert.equal(state.modelCatalog[0]?.id, 'deepseek/deepseek-v4-flash');
	assert.equal(state.modelDisplay, 'DeepSeek V4 Flash');
});

test('cold pull fills body without owning focus', () => {
	const state = fold([
		tasksPull({
			activeTaskId: 'task-a',
			entries: [{id: 'e1', role: 'user', text: 'from pull', status: 'done'}]
		})
	]);
	assert.equal(state.activeTaskId, null);
	assert.equal(transcriptForTask(state, 'task-a').entries[0]?.text, 'from pull');
	assert.equal(state.tasksMetaFromPush, false);
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

test('createWorkspaceStore notifies subscribers on dispatch', () => {
	const store = createWorkspaceStore();
	let ticks = 0;
	store.subscribe(() => {
		ticks += 1;
	});
	store.dispatch(focus({activeTaskId: 'task-a'}));
	store.dispatch(patch('task-a', [{id: 'e1', role: 'user', text: 'x', status: 'done'}]));
	assert.equal(ticks, 2);
	assert.equal(activeTranscript(store.getState()).entries[0]?.text, 'x');
});

test('bridge:error sets bridgeError', () => {
	const state = fold([
		{type: 'bridge:error', payload: {projectId: 'p1', message: 'boom'}}
	]);
	assert.deepEqual(state.bridgeError, {message: 'boom'});
});

test('bridge:error stores code + params', () => {
	const state = fold([
		{
			type: 'bridge:error',
			payload: {
				projectId: 'p1',
				message: '',
				code: 'session.create_failed_detail',
				params: {detail: 'timeout'}
			}
		}
	]);
	assert.deepEqual(state.bridgeError, {
		message: '',
		code: 'session.create_failed_detail',
		params: {detail: 'timeout'}
	});
});

test('bridge:error with empty message clears sticky banner', () => {
	const state = fold([
		{
			type: 'bridge:error',
			payload: {projectId: 'p1', message: '', code: 'session.create_failed'}
		},
		{type: 'bridge:error', payload: {projectId: 'p1', message: ''}}
	]);
	assert.equal(state.bridgeError, null);
});

// --- transcript:tailPatched (perf doc P0-1) ---

function entry(
	id: string,
	text: string,
	status: 'streaming' | 'done' = 'done',
	role: 'user' | 'assistant' = 'assistant'
) {
	return {id, role, text, status};
}

function tailPatched(
	taskId: string,
	partial: {
		from: number;
		total: number;
		entries: ReturnType<typeof entry>[];
		gate?: typeof idleGate;
		approvals?: unknown[];
		codeChanges?: unknown[];
		goalCard?: import('./env').GoalCardView | null;
	}
): WorkspaceEvent {
	return {
		type: 'transcript:tailPatched',
		payload: {
			taskId,
			from: partial.from,
			total: partial.total,
			entries: partial.entries,
			gate: partial.gate ?? idleGate,
			...(partial.approvals ? {approvals: partial.approvals} : {}),
			...(partial.codeChanges ? {codeChanges: partial.codeChanges} : {}),
			...(partial.goalCard !== undefined ? {goalCard: partial.goalCard} : {})
		}
	} as WorkspaceEvent;
}

test('tailPatched replaces the changed tail and keeps untouched sections', () => {
	const base = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'hello'), entry('e2', 'wor', 'streaming')])
	]);
	const next = reduceWorkspace(
		base,
		tailPatched('k1', {
			from: 1,
			total: 2,
			entries: [entry('e2', 'world', 'streaming')],
			gate: runningGate
		})
	);
	const body = next.byTaskId['k1']!;
	assert.deepEqual(
		body.entries.map(e => e.text),
		['hello', 'world']
	);
	assert.equal(body.approvals, base.byTaskId['k1']!.approvals, 'untouched sections keep identity');
	assert.equal(next.gate, runningGate);
});

test('tailPatched appends new entries past the shared prefix', () => {
	const base = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'one')])
	]);
	const next = reduceWorkspace(
		base,
		tailPatched('k1', {from: 1, total: 2, entries: [entry('e2', 'two', 'streaming')]})
	);
	assert.deepEqual(
		next.byTaskId['k1']!.entries.map(e => e.id),
		['e1', 'e2']
	);
});

test('tailPatched ignores desynced patches (gap or total mismatch)', () => {
	const base = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'one')])
	]);
	const gap = reduceWorkspace(
		base,
		tailPatched('k1', {from: 5, total: 6, entries: [entry('e6', 'x')]})
	);
	assert.equal(gap, base, 'from beyond local length must be ignored');
	const mismatch = reduceWorkspace(
		base,
		tailPatched('k1', {from: 1, total: 9, entries: [entry('e2', 'two')]})
	);
	assert.equal(mismatch, base, 'total mismatch must be ignored');
});

test('tailPatched without local base is ignored (heals on next full patch)', () => {
	// tasks:changed establishes no byTaskId body — the true cold-task case.
	const base = fold([tasksMeta({activeTaskId: 'k1'})]);
	const next = reduceWorkspace(
		base,
		tailPatched('k1', {from: 0, total: 1, entries: [entry('e1', 'one')]})
	);
	assert.equal(next, base);
});

test('tailPatched for a non-focused task merges body without touching gate', () => {
	const base = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'one')]),
		patch('k2', [entry('x1', 'other')])
	]);
	const next = reduceWorkspace(
		base,
		tailPatched('k2', {
			from: 1,
			total: 2,
			entries: [entry('x2', 'more', 'streaming')],
			gate: runningGate
		})
	);
	assert.deepEqual(
		next.byTaskId['k2']!.entries.map(e => e.id),
		['x1', 'x2']
	);
	assert.equal(next.gate, base.gate, 'gate stays owned by the focused task');
	assert.equal(next.byTaskId['k1'], base.byTaskId['k1'], 'other bodies untouched');
});

test('tailPatched applies changed optional sections and null goalCard', () => {
	const goal = {goalId: 'g1', phase: 'busy', title: 'Goal'} as import('./env').GoalCardView;
	const withGoal = fold([
		focus({activeTaskId: 'k1'}),
		{
			type: 'transcript:patched',
			payload: {
				taskId: 'k1',
				entries: [entry('e1', 'one')],
				approvals: [],
				questions: [],
				codeChanges: [],
				gate: idleGate,
				goalCard: goal
			}
		} as WorkspaceEvent
	]);
	assert.equal(withGoal.byTaskId['k1']!.goalCard, goal);

	const cleared = reduceWorkspace(
		withGoal,
		tailPatched('k1', {from: 1, total: 1, entries: [], goalCard: null})
	);
	assert.equal(cleared.byTaskId['k1']!.goalCard, null, 'explicit null clears goalCard');

	const kept = reduceWorkspace(
		withGoal,
		tailPatched('k1', {from: 1, total: 1, entries: []})
	);
	assert.equal(kept.byTaskId['k1']!.goalCard, goal, 'absent goalCard keeps existing');
});

// --- subscription-split reference stability (perf doc P0-3) ---

test('tail patch keeps chrome slice identities and equal-content gate identity', () => {
	const base = fold([
		focus({activeTaskId: 'k1', gate: runningGate}),
		patch('k1', [entry('e1', 'one'), entry('e2', 'straming', 'streaming')], runningGate)
	]);
	const next = reduceWorkspace(
		base,
		tailPatched('k1', {
			from: 1,
			total: 2,
			entries: [entry('e2', 'streaming more', 'streaming')],
			gate: {...runningGate}
		})
	);
	assert.notEqual(next.byTaskId['k1'], base.byTaskId['k1'], 'body must update');
	assert.equal(next.projects, base.projects, 'projects identity must survive content patches');
	assert.equal(next.projectTasks, base.projectTasks);
	assert.equal(next.tasks, base.tasks);
	assert.equal(next.chats, base.chats);
	assert.equal(next.defaultTasks, base.defaultTasks);
	assert.equal(next.queue, base.queue);
	assert.equal(next.modelCatalog, base.modelCatalog);
	assert.equal(next.gate, base.gate, 'equal-content gate must keep identity');
});

test('100 entry-only tail frames advance transcript without waking chrome', () => {
	const store = createWorkspaceStore(
		fold([
			focus({activeTaskId: 'k1', gate: runningGate}),
			patch('k1', [entry('e1', 'one'), entry('e2', 'streaming', 'streaming')], runningGate)
		])
	);
	const chromeBefore = store.getChromeSnapshot();
	const chromeVersionBefore = store.getChromeVersion();
	const transcriptVersionBefore = store.getTranscriptVersion('k1');
	const changesBefore = store.getTranscript('k1').codeChanges;
	let chromeTicks = 0;
	let transcriptTicks = 0;
	store.subscribeChrome(() => {
		chromeTicks += 1;
	});
	store.subscribeTranscript('k1', () => {
		transcriptTicks += 1;
	});

	for (let frame = 1; frame <= 100; frame += 1) {
		store.dispatch(
			tailPatched('k1', {
				from: 1,
				total: 2,
				entries: [entry('e2', `streaming ${frame}`, 'streaming')],
				gate: {...runningGate}
			})
		);
	}

	assert.equal(store.getTranscriptVersion('k1'), transcriptVersionBefore + 100);
	assert.equal(transcriptTicks, 100);
	assert.equal(store.getTranscript('k1').entries[1]?.text, 'streaming 100');
	assert.equal(store.getTranscript('k1').codeChanges, changesBefore);
	assert.equal(store.getChromeVersion(), chromeVersionBefore);
	assert.equal(store.getChromeSnapshot(), chromeBefore);
	assert.equal(chromeTicks, 0);
});

test('missing transcript snapshots are referentially stable for useSyncExternalStore', () => {
	const store = createWorkspaceStore();
	assert.equal(store.getTranscript(null), store.getTranscript(null));
	assert.equal(store.getTranscript('missing'), store.getTranscript('missing'));
	assert.equal(store.getTranscript(null), store.getTranscript('missing'));
	assert.equal(store.getTranscriptVersion(null), 0);
	assert.equal(store.getTranscriptVersion('missing'), 0);
});

test('per-Task Transcript cache is LRU-bounded and protects the active Task', () => {
	let state = {...initialWorkspaceState(), activeTaskId: 'active'};
	state = reduceWorkspace(state, patch('active', [entry('active-e', 'keep')], idleGate, 1));
	for (let i = 0; i < BODY_CACHE_MAX + 8; i += 1) {
		state = reduceWorkspace(
			state,
			patch(`background-${i}`, [entry(`e-${i}`, `${i}`)], idleGate, i + 2)
		);
	}

	assert.equal(Object.keys(state.byTaskId).length, BODY_CACHE_MAX);
	assert.equal(Object.keys(state.bodyFromPush).length, BODY_CACHE_MAX);
	assert.equal(Object.keys(state.bodyRevision).length, BODY_CACHE_MAX);
	assert.equal(state.byTaskId.active?.entries[0]?.text, 'keep');
	assert.equal(state.byTaskId[`background-${BODY_CACHE_MAX + 7}`]?.entries[0]?.text, `${BODY_CACHE_MAX + 7}`);
	assert.equal(state.byTaskId['background-0'], undefined);
	assert.equal(state.bodyFromPush['background-0'], undefined);
	assert.equal(state.bodyRevision['background-0'], undefined);
});

test('background Task tail patch notifies only that Task channel', () => {
	const store = createWorkspaceStore(
		fold([
			focus({activeTaskId: 'k1', gate: runningGate}),
			patch('k1', [entry('e1', 'active', 'streaming')], runningGate),
			patch('k2', [entry('e2', 'background', 'streaming')], runningGate)
		])
	);
	let activeTicks = 0;
	let backgroundTicks = 0;
	let chromeTicks = 0;
	store.subscribeTranscript('k1', () => {
		activeTicks += 1;
	});
	store.subscribeTranscript('k2', () => {
		backgroundTicks += 1;
	});
	store.subscribeChrome(() => {
		chromeTicks += 1;
	});

	store.dispatch(
		tailPatched('k2', {
			from: 0,
			total: 1,
			entries: [entry('e2', 'background more', 'streaming')],
			gate: idleGate
		})
	);

	assert.equal(activeTicks, 0);
	assert.equal(backgroundTicks, 1);
	assert.equal(chromeTicks, 0, 'background content must not wake active chrome');
	assert.equal(store.getTranscript('k1').entries[0]?.text, 'active');
	assert.equal(store.getTranscript('k2').entries[0]?.text, 'background more');
	assert.equal(store.getChromeSnapshot().gate, runningGate);
});

test('Code Changes update stays off chrome but changes the Task selector snapshot', () => {
	const store = createWorkspaceStore(
		fold([
			focus({activeTaskId: 'k1', gate: runningGate}),
			patch('k1', [entry('e1', 'streaming', 'streaming')], runningGate)
		])
	);
	const bodyBefore = store.getTranscript('k1');
	const chromeBefore = store.getChromeSnapshot();
	const changes = [
		{id: 'c1', path: 'src/a.ts', tool: 'apply_patch', diff: '+const a = 1', status: 'done'}
	] as import('./env').CodeChange[];
	let transcriptTicks = 0;
	let chromeTicks = 0;
	store.subscribeTranscript('k1', () => {
		transcriptTicks += 1;
	});
	store.subscribeChrome(() => {
		chromeTicks += 1;
	});

	store.dispatch(
		tailPatched('k1', {
			from: 1,
			total: 1,
			entries: [],
			gate: {...runningGate},
			codeChanges: changes
		})
	);

	assert.equal(transcriptTicks, 1);
	assert.equal(chromeTicks, 0);
	assert.equal(store.getChromeSnapshot(), chromeBefore);
	assert.notEqual(store.getTranscript('k1'), bodyBefore);
	assert.equal(store.getTranscript('k1').codeChanges, changes);
});

test('desynced tail and unsubscribed listener do not advance Task channel', () => {
	const store = createWorkspaceStore(
		fold([focus({activeTaskId: 'k1'}), patch('k1', [entry('e1', 'one')])])
	);
	let ticks = 0;
	const off = store.subscribeTranscript('k1', () => {
		ticks += 1;
	});
	const versionBefore = store.getTranscriptVersion('k1');
	store.dispatch(tailPatched('k1', {from: 9, total: 10, entries: [entry('x', 'bad')]}));
	assert.equal(store.getTranscriptVersion('k1'), versionBefore);
	assert.equal(ticks, 0);

	off();
	store.dispatch(
		tailPatched('k1', {
			from: 1,
			total: 2,
			entries: [entry('e2', 'two', 'streaming')]
		})
	);
	assert.equal(store.getTranscriptVersion('k1'), versionBefore + 1);
	assert.equal(ticks, 0);
});

test('real gate change wakes chrome as well as the changed transcript task', () => {
	const store = createWorkspaceStore(
		fold([
			focus({activeTaskId: 'k1', gate: runningGate}),
			patch('k1', [entry('e1', 'streaming', 'streaming')], runningGate)
		])
	);
	const chromeVersionBefore = store.getChromeVersion();
	const transcriptVersionBefore = store.getTranscriptVersion('k1');
	store.dispatch(
		tailPatched('k1', {
			from: 0,
			total: 1,
			entries: [entry('e1', 'done')],
			gate: idleGate
		})
	);
	assert.equal(store.getTranscriptVersion('k1'), transcriptVersionBefore + 1);
	assert.equal(store.getChromeVersion(), chromeVersionBefore + 1);
	assert.equal(store.getChromeSnapshot().gate, idleGate);
});

test('full transcript:patched also keeps equal-content gate identity', () => {
	const base = fold([
		focus({activeTaskId: 'k1', gate: runningGate}),
		patch('k1', [entry('e1', 'one')], runningGate)
	]);
	const next = reduceWorkspace(base, patch('k1', [entry('e1', 'one more')], {...runningGate}));
	assert.equal(next.gate, base.gate);
	const changed = reduceWorkspace(base, patch('k1', [entry('e1', 'x')], idleGate));
	assert.equal(changed.gate, idleGate, 'real gate change must apply');
});

// --- P1: list reconciliation keeps row identity across IPC publishes ---

test('focus switch preserves untouched TaskSummary identities (row memo enabler)', () => {
	const t1 = {id: 'k1', title: 'One', active: true};
	const t2 = {id: 'k2', title: 'Two', active: false};
	const t3 = {id: 'k3', title: 'Three', active: false};
	const base = fold([
		focus({activeTaskId: 'k1', tasks: [t1, t2, t3]})
	]);
	const beforeT2 = base.tasks.find(t => t.id === 'k2');
	const beforeT3 = base.tasks.find(t => t.id === 'k3');

	// Main republishes fresh objects (IPC clone) with focus moved k1 -> k2.
	const next = fold(
		[
			focus({
				focusEpoch: base.focusEpoch + 1,
				activeTaskId: 'k2',
				tasks: [
					{id: 'k1', title: 'One', active: false},
					{id: 'k2', title: 'Two', active: true},
					{id: 'k3', title: 'Three', active: false}
				]
			})
		],
		base
	);
	assert.equal(
		next.tasks.find(t => t.id === 'k3'),
		beforeT3,
		'unchanged row must keep object identity'
	);
	assert.notEqual(next.tasks.find(t => t.id === 'k2'), beforeT2, 'flipped row must change');
	assert.equal(next.tasks.find(t => t.id === 'k2')?.active, true);
	assert.equal(next.tasks.find(t => t.id === 'k1')?.active, false);
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

// --- P1-6: slim workspace:focus (no body fields) ---

function slimFocus(partial: {
	focusEpoch?: number;
	activeTaskId: string | null;
	bodyRevision?: number;
	goalCard?: import('./env').GoalCardView | null;
}): WorkspaceEvent {
	const full = focus({
		focusEpoch: partial.focusEpoch,
		activeTaskId: partial.activeTaskId,
		bodyRevision: partial.bodyRevision,
		goalCard: partial.goalCard
	}) as {type: 'workspace:focus'; payload: Record<string, unknown>};
	const {transcript: _t, approvals: _a, questions: _q, codeChanges: _c, ...slim} = full.payload;
	return {type: 'workspace:focus', payload: slim} as WorkspaceEvent;
}

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

test('transcript:patched carries rerun provenance (superseded) into the slice', () => {
	const state = fold([
		focus({activeTaskId: 'k1'}),
		patch('k1', [entry('e1', 'first')]),
		{
			type: 'transcript:patched',
			payload: {
				taskId: 'k1',
				entries: [entry('e1', 'first'), entry('e2', 'second')],
				approvals: [],
				questions: [],
				codeChanges: [],
				gate: idleGate,
				superseded: {r1: 't2'}
			}
		}
	]);
	assert.deepEqual(transcriptForTask(state, 'k1').superseded, {r1: 't2'});
});
