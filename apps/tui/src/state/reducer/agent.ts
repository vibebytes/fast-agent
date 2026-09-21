/** reducer.test — applyEvent agent_call / view / define. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {runWithTool, turnWithAnswer} from './kit.js';
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

test('agent_call_started creates an agent run entry', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'researcher', depth: 0
	}});
	assert.equal(state.agentRuns.length, 1);
	assert.equal(state.agentRuns[0]?.agentId, 'agent-1');
	assert.equal(state.agentRuns[0]?.name, 'researcher');
	assert.equal(state.agentRuns[0]?.status, 'running');
	assert.equal(state.agentRuns[0]?.toolCalls, 0);
});

test('agent_call_finished updates agent run status', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'coder', depth: 1
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: true, tokensUsed: 500, elapsedMs: 1200, toolCalls: 3
	}});
	assert.equal(state.agentRuns.length, 1);
	assert.equal(state.agentRuns[0]?.status, 'success');
	assert.equal(state.agentRuns[0]?.tokensUsed, 500);
	assert.equal(state.agentRuns[0]?.elapsedMs, 1200);
	assert.equal(state.agentRuns[0]?.toolCalls, 3);
});

test('agent_call_finished stores the failure detail so the ✗ row can explain itself', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'agentB_visual', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: false, elapsedMs: 6200, toolCalls: 1, runId: 'run-a',
		detail: 'cancelled: parent run cancelled'
	}});
	assert.equal(state.agentRuns[0]?.status, 'failed');
	assert.equal(state.agentRuns[0]?.detail, 'cancelled: parent run cancelled');
});

test('tool events with agentId track currentTool on agent run', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', turnId: 't1', id: 'tool-1', tool: 'shell', args: {command: 'ls'}, agentId: 'agent-1'
	}});
	// The running row shows WHAT is running, not just the tool name.
	assert.equal(state.agentRuns[0]?.currentTool, 'shell ls');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_finished', turnId: 't1', id: 'tool-1', tool: 'shell', success: true, fields: {}, agentId: 'agent-1'
	}});
	assert.equal(state.agentRuns[0]?.currentTool, undefined);
	assert.equal(state.agentRuns[0]?.toolCalls, 1);
});

// The regression behind the duplicated 风控员 rows: the same agent delegated
// several times shares one agentId, so run rows must be keyed by runId.

test('same agent called twice yields two rows and runId-scoped finish', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: '风控员', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: '风控员', depth: 0, runId: 'run-b'
	}});
	assert.equal(state.agentRuns.length, 2);

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: false, elapsedMs: 4900, toolCalls: 2, runId: 'run-a'
	}});
	assert.equal(state.agentRuns[0]?.status, 'failed');
	assert.equal(state.agentRuns[0]?.elapsedMs, 4900);
	// The second run of the same agent must be untouched.
	assert.equal(state.agentRuns[1]?.status, 'running');
	assert.equal(state.agentRuns[1]?.elapsedMs, undefined);
});

test('replayed agent_call_started for a known runId does not append a duplicate row', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	assert.equal(state.agentRuns.length, 1);
});

test('tool events with agentRunId only touch that run', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-b'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_finished', turnId: 't1', id: 'tool-1', tool: 'shell', success: true, fields: {}, agentId: 'agent-1', agentRunId: 'run-b'
	}});
	assert.equal(state.agentRuns[0]?.toolCalls, 0);
	assert.equal(state.agentRuns[1]?.toolCalls, 1);
});

test('events without agentId do not affect agent runs', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', turnId: 't1', id: 'tool-1', tool: 'read_file', args: {path: 'x.ts'}
	}});
	assert.equal(state.agentRuns.length, 0, 'no agent runs created for non-agent tool events');
	assert.equal(tools(state).length, 1, 'tool still added to the transcript entry');
});

test('run_done clears agentRuns', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'worker', depth: 0
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'run_done', runId: 'run-1', success: true, summary: 'done'
	}});
	assert.equal(state.agentRuns.length, 0, 'agent runs cleared after run_done');
});

test('agent_call_finished stores the resultSummary shown under the ✓ row', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: true, runId: 'run-a',
		resultSummary: '找到 3 处相关实现'
	}});
	assert.equal(state.agentRuns[0]?.resultSummary, '找到 3 处相关实现');
});

// Batch assignment keys the tree grouping + settle-as-a-unit rule.

test('concurrent top-level delegations share a batch; sequential ones do not', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	// run-b starts while run-a is still running → same batch (keyed by run-a).
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'reviewer', depth: 1, runId: 'run-b'
	}});
	assert.equal(state.agentRuns[0]?.batchId, undefined, 'first root keys the batch by its own runId');
	assert.equal(state.agentRuns[1]?.batchId, 'run-a');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a1', success: true, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a2', success: true, runId: 'run-b'
	}});
	// Sequential: everything terminal → the next delegation opens a NEW batch.
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a3', name: 'explorer', depth: 1, runId: 'run-c'
	}});
	assert.equal(state.agentRuns[2]?.batchId, undefined);
});

test('a nested delegation joins its parent run batch via parentRunId', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'sentiment', depth: 2, runId: 'run-nested', parentRunId: 'run-a'
	}});
	assert.equal(state.agentRuns[1]?.parentRunId, 'run-a');
	assert.equal(state.agentRuns[1]?.batchId, 'run-a', 'child inherits the parent batch, not a sibling one');
});

test('re-delegating a failed agent under the same parent is flagged as a retry', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a1', success: false, runId: 'run-a', detail: 'boom'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-b'
	}});
	assert.equal(state.agentRuns[1]?.isRetry, true);

	// A different agent after the failure is NOT a retry.
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'reviewer', depth: 1, runId: 'run-c'
	}});
	assert.equal(state.agentRuns[2]?.isRetry, undefined);
});

test('out-of-order agent_call_finished tolerates unknown agentId', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'ghost', success: false
	}});
	assert.equal(state.agentRuns.length, 0, 'no crash on unknown agentId');
});

test('agent_timeline stores drill-down timeline keyed by agentId', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_timeline',
		agentId: 'a1',
		parentAgentId: 'root',
		name: 'Researcher',
		turns: [{turnId: 't1', userText: 'analyze BTC', assistantText: 'BTC looks bullish'}],
		children: [{agentId: 'c1', name: 'Kline Analyst'}]
	}});
	const timeline = state.agentTimelines['a1'];
	assert.ok(timeline, 'timeline stored under agentId');
	assert.equal(timeline?.name, 'Researcher');
	assert.equal(timeline?.parentAgentId, 'root');
	assert.equal(timeline?.turns.length, 1);
	assert.equal(timeline?.turns[0]?.assistantText, 'BTC looks bullish');
	assert.equal(timeline?.children[0]?.name, 'Kline Analyst');
});

// --- agent view stack tests ---

test('agent_view_push/pop manages view stack', () => {
	let state = {...initialState};
	const entry = {agentId: 'a1', name: 'Researcher', siblings: [{agentId: 'a1', name: 'Researcher'}, {agentId: 'a2', name: 'Writer'}]};
	state = reducer(state, {type: 'agent_view_push', entry});
	assert.equal(state.agentViewStack.entries.length, 1);
	assert.equal(state.agentViewStack.entries[0]?.name, 'Researcher');

	const child = {agentId: 'c1', name: 'Sentiment', siblings: [{agentId: 'c1', name: 'Sentiment'}]};
	state = reducer(state, {type: 'agent_view_push', entry: child});
	assert.equal(state.agentViewStack.entries.length, 2);

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 1);
	assert.equal(state.agentViewStack.entries[0]?.name, 'Researcher');

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 0);

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 0, 'pop on empty stack is no-op');
});

test('run_cancelled and run_failed clear live agent rows like run_done does', () => {
	let base = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	base = reducer(base, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	base = reducer(base, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	base = reducer(base, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-risk', name: '风控员', depth: 1, runId: 'run-r1'
	}});
	assert.equal(base.agentRuns.length, 1);

	const cancelled = reducer(base, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run-1', reason: 'user stop'}});
	assert.equal(cancelled.agentRuns.length, 0, 'cancelled run must not leave running agent rows behind');

	const failed = reducer(base, {type: 'engine_event', event: {type: 'run_failed', runId: 'run-1', error: 'boom'}});
	assert.equal(failed.agentRuns.length, 0, 'failed run must not leave running agent rows behind');
});

// ── Defined-but-not-yet-called agents (Ctrl+G 提示语依据) ──────────

test('define_agent success registers the agent name as defined', () => {
	const state = runWithTool('define_agent', {name: '风控员', tools: '["read_file","grep"]'});
	assert.deepEqual(state.definedAgents, ['风控员']);
});

test('failed define_agent registers nothing', () => {
	const state = runWithTool('define_agent', {name: '风控员'}, false);
	assert.deepEqual(state.definedAgents, []);
});

test('delete_agent removes the name; duplicate defines never double-register', () => {
	let state = runWithTool('define_agent', {name: '风控员'});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-2', tool: 'define_agent', args: {name: '风控员'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-2', tool: 'define_agent', success: true, fields: {}}});
	assert.deepEqual(state.definedAgents, ['风控员']);

	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-3', tool: 'delete_agent', args: {name: '风控员'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-3', tool: 'delete_agent', success: true, fields: {}}});
	assert.deepEqual(state.definedAgents, []);
});

test('defined agents survive run_done so Ctrl+G can explain after the turn', () => {
	let state = runWithTool('define_agent', {name: '风控员'});
	state = reducer(state, {type: 'engine_event', event: {type: 'run_done', runId: 'run-1', success: true, summary: 'ok'}});
	assert.deepEqual(state.definedAgents, ['风控员']);
});

test('agent_view_sibling switches between siblings', () => {
	let state = {...initialState};
	const entry = {agentId: 'a1', name: 'Researcher', siblings: [
		{agentId: 'a1', name: 'Researcher'},
		{agentId: 'a2', name: 'Writer'},
		{agentId: 'a3', name: 'Reviewer'}
	]};
	state = reducer(state, {type: 'agent_view_push', entry});

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a2');
	assert.equal(state.agentViewStack.entries[0]?.name, 'Writer');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a3');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a1', 'wraps around');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'prev'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a3', 'prev wraps around');
});

test('rerun_started hides victim assistant rows but keeps user row visible', () => {
	let state = turnWithAnswer('old answer');
	assert.equal(turnsToTimeline(state).items.filter(i => i.kind === 'assistant_message').length, 1);

	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	const items = turnsToTimeline(state).items;
	assert.equal(items.filter(i => i.kind === 'assistant_message').length, 0);
	assert.ok(items.some(i => i.kind === 'user_message'));
});

test('RerunRun rejection renders localized card and retires optimistic hide', () => {
	let state = turnWithAnswer('old answer');
	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'RerunRun', status: 'error', message: 'session_busy: another run is active'
	}});
	const row = state.localTurns.flatMap(t => t.systemMessages).at(-1);
	assert.ok(row?.text.includes('会话正忙'));
	assert.equal(state.rerunPendingRunId, null);
	assert.ok(turnsToTimeline(state).items.some(i => i.kind === 'assistant_message'), 'victim visible again');
});

test('RerunRun acceptance stays silent and keeps pending hide until restore', () => {
	let state = turnWithAnswer('old answer');
	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	const before = state.localTurns.flatMap(t => t.systemMessages).length;
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'RerunRun', status: 'success', message: 'accepted'
	}});
	assert.equal(state.localTurns.flatMap(t => t.systemMessages).length, before);
	assert.equal(state.rerunPendingRunId, 'turn_1');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'turn_2', userText: 'hi', assistantText: 'new answer', supersedes: 'turn_1'}]
	}});
	assert.equal(state.rerunPendingRunId, null);
});
