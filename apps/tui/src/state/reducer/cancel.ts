/** reducer.test — local cancel / stragglers. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {cancelledRunState} from './kit.js';
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

test('local cancel blocks late deltas from mutating cancelled turn', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'late'}});

	assert.equal(lastAssistant(state)?.status, 'cancelled');
	assert.equal(assistantText(state), '');
	assert.equal(state.orphanEvents.at(-1), 'turn_1');
});

test('turn_cancelled after local cancel restores normal input mode', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});

	// Cancel Settlement: Composer unlocks on turn_cancelled, not run_cancelled.
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_cancelled', reason: 'cancelled by user'}});

	assert.equal(state.running, false);
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(state.inputMode, 'normal');
	assert.equal(lastAssistant(state)?.status, 'cancelled');
});

test('force_cancel_settlement unlocks when turn_cancelled never arrives', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});
	assert.equal(chromeAwaitingSettlement(state.transcript.chrome), true);
	assert.equal(state.running, true);

	state = reducer(state, {type: 'force_cancel_settlement', reason: 'client settlement timeout'});
	assert.equal(chromeAwaitingSettlement(state.transcript.chrome), false);
	assert.equal(state.running, false);
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(state.queuePaused, true);
	assert.equal(state.inputMode, 'normal');
});

test('force_cancel_settlement is a no-op when not awaiting settlement', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	const next = reducer(state, {type: 'force_cancel_settlement'});
	assert.equal(next, state);
});

test('race: local cancel + clear ignores late assistant/tool events', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'partial'}});

	state = reducer(state, {type: 'local_cancel'});
	state = reducer(state, {type: 'clear'});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'late'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_output', turnId: 'turn_1', id: 'tool_late', tool: 'shell', stream: 'stdout', text: 'late tool output'}
	});

	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.orphanEvents.at(-1), 'turn_1');
	assert.equal(state.errors.length, 0);
});

// ── Cancel straggler storm (the /CancelRun screenshot regression) ──
//
// After the engine confirms run_cancelled, an in-flight LLM stream (old
// engines, replayed logs) can keep leaking reasoning/assistant/tool events —
// often with no turnId because the bridge already cleared its turn context.
// The UI is the last line of defense: stragglers must never resurface as
// ghost "Thought" turns interleaved with repeated CancelRun cards.

test('post-cancel stragglers without turnId never create ghost turns', () => {
	let state = cancelledRunState();
	const entriesBefore = state.transcript.entries.length;

	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '·:'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', text: 'contents.'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-1-turn-27', text: 'ghost'}});

	assert.equal(state.transcript.entries.length, entriesBefore, 'stragglers must be orphaned, not resurrected as new entries');
	assert.equal(state.orphanEvents.length, 3);
});

test('post-cancel tool_started straggler never creates a ghost turn', () => {
	let state = cancelledRunState();
	const entriesBefore = state.transcript.entries.length;

	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', id: 'tc-ghost', tool: 'shell', args: {command: 'brew install'}
	}});

	assert.equal(state.transcript.entries.length, entriesBefore);
});

test('post-cancel agent_call_started straggler never adds an agent row', () => {
	let state = cancelledRunState();

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-risk', name: '风控员', depth: 1, runId: 'run-r9'
	}});

	assert.equal(state.agentRuns.length, 0);
});

test('straggler guard lifts once the next turn starts', () => {
	let state = cancelledRunState();
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: 'straggler'}});

	state = reducer(state, {type: 'submit_user', text: 'again', clientMessageId: 'c2'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c2', turnId: 'run-2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-2', text: 'fresh thinking'}});

	assert.equal(lastAssistant(state)?.reasoning, 'fresh thinking');
});

test('mid-run re-attach: homeless stream events with no matching entry are dropped, not resurrected', () => {
	// No terminal run event seen in this process, and no entry to attach to:
	// session-view drops the event outright instead of creating a ghost turn.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-live', text: 'attached mid-run'}});

	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.orphanEvents.at(-1), 'run-live');
});
