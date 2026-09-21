/** reducer.test — applyEvent run lifecycle / status. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {turnsToTimeline} from '../timeline/turnAdapter.js';
import {
	userEntries,
	assistantEntries,
	lastAssistant,
	lastUser,
	entryStatus,
	bridgeTurnCount,
	assistantText,
	userText,
	thinking,
	tools,
	segments,
	localSystemMessages,
	lastLocalTurn,
	approvalsFromState,
	questionsFromState
} from '../../test-utils/transcriptAssert.js';

test('run lifecycle events drive status and surface failures', () => {
	let done = reducer(initialState, {type: 'engine_event', event: {type: 'run_done', runId: 'run_1', success: true, summary: 'ok'}});
	assert.equal(done.status, 'run done');

	let failed = reducer(initialState, {type: 'engine_event', event: {type: 'run_failed', runId: 'run_1', error: 'boom'}});
	assert.equal(failed.status, 'run failed');
	assert.equal(failed.errors.at(-1), 'boom');
	assert.deepEqual(failed.lastFailure, {runId: 'run_1', acceptedTurns: null});

	const failedWithFault = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'run_failed', runId: 'run_2', error: 'boom', fault: {kind: 'engine_error', remedy: 'retry the run', acceptedTurns: 2}}
	});
	assert.deepEqual(failedWithFault.lastFailure, {runId: 'run_2', acceptedTurns: 2});

	// A later successful run clears the stale failure so /continue cannot target it.
	const recovered = reducer(failedWithFault, {type: 'engine_event', event: {type: 'run_done', runId: 'run_3', success: true, summary: 'ok'}});
	assert.equal(recovered.lastFailure, null);

	let cancelled = reducer(initialState, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run_1', reason: 'user stop'}});
	assert.equal(cancelled.status, 'run cancelled: user stop');
});

test('run lifecycle events clear approvals and questions for that run', () => {
	let state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'approval_requested', id: 'app_1', runId: 'run_1', tool: 'shell', description: 'test', risk: 'high', context: 'test'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'question_requested', id: 'q_1', runId: 'run_1', question: 'test', options: [], allowCustom: true}
	});
	assert.equal(approvalsFromState(state).length, 1);
	assert.equal(questionsFromState(state).length, 1);
	assert.equal(state.inputMode, 'question');

	// run_done should clear them
	let stateDone = reducer(state, {type: 'engine_event', event: {type: 'run_done', runId: 'run_1', success: true, summary: 'ok'}});
	assert.equal(approvalsFromState(stateDone).length, 0);
	assert.equal(questionsFromState(stateDone).length, 0);
	assert.equal(stateDone.inputMode, 'normal');

	// run_failed should clear them
	let stateFailed = reducer(state, {type: 'engine_event', event: {type: 'run_failed', runId: 'run_1', error: 'boom'}});
	assert.equal(approvalsFromState(stateFailed).length, 0);
	assert.equal(questionsFromState(stateFailed).length, 0);
	assert.equal(stateFailed.inputMode, 'normal');

	// run_failed with structured fault surfaces kind + remedy in the system row
	const stateFault = reducer(state, {
		type: 'engine_event',
		event: {type: 'run_failed', runId: 'run_1', error: 'boom', fault: {kind: 'engine_error', remedy: 'retry the run'}}
	});
	const faultRow = stateFault.localTurns
		.flatMap(t => t.systemMessages)
		.find(m => m.id.startsWith('run_failed_'));
	assert.ok(faultRow?.text.includes('运行失败：engine_error（retry the run）'));
	assert.equal(faultRow?.detail, 'boom');

	// run_cancelled should clear them
	let stateCancelled = reducer(state, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run_1', reason: 'user stop'}});
	assert.equal(approvalsFromState(stateCancelled).length, 0);
	assert.equal(questionsFromState(stateCancelled).length, 0);
	assert.equal(stateCancelled.inputMode, 'normal');
});

test('engine_exit sets inputMode to exited', () => {
	const state = reducer(initialState, {type: 'engine_exit', code: 1, signal: null});
	assert.equal(state.inputMode, 'exited');
	assert.equal(state.running, false);
	assert.match(state.status, /engine exited/);
});

test('engine_exit with signal', () => {
	const state = reducer(initialState, {type: 'engine_exit', code: null, signal: 'SIGTERM'});
	assert.equal(state.inputMode, 'exited');
	assert.match(state.status, /SIGTERM/);
});

test('error event appends to state.errors', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'error', message: 'first error'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'error', message: 'second error'}});

	assert.equal(state.errors.length, 2);
	assert.equal(state.errors[0], 'first error');
	assert.equal(state.errors[1], 'second error');
	assert.equal(state.status, 'error');
});

test('budget_exhausted event updates status', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'budget_exhausted', turnId: 'turn_1', turns: 12, tokens: 50000}
	});
	assert.match(state.status, /budget exhausted/);
	assert.match(state.status, /12/);
	assert.match(state.status, /50000/);
});

test('context_compressed event updates status', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'context_compressed', turnId: 'turn_1', ratio: 0.65}
	});
	assert.match(state.status, /context compressed 65%/);
});

// ── Multi-turn ────────────────────────────────────────────────────

test('Heartbeat event updates status only', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {type: 'Heartbeat', sessionId: 'sess-1', atMillis: 123}});
	assert.equal(state.status, 'heartbeat');
	assert.equal(state.transcript.entries.length, 0);
});

test('Ack event updates status only', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {type: 'Ack', sessionId: 'sess-1', clientId: 'cli', lastEventSeq: 42}});
	assert.equal(state.status, 'ack 42');
	assert.equal(state.transcript.entries.length, 0);
});

// ── Agent / task lifecycle ────────────────────────────────────────

test('task_done and task_failed drive status', () => {
	let done = reducer(initialState, {type: 'engine_event', event: {type: 'task_done', taskId: 'task_1', success: true, summary: 'ok'}});
	assert.equal(done.status, 'task done');

	let failed = reducer(initialState, {type: 'engine_event', event: {type: 'task_failed', taskId: 'task_1', error: 'boom'}});
	assert.equal(failed.status, 'task failed');
	assert.equal(failed.errors.at(-1), 'boom');
});

// ── Footer config ─────────────────────────────────────────────────

test('run_failed localizes known fault kind and remedy with raw detail tail', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'run_failed',
		runId: 'run_1',
		error: 'Rate exceeded',
		fault: {kind: 'availability', remedy: 'retry_same'}
	}});
	const row = state.localTurns.flatMap(t => t.systemMessages).find(m => m.id.startsWith('run_failed_'));
	assert.ok(row?.text.includes('模型暂时不可用'));
	assert.ok(row?.text.includes('以相同设置重试'));
	assert.equal(row?.detail, 'Rate exceeded');
});
