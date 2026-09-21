/** protocol.test — sessionSettle. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts run lifecycle events', () => {
	assert.equal(bridgeEventSchema.parse({type: 'run_done', runId: 'run_1', success: true, summary: 'done', eventSeq: 1}).type, 'run_done');
	assert.equal(bridgeEventSchema.parse({type: 'run_failed', runId: 'run_1', error: 'boom', eventSeq: 2}).type, 'run_failed');
	assert.equal(bridgeEventSchema.parse({type: 'run_exhausted', runId: 'run_1', reason: 'max turns', eventSeq: 3}).type, 'run_exhausted');
	assert.equal(
		bridgeEventSchema.parse({type: 'llm_network_wait', runId: 'run_1', phase: 'retrying', attempt: 1, maxAttempts: 2, eventSeq: 4})
			.type,
		'llm_network_wait'
	);
	assert.equal(bridgeEventSchema.parse({type: 'run_cancelled', runId: 'run_1', reason: 'stop', eventSeq: 5}).type, 'run_cancelled');
	assert.equal(bridgeEventSchema.parse({type: 'turn_cancelled', reason: 'user cancel', eventSeq: 6}).type, 'turn_cancelled');
	assert.equal(bridgeEventSchema.parse({type: 'turn_finished', success: true, eventSeq: 7}).type, 'turn_finished');
	assert.equal(
		bridgeEventSchema.parse({type: 'turn_finished', success: false, reason: 'insufficient_quota', eventSeq: 8}).type,
		'turn_finished'
	);
});

test('subagent_* events parse', () => {
	const started = bridgeEventSchema.parse({
		type: 'subagent_started',
		eventSeq: 1,
		runId: 'r1',
		childSessionId: 'child-1',
		mode: 'one-shot',
		label: 'explore'
	});
	assert.equal(started.type === 'subagent_started' ? started.childSessionId : undefined, 'child-1');
	const updated = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'inactive'
	});
	assert.equal(updated.type === 'subagent_updated' ? updated.activity : undefined, 'inactive');
	assert.equal(updated.type === 'subagent_updated' ? updated.preview : 'missing', undefined);
	const withPreview = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'running',
		preview: 'read_file a',
		unknownField: true
	});
	assert.equal(withPreview.type === 'subagent_updated' ? withPreview.preview : undefined, 'read_file a');
	const emptyPreview = bridgeEventSchema.parse({
		type: 'subagent_updated',
		eventSeq: 2,
		childSessionId: 'child-1',
		activity: 'running',
		preview: ''
	});
	assert.equal(emptyPreview.type === 'subagent_updated' ? emptyPreview.preview : undefined, '');
	const finished = bridgeEventSchema.parse({
		type: 'subagent_finished',
		eventSeq: 3,
		childSessionId: 'child-1',
		status: 'completed'
	});
	assert.equal(finished.type === 'subagent_finished' ? finished.status : undefined, 'completed');
	const restored = bridgeEventSchema.parse({
		type: 'session_restored',
		sessionId: 's1',
		turns: []
	});
	assert.equal(restored.type, 'session_restored');
	assert.equal('subagents' in restored, false);
});

test('run_failed parses with and without structured fault', () => {
	const withFault = bridgeEventSchema.parse({
		type: 'run_failed',
		runId: 'run_01JABC',
		error: 'FaultCarrier: Declined: Connection prematurely closed',
		sessionId: 's1',
		fault: {
			kind: 'availability',
			remedy: 'retry_same',
			retryableAfterMs: 2000,
			attempts: 3,
			acceptedTurns: 2
		}
	});
	if (withFault.type === 'run_failed') {
		assert.equal(withFault.fault?.kind, 'availability');
		assert.equal(withFault.fault?.remedy, 'retry_same');
		assert.equal(withFault.fault?.retryableAfterMs, 2000);
		assert.equal(withFault.fault?.attempts, 3);
		assert.equal(withFault.fault?.acceptedTurns, 2);
	} else {
		assert.fail('expected run_failed');
	}

	const withoutFault = bridgeEventSchema.parse({
		type: 'run_failed',
		runId: 'run_01JABC',
		error: 'plain legacy failure'
	});
	if (withoutFault.type === 'run_failed') {
		assert.equal(withoutFault.error, 'plain legacy failure');
		assert.equal(withoutFault.fault, undefined);
	} else {
		assert.fail('expected run_failed');
	}
});

test('dsh_caps requires all five capability keys', () => {
	const base = {
		type: 'dsh_caps' as const,
		sessionId: 's1',
		queue: true,
		goal: true,
		budget: false,
		question: true,
		slash: true
	};
	assert.equal(bridgeEventSchema.parse(base).type, 'dsh_caps');
	assert.throws(() => bridgeEventSchema.parse({type: 'dsh_caps', sessionId: 's1', queue: true}));
	assert.throws(() => bridgeEventSchema.parse({...base, eventSeq: 1}));
});

test('dsh_caps carries optional delta capability bits', () => {
	const base = {
		type: 'dsh_caps' as const,
		sessionId: 's1',
		queue: true,
		goal: true,
		budget: false,
		question: true,
		slash: true
	};
	const omitted = bridgeEventSchema.parse(base);
	assert.equal(omitted.type, 'dsh_caps');
	if (omitted.type === 'dsh_caps') {
		assert.equal(omitted.delta, undefined);
	}

	const withRerun = bridgeEventSchema.parse({...base, rerun: false});
	assert.equal(withRerun.type, 'dsh_caps');
	if (withRerun.type === 'dsh_caps') {
		assert.equal(withRerun.rerun, false);
	}

	const withDelta = bridgeEventSchema.parse({
		...base,
		delta: {usage: true, childTranscript: true, goalDelta: false, contextPrune: true}
	});
	assert.equal(withDelta.type, 'dsh_caps');
	if (withDelta.type === 'dsh_caps') {
		assert.equal(withDelta.delta?.usage, true);
		assert.equal(withDelta.delta?.childTranscript, true);
		assert.equal(withDelta.delta?.goalDelta, false);
		assert.equal(withDelta.delta?.contextPrune, true);
	}

	assert.throws(() => bridgeEventSchema.parse({...base, delta: {usage: true}}));
});

test('background process bridge events and KillProc command', () => {
	const completed = bridgeEventSchema.parse({
		type: 'background_task_completed',
		procId: 'p1',
		runId: 'r1',
		exitCode: 0,
		shouldWake: true,
		command: 'sleep 1'
	});
	assert.equal(completed.type, 'background_task_completed');

	const proc = bridgeEventSchema.parse({
		type: 'proc_updated',
		procId: 'p1',
		status: 'running',
		command: 'sleep 1'
	});
	assert.equal(proc.type, 'proc_updated');

	// Engine historically emitted JSON null for absent Option[String].
	const procNullReason = bridgeEventSchema.parse({
		type: 'proc_updated',
		sessionId: 's1',
		turnId: 't1',
		eventSeq: 211,
		procId: 'p1',
		status: 'running',
		runId: 'r1',
		command: 'echo $TMPDIR',
		outFile: '/tmp/p1.log',
		reason: null
	});
	assert.equal(procNullReason.type, 'proc_updated');
	if (procNullReason.type === 'proc_updated') {
		assert.equal(procNullReason.reason ?? null, null);
	}

	const output = bridgeEventSchema.parse({
		type: 'background_task_output',
		procId: 'p1',
		text: 'chunk\n'
	});
	assert.equal(output.type, 'background_task_output');

	const wake = bridgeEventSchema.parse({
		type: 'will_wake',
		procId: 'p1',
		shouldWake: true,
		reason: 'user_stopped'
	});
	assert.equal(wake.type, 'will_wake');

	const suppressed = bridgeEventSchema.parse({
		type: 'background_wake_suppressed',
		procId: 'p1',
		reason: 'wait_consumed'
	});
	assert.equal(suppressed.type, 'background_wake_suppressed');

	const batch = bridgeCommandSchema.parse({
		type: 'AnswerQuestionBatch',
		sessionId: 's1',
		rpcId: 'rpc-1',
		answers: [{id: 'q1', selected: ['Yes']}]
	});
	assert.equal(batch.type, 'AnswerQuestionBatch');
	if (batch.type === 'AnswerQuestionBatch') {
		assert.equal(batch.rpcId, 'rpc-1');
		assert.deepEqual(batch.answers, [{id: 'q1', selected: ['Yes']}]);
	}
	const cancelled = bridgeCommandSchema.parse({
		type: 'AnswerQuestionBatch',
		sessionId: 's1',
		rpcId: 'rpc-1',
		cancelled: true
	});
	assert.equal(cancelled.type, 'AnswerQuestionBatch');
	if (cancelled.type === 'AnswerQuestionBatch') {
		assert.equal(cancelled.cancelled, true);
	}

	const kill = bridgeCommandSchema.parse({
		type: 'KillProc',
		sessionId: 's1',
		procId: 'p1',
		reason: 'user_stopped'
	});
	assert.equal(kill.type, 'KillProc');
	if (kill.type === 'KillProc') {
		assert.equal(kill.procId, 'p1');
		assert.equal(kill.reason, 'user_stopped');
	}
});

test('bridgeEventSchema accepts child_work_changed lifecycle rows', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'child_work_changed',
		sessionId: 'sess-1',
		kind: 'goal',
		id: 'goal:g1',
		title: '每日巡检',
		status: 'running'
	});
	assert.equal(parsed.type, 'child_work_changed');
	if (parsed.type === 'child_work_changed') {
		assert.equal(parsed.kind, 'goal');
		assert.equal(parsed.id, 'goal:g1');
	}

	const withParent = bridgeEventSchema.parse({
		type: 'child_work_changed',
		sessionId: 'sess-1',
		kind: 'run',
		id: 'run:r2',
		parentRef: 'run:r1',
		title: 'subagent',
		status: 'succeeded',
		summary: 'done',
		outputPreview: 'tool tail…'
	});
	assert.equal(withParent.type, 'child_work_changed');
	if (withParent.type === 'child_work_changed') {
		assert.equal(withParent.outputPreview, 'tool tail…');
	}
});
