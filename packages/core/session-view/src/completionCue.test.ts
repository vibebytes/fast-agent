import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSoundOnSettle, type CompletionCueInput} from './completionCue.js';

const ready: CompletionCueInput = {
	kind: 'turn_finished',
	wasBusy: true,
	runState: 'idle',
	composerLocked: false,
	queueLength: 0,
	queuePaused: false,
	goalBusy: false
};

test('turn_finished after a live run cues', () => {
	assert.equal(shouldSoundOnSettle(ready), true);
});

test('replay / hydrate turn_finished without a live run does not cue', () => {
	assert.equal(shouldSoundOnSettle({...ready, wasBusy: false}), false);
});

test('cancel path and non-finish events do not cue', () => {
	assert.equal(shouldSoundOnSettle({...ready, kind: 'other'}), false);
	assert.equal(shouldSoundOnSettle({...ready, runState: 'stopping'}), false);
	assert.equal(shouldSoundOnSettle({...ready, runState: 'running'}), false);
});

test('waiting for user / approval does not cue', () => {
	assert.equal(shouldSoundOnSettle({...ready, composerLocked: true}), false);
});

test('queued follow-up that will auto-flush does not cue', () => {
	assert.equal(shouldSoundOnSettle({...ready, queueLength: 1}), false);
	assert.equal(shouldSoundOnSettle({...ready, queueLength: 1, queuePaused: true}), true);
});

test('mid-Goal turn_finished does not cue; Goal finish does', () => {
	assert.equal(shouldSoundOnSettle({...ready, goalBusy: true}), false);
	assert.equal(
		shouldSoundOnSettle({
			...ready,
			kind: 'goal_finished',
			wasBusy: true,
			goalBusy: false
		}),
		true
	);
	assert.equal(
		shouldSoundOnSettle({
			...ready,
			kind: 'goal_finished',
			wasBusy: false,
			goalBusy: false
		}),
		false
	);
});
