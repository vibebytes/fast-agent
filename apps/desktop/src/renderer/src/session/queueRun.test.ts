import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queueAffordance, sendLightsForQueuedRun} from './queueRun.js';

test('idle queue lights 执行; a live turn lights 插话; pause and lock stay dark', () => {
	assert.equal(
		queueAffordance({
			runState: 'idle',
			canSubmitNow: true,
			canEnqueue: false,
			canCancel: false,
			queuePaused: false,
			queueLength: 6
		}),
		'run'
	);
	assert.equal(
		queueAffordance({
			runState: 'running',
			canSubmitNow: false,
			canEnqueue: true,
			canCancel: true,
			queuePaused: false,
			queueLength: 2
		}),
		'interrupt'
	);
	assert.equal(
		queueAffordance({
			runState: 'running',
			canSubmitNow: true,
			canEnqueue: false,
			canCancel: false,
			queuePaused: false,
			queueLength: 2
		}),
		'interrupt'
	);
	assert.equal(
		queueAffordance({
			runState: 'idle',
			canSubmitNow: true,
			canEnqueue: false,
			canCancel: false,
			queuePaused: true,
			queueLength: 2
		}),
		'none'
	);
	assert.equal(
		queueAffordance({
			runState: 'idle',
			canSubmitNow: false,
			canEnqueue: false,
			canCancel: false,
			queuePaused: false,
			queueLength: 2
		}),
		'none'
	);
});

test('empty composer send button lights only to run a queued head', () => {
	assert.equal(
		sendLightsForQueuedRun({affordance: 'run', hasDraft: false, composerDisabled: false}),
		true
	);
	assert.equal(
		sendLightsForQueuedRun({affordance: 'run', hasDraft: true, composerDisabled: false}),
		false
	);
	assert.equal(
		sendLightsForQueuedRun({affordance: 'interrupt', hasDraft: false, composerDisabled: false}),
		false
	);
	assert.equal(
		sendLightsForQueuedRun({affordance: 'run', hasDraft: false, composerDisabled: true}),
		false
	);
});
