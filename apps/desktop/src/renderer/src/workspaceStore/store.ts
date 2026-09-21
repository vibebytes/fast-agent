/** workspaceStore.test — store notify / bridge:error / identities. Loaded by workspaceStore.test.ts. */
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

// --- subscription-split reference stability (perf doc P0-3) ---

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
