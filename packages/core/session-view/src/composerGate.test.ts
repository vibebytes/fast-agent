import test from 'node:test';
import assert from 'node:assert/strict';
import {
	CANCEL_SETTLEMENT_TIMEOUT_MS,
	canAutoDequeue,
	canFlushQueuedInput,
	composerGate,
	composerGateFromRunFlags,
	type ComposerGate
} from './composerGate.js';
import {createTranscriptState, type TranscriptState} from './transcriptProjection.js';

function gate(partial: Partial<TranscriptState>, sessionReady = true): ComposerGate {
	return composerGate({...createTranscriptState(), ...partial}, sessionReady);
}

test('cancel settlement timeout is ~12s (≥ Engine hard timeout)', () => {
	assert.equal(CANCEL_SETTLEMENT_TIMEOUT_MS, 12_000);
});

test('canAutoDequeue: finished yes, cancelled never', () => {
	assert.equal(canAutoDequeue('finished'), true);
	assert.equal(canAutoDequeue('cancelled'), false);
});

test('canFlushQueuedInput: boot buffer (null terminal) flushes when ready', () => {
	assert.equal(
		canFlushQueuedInput({
			sessionReady: true,
			running: false,
			queuePaused: false,
			queueLength: 1,
			lastTurnTerminal: null
		}),
		true
	);
	assert.equal(
		canFlushQueuedInput({
			sessionReady: false,
			running: false,
			queuePaused: false,
			queueLength: 1,
			lastTurnTerminal: null
		}),
		false
	);
});

test('canFlushQueuedInput: cancelled never; finished yes', () => {
	assert.equal(
		canFlushQueuedInput({
			sessionReady: true,
			running: false,
			queuePaused: false,
			queueLength: 1,
			lastTurnTerminal: 'cancelled'
		}),
		false
	);
	assert.equal(
		canFlushQueuedInput({
			sessionReady: true,
			running: false,
			queuePaused: false,
			queueLength: 1,
			lastTurnTerminal: 'finished'
		}),
		true
	);
});

test('idle + ready → submit, no enqueue, no cancel, unlocked', () => {
	assert.deepEqual(gate({}), {
		runState: 'idle',
		canSubmitNow: true,
		canEnqueue: false,
		canCancel: false,
		composerLocked: false,
		lockReason: null
	});
});

test('idle + not ready → nothing', () => {
	assert.deepEqual(gate({}, false), {
		runState: 'idle',
		canSubmitNow: false,
		canEnqueue: false,
		canCancel: false,
		composerLocked: false,
		lockReason: null
	});
});

test('running (activeRunId) → enqueue, cancel; no direct submit', () => {
	assert.deepEqual(gate({activeRunId: 'run-1'}), {
		runState: 'running',
		canSubmitNow: false,
		canEnqueue: true,
		canCancel: true,
		composerLocked: false,
		lockReason: null
	});
});

test('running (streaming entry) → enqueue, cancel', () => {
	const g = gate({
		entries: [
			{
				id: 'a1',
				role: 'assistant',
				text: '',
				status: 'streaming',
				tools: []
			}
		]
	});
	assert.equal(g.runState, 'running');
	assert.equal(g.canEnqueue, true);
	assert.equal(g.canCancel, true);
	assert.equal(g.canSubmitNow, false);
});

test('stopping → enqueue allowed, cancel stays, no direct submit, Composer unlocked', () => {
	assert.deepEqual(gate({activeRunId: 'run-1', awaitingCancelSettlement: true}), {
		runState: 'stopping',
		canSubmitNow: false,
		canEnqueue: true,
		canCancel: true,
		composerLocked: false,
		lockReason: null
	});
});

test('stopping without activeRunId still Stopping', () => {
	const g = gate({awaitingCancelSettlement: true});
	assert.equal(g.runState, 'stopping');
	assert.equal(g.canEnqueue, true);
	assert.equal(g.canCancel, true);
	assert.equal(g.canSubmitNow, false);
});

test('prompt lock: waiting for user is idle — Stop off, composer locked', () => {
	const g = gate({
		activeRunId: 'run-1',
		approvals: [{id: 'ap1', runId: 'run-1', tool: 'shell', description: 'run'}]
	});
	assert.equal(g.runState, 'idle');
	assert.equal(g.composerLocked, true);
	assert.equal(g.lockReason, 'prompt');
	assert.equal(g.canSubmitNow, false);
	assert.equal(g.canEnqueue, false);
	assert.equal(g.canCancel, false);
});

test('question_requested path: activeRunId + streaming + question → Stop off', () => {
	// Mirrors Bridge events after SkillSlash ask_user_question (grilling).
	const g = gate({
		activeRunId: '019f-host',
		questions: [{id: 'q1', runId: '019f-host', question: 'Which candidate?', options: []}],
		entries: [
			{
				id: 'a1',
				role: 'assistant',
				text: '',
				status: 'streaming',
				tools: [],
				turnId: '019f-host'
			}
		]
	});
	assert.equal(g.runState, 'idle');
	assert.equal(g.canCancel, false);
	assert.equal(g.composerLocked, true);
});

test('questionBatches lock Composer and extinguish Stop', () => {
	const g = gate({
		activeRunId: 'run-1',
		questionBatches: [{rpcId: 'rpc-1', runId: 'run-1', questions: [{id: 'q1', question: 'Go?'}]}],
		entries: [
			{
				id: 'a1',
				role: 'assistant',
				text: '',
				status: 'streaming',
				tools: [],
				turnId: 'run-1'
			}
		]
	});
	assert.equal(g.runState, 'idle');
	assert.equal(g.canCancel, false);
	assert.equal(g.composerLocked, true);
});

test('prompt lock on idle blocks submit', () => {
	const g = gate({
		questions: [{id: 'q1', runId: 'r', question: '?', options: []}]
	});
	assert.equal(g.runState, 'idle');
	assert.equal(g.composerLocked, true);
	assert.equal(g.lockReason, 'prompt');
	assert.equal(g.canSubmitNow, false);
	assert.equal(g.canEnqueue, false);
});

test('stopping + prompt: Stopping wins for runState, prompt still locks', () => {
	const g = gate({
		awaitingCancelSettlement: true,
		approvals: [{id: 'ap1', runId: 'run-1', tool: 'shell', description: 'run'}]
	});
	assert.equal(g.runState, 'stopping');
	assert.equal(g.composerLocked, true);
	assert.equal(g.canEnqueue, false);
	assert.equal(g.canCancel, true);
});

test('running subagent does not lock; child questionBatch does', () => {
	const running = gate({
		subagents: [
			{
				childSessionId: 'child-1',
				mode: 'continuable',
				label: 'bg',
				activity: 'running'
			}
		]
	});
	assert.equal(running.composerLocked, false);
	assert.equal(running.canSubmitNow, true);
	const locked = gate({
		subagents: [
			{
				childSessionId: 'child-1',
				mode: 'continuable',
				label: 'bg',
				activity: 'running'
			}
		],
		questionBatches: [
			{rpcId: 'rpc-q', runId: 'r1', questions: [{id: 'q1', question: 'Go?'}]}
		]
	});
	assert.equal(locked.composerLocked, true);
	assert.equal(locked.lockReason, 'prompt');
});

test('composerGateFromRunFlags matches Stopping without transcript entries', () => {
	const g = composerGateFromRunFlags({
		sessionReady: true,
		running: true,
		awaitingCancelSettlement: true,
		approvals: [],
		questions: []
	});
	assert.equal(g.runState, 'stopping');
	assert.equal(g.canEnqueue, true);
	assert.equal(g.canSubmitNow, false);
});
