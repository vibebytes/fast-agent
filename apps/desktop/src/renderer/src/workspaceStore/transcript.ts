/** workspaceStore.test — reduce transcript:patched. Loaded by workspaceStore.test.ts. */
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
