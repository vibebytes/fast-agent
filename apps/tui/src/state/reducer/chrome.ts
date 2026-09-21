/** reducer.test — reducer chrome actions. Loaded by reducer.test.ts. */
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

test('toggle_debug flips visibility and clears url when hidden', () => {
	let state = reducer(initialState, {type: 'toggle_debug'});
	assert.equal(state.debugVisible, true);
	state = reducer(state, {type: 'set_debug_url', url: 'http://127.0.0.1:1234/'});
	assert.equal(state.debugUrl, 'http://127.0.0.1:1234/');
	state = reducer(state, {type: 'toggle_debug', visible: false});
	assert.equal(state.debugVisible, false);
	assert.equal(state.debugUrl, undefined);
});

test('reducer cycles thinking display mode', () => {
	let state = reducer(initialState, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'full');
	state = reducer(state, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'off');
	state = reducer(state, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'compact');
});

test('reducer toggles file expansion via global toolsExpanded', () => {
	// Bridge file_read is a tool on the transcript entry now; there is no
	// per-file `expanded` flag — Ctrl+O / toggle_file flips `toolsExpanded`.
	let state = reducer(initialState, {type: 'submit_user', text: 'read file', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'file_read', turnId: 'turn_1', path: 'snake.py', language: 'python', content: 'print(1)'}
	});
	state = reducer(state, {type: 'toggle_file'});

	assert.equal(state.toolsExpanded, true);
	assert.equal(tools(state)[0]?.tool, 'file_read');
});

test('reducer toggles tool detail expansion via toolsExpanded', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run tool', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'tool_started',
			turnId: 'turn_1',
			id: 'tool_1',
			tool: 'shell',
			args: {command: 'echo hi'}
		}
	});
	state = reducer(state, {type: 'toggle_tool_detail'});
	assert.equal(state.toolsExpanded, true);

	// 再次调用应该全部折叠
	state = reducer(state, {type: 'toggle_tool_detail'});
	assert.equal(state.toolsExpanded, false);
});

test('reducer tracks queued inputs', () => {
	let state = reducer(initialState, {type: 'enqueue_input', input: {id: 'first', text: 'first', state: 'queued'}});
	state = reducer(state, {type: 'enqueue_input', input: {id: 'second', text: 'second', state: 'queued'}});
	state = reducer(state, {type: 'dequeue_input', id: 'first'});

	assert.equal(state.queue.length, 1);
	assert.deepEqual(state.queue.map(input => input.text), ['second']);
});

test('reducer retains mentions on queued inputs', () => {
	const mentions = [{kind: 'skill', locator: 'plan', ref: '@skill/plan', displayName: 'Plan'}];
	const state = reducer(initialState, {
		type: 'enqueue_input',
		input: {id: 'q1', text: 'use @skill/plan', state: 'queued', mentions}
	});
	assert.deepEqual(state.queue[0]?.mentions, mentions);
});

test('race: clear and help toggle stay stable under late turn_finished', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'toggle_help'});
	state = reducer(state, {type: 'clear'});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(state.helpVisible, false);
	assert.equal(state.transcript.entries.length, 0, 'late turn_finished must not resurrect a cleared turn');
});

test('undo_last_exchange removes last turn', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'hi'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(bridgeTurnCount(state), 1);
	state = reducer(state, {type: 'undo_last_exchange'});
	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.status, 'undo');
});

// ── Heartbeat / Ack ───────────────────────────────────────────────

test('toggle_footer_item toggles individual footer items', () => {
	let state = reducer(initialState, {type: 'toggle_footer_item', id: 'model'});
	assert.equal(state.footerConfig.model, false);

	state = reducer(state, {type: 'toggle_footer_item', id: 'model'});
	assert.equal(state.footerConfig.model, true);
});

test('set_footer_config replaces entire config', () => {
	const config = {...initialState.footerConfig, model: false, cwd: false};
	const state = reducer(initialState, {type: 'set_footer_config', config});
	assert.equal(state.footerConfig.model, false);
	assert.equal(state.footerConfig.cwd, false);
	assert.equal(state.footerConfig.tokens, true);
});

// NB: the old "double input_accepted rewrites turn.id / serverTurnId" suite
// tested a `localTurns`-style Turn shape that no longer exists for Bridge
// content. The same remap invariants (entry id stays stable; deltas route via
// the server turnId) are now covered directly against TranscriptState in
// session-view's transcriptProjection.test.ts, against the timeline's
// append-only invariant in turnAdapter.test.ts ("double input_accepted does
// NOT break settled ID append-only invariant"), and against CancelRun
// targeting in runId.test.ts.

// ── Mid-run re-attach / session_restored races ────────────────────
