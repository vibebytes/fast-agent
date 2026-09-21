/** workspaceStore.test — reduce tasks:changed / tasks:pull. Loaded by workspaceStore.test.ts. */
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

test('tasks:changed applies availableEngineIds even when focus does not match', () => {
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
	assert.equal(state.activeTaskId, 't1');
	assert.equal(state.engineKind, 'fast');
});

test('tasks:changed without engineKind keeps a dsh picker choice', () => {
	const state = fold([
		focus({activeTaskId: 't1', focusEpoch: 1}),
		{
			type: 'tasks:changed',
			payload: {
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
				engineKind: 'dsh'
			}
		},
		{
			type: 'tasks:changed',
			payload: {
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
				queuePaused: false
			}
		}
	]);
	assert.equal(state.engineKind, 'dsh');
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
