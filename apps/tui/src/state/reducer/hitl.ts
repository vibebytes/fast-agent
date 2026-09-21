/** reducer.test — applyEvent approval / question / clarify. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {stateWithApproval} from './kit.js';
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

test('reducer folds clarify event into zero-option User Question', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'clarify', runId: 'run_1', turnId: 'turn_1', id: 'clarify_1', question: '需要补充什么？'}
	});

	assert.equal(state.status, 'question');
	assert.equal(state.inputMode, 'clarify');
	const questions = questionsFromState(state);
	assert.equal(questions.length, 1);
	assert.equal(questions[0]?.question, '需要补充什么？');
	assert.deepEqual(questions[0]?.options, []);
	assert.equal(state.errors.length, 0);
	assert.equal(localSystemMessages(state).at(-1)?.role, 'system');
	assert.equal(localSystemMessages(state).at(-1)?.text, '需要补充什么？');
});

test('reducer tracks structured questions', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'create app', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'question_requested',
			runId: 'run_1',
			turnId: 'turn_1',
			id: 'question_1',
			title: 'Location',
			question: 'Where?',
			options: [{id: 'here', label: 'Here'}],
			allowCustom: true
		}
	});

	assert.equal(state.inputMode, 'question');
	let questions = questionsFromState(state);
	assert.equal(questions.length, 1);
	assert.equal(questions[0]?.runId, 'run_1');
	assert.equal(questions[0]?.options[0]?.id, 'here');

	state = reducer(state, {type: 'engine_event', event: {type: 'question_answered', id: 'question_1'}});
	questions = questionsFromState(state);
	assert.equal(questions.length, 0);
});

test('approval_requested sets inputMode to approval and adds to approvals', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'approval_1', tool: 'shell', description: 'Run rm', risk: 'Shell', context: 'rm -rf node_modules'}
	});

	assert.equal(state.inputMode, 'approval');
	const approvals = approvalsFromState(state);
	assert.equal(approvals.length, 1);
	assert.equal(approvals[0]?.tool, 'shell');
	assert.equal(approvals[0]?.risk, 'Shell');
	assert.equal(approvals[0]?.context, 'rm -rf node_modules');
});

test('approval_resolved removes approval and restores inputMode', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'approval_1', tool: 'shell', description: 'Run rm', risk: 'Shell', context: 'rm -rf'}
	});
	assert.equal(state.inputMode, 'approval');

	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', turnId: 'turn_1', id: 'approval_1', approved: true}});
	assert.equal(approvalsFromState(state).length, 0);
	assert.equal(state.inputMode, 'running');
});

test('stacked approvals: second approval after first resolved', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'a1', tool: 'shell', description: 'cmd1', risk: 'Shell', context: 'ls'}
	});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', turnId: 'turn_1', id: 'a1', approved: true}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'a2', tool: 'shell', description: 'cmd2', risk: 'Destructive', context: 'rm -rf'}
	});

	const approvals = approvalsFromState(state);
	assert.equal(approvals.length, 1);
	assert.equal(approvals[0]?.id, 'a2');
	assert.equal(state.inputMode, 'approval');
});

// ── Error / exit ──────────────────────────────────────────────────

// --- Approval decision state machine ---

test('approval_decision_sent records the in-flight decision on the approval', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});

	assert.deepEqual(approvalsFromState(state)[0]?.decision, {value: 'y', sentAt: 1000});
});

test('approval_decision_failed marks the decision failed', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'approval_decision_failed', id: 'appr_1', reason: '发送失败'});

	assert.equal(approvalsFromState(state)[0]?.decision?.failed, '发送失败');
});

test('command_result(DecideApproval) ACKs the in-flight decision without a transcript card', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	const localTurnsBefore = state.localTurns.length;
	const messagesBefore = localSystemMessages(state).length;

	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'status=Running;decision=applied', status: 'decided'
	}});

	assert.equal(approvalsFromState(state)[0]?.decision?.acked, true, 'decision acked');
	assert.equal(approvalsFromState(state)[0]?.decision?.failed, undefined, 'applied is not a failure');
	assert.equal(state.localTurns.length, localTurnsBefore, 'no new local turn');
	assert.equal(localSystemMessages(state).length, messagesBefore, 'no transcript card');
});

test('command_result(DecideApproval) with stale decision marks the approval failed', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'status=Failed;decision=stale', status: 'decided'
	}});

	assert.equal(approvalsFromState(state)[0]?.decision?.acked, true);
	assert.match(approvalsFromState(state)[0]?.decision?.failed ?? '', /stale/);
});

test('command_result(DecideApproval) error status carries the message as failure reason', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'AskTimeoutException: recipient terminated', status: 'error'
	}});

	assert.match(approvalsFromState(state)[0]?.decision?.failed ?? '', /AskTimeoutException/);
});

test('approval_expired removes the approval and explains why in the transcript', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_expired', id: 'appr_1', reason: 'engine_restart'}});

	assert.equal(approvalsFromState(state).length, 0, 'expired approval dropped');
	assert.equal(state.inputMode, 'normal');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(notices.some(text => text.includes('审批已失效') && text.includes('引擎已重启')), 'expiry notice with reason');

	// Unknown id changes nothing but the debug log.
	const unchanged = reducer(state, {type: 'engine_event', event: {type: 'approval_expired', id: 'ghost', reason: 'engine_restart'}});
	assert.deepEqual(unchanged.transcript.approvals, state.transcript.approvals);
	assert.equal(unchanged.localTurns, state.localTurns);
});

test('approval_resolved clears the approval including its decision state', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', id: 'appr_1', approved: true}});

	assert.equal(approvalsFromState(state).length, 0);
});

// --- Engine epoch (generation) handling ---
