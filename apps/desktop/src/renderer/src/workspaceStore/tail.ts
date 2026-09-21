/** workspaceStore.test — reduce transcript:tailPatched. Loaded by workspaceStore.test.ts. */
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

// --- transcript:tailPatched (perf doc P0-1) ---

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
