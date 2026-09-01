import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {
	FIXTURE_ALL_SEQUENCES,
	FIXTURE_READY,
	FIXTURE_TURN_FLOW,
	FIXTURE_APPROVAL,
	FIXTURE_QUESTION,
	FIXTURE_SHELL_TOOL,
	FIXTURE_GREP_NOSUCHFILE,
	applyEventSequence
} from './bridgeEvents.js';
import {ALLOWED_BRIDGE_COMMANDS, UI_BOUNDARIES} from '../boundaries/uiBoundaries.js';
import {
	bridgeTurnCount,
	userText,
	assistantText,
	tools,
	approvalsFromState,
	questionsFromState
} from '../test-utils/transcriptAssert.js';

test('UI boundaries are frozen', () => {
	assert.equal(UI_BOUNDARIES.mustNotExecuteTools, true);
	assert.equal(UI_BOUNDARIES.mustNotEnforcePolicy, true);
	assert.deepEqual(ALLOWED_BRIDGE_COMMANDS, [
		'AttachSession',
		'DetachSession',
		'SubmitUserMessage',
		'command',
		'CancelRun',
		'CancelSession',
		'AnswerQuestion',
		'DecideApproval',
		'Ack',
		'Heartbeat',
		'CreateSession',
		'GetWorkspaceMeta',
		'SetSessionTitle',
		'SetSessionSummary',
		'UpdateSessionStatus',
		'SetProjectDisplayName'
	]);
});

test('ready fixture produces expected state', () => {
	const state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);
	assert.equal(state.ready, true);
	assert.equal(state.model, 'deepseek');
	assert.equal(state.protocolVersion, 2);
	assert.equal(state.commands.length, 3);
});

test('turn flow fixture preserves tool order', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, FIXTURE_TURN_FLOW);
	assert.equal(tools(state).length, 1);
	assert.equal(tools(state)[0]?.tool, 'list_dir');
	assert.equal(assistantText(state), 'Done.');
	assert.equal(state.running, false);
});

test('ready fixture alone', () => {
	const state = reducer(initialState, {type: 'engine_event', event: FIXTURE_READY});
	assert.equal(state.cwd, '/tmp/workspace');
	assert.equal(state.capabilities.includes('structuredQuestions'), true);
});

test('golden: full approval flow (submit → approval → approved → tool → answer)', () => {
	let state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);
	state = reducer(state, {type: 'submit_user', text: 'run dangerous', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, [
		{type: 'input_accepted', turnId: 'turn_1', clientMessageId: 'client_1'},
		{type: 'turn_started', turnId: 'turn_1', clientMessageId: 'client_1', text: 'run dangerous'},
		{type: 'thinking_started', turnId: 'turn_1', turn: 1, maxTurns: 50},
		...FIXTURE_APPROVAL,
		...FIXTURE_SHELL_TOOL.map(e => ({...e, turnId: 'turn_1'} as import('../rpc/protocol.js').BridgeEvent)),
		{type: 'assistant_delta', turnId: 'turn_1', text: 'All done.'},
		{type: 'turn_finished', turnId: 'turn_1', success: true}
	]);

	assert.equal(approvalsFromState(state).length, 0);
	assert.equal(state.running, false);
	assert.equal(tools(state).length, 1);
	assert.equal(assistantText(state), 'All done.');
	assert.equal(state.inputMode, 'normal');
});

test('golden: full question flow (submit → question → answered → answer)', () => {
	let state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);
	state = reducer(state, {type: 'submit_user', text: 'create app', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, [
		{type: 'input_accepted', turnId: 'turn_1', clientMessageId: 'client_1'},
		{type: 'turn_started', turnId: 'turn_1', clientMessageId: 'client_1', text: 'create app'},
		...FIXTURE_QUESTION.map(e => ({...e, turnId: 'turn_1'} as import('../rpc/protocol.js').BridgeEvent)),
		{type: 'assistant_delta', turnId: 'turn_1', text: 'Created in new directory.'},
		{type: 'turn_finished', turnId: 'turn_1', success: true}
	]);

	assert.equal(questionsFromState(state).length, 0);
	assert.equal(state.running, false);
	assert.equal(assistantText(state), 'Created in new directory.');
	assert.equal(state.inputMode, 'normal');
});

test('golden: multi-turn conversation', () => {
	let state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);

	state = reducer(state, {type: 'submit_user', text: 'first', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, [
		{type: 'input_accepted', turnId: 'turn_1', clientMessageId: 'client_1'},
		{type: 'assistant_delta', turnId: 'turn_1', text: 'Answer 1.'},
		{type: 'turn_finished', turnId: 'turn_1', success: true}
	]);

	state = reducer(state, {type: 'submit_user', text: 'second', clientMessageId: 'client_2'});
	state = applyEventSequence(state, reducer, [
		{type: 'input_accepted', turnId: 'turn_2', clientMessageId: 'client_2'},
		...FIXTURE_SHELL_TOOL.map(e => ({...e, turnId: 'turn_2'} as import('../rpc/protocol.js').BridgeEvent)),
		{type: 'assistant_delta', turnId: 'turn_2', text: 'Answer 2.'},
		{type: 'turn_finished', turnId: 'turn_2', success: true}
	]);

	assert.equal(bridgeTurnCount(state), 2);
	assert.equal(userText(state, 0), 'first');
	assert.equal(assistantText(state, 0), 'Answer 1.');
	assert.equal(userText(state, 1), 'second');
	assert.equal(tools(state, 1).length, 1);
	assert.equal(assistantText(state, 1), 'Answer 2.');
});

test('golden: grep NoSuchFile unlocks composer after turn_finished', () => {
	let state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);
	state = reducer(state, {type: 'submit_user', text: 'find RunEntity', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, FIXTURE_GREP_NOSUCHFILE);

	assert.equal(tools(state).length, 1);
	assert.equal(tools(state)[0]?.tool, 'grep');
	assert.equal(tools(state)[0]?.status, 'error');
	assert.match(tools(state)[0]?.output ?? '', /NoSuchFileException/);
	assert.equal(state.running, false);
	assert.equal(state.inputMode, 'normal');
	assert.equal(assistantText(state), 'path missing');
});

test('golden: session restore then new turn', () => {
	let state = applyEventSequence(initialState, reducer, FIXTURE_ALL_SEQUENCES.ready);
	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'restored-session',
		turns: [
			{turnId: 'old_1', userText: 'past question', assistantText: 'past answer', thinking: 'thought', tokensUsed: 50}
		]
	}});

	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(state.sessionId, 'restored-session');
	assert.equal(userText(state), 'past question');

	state = reducer(state, {type: 'submit_user', text: 'new question', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, [
		{type: 'input_accepted', turnId: 'turn_new', clientMessageId: 'client_1'},
		{type: 'assistant_delta', turnId: 'turn_new', text: 'New answer.'},
		{type: 'turn_finished', turnId: 'turn_new', success: true}
	]);

	assert.equal(bridgeTurnCount(state), 2);
	assert.equal(assistantText(state, 1), 'New answer.');
});
