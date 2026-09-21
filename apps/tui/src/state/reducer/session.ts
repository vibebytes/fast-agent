/** reducer.test — applyEvent ready / restore / sessions_list. Loaded by reducer.test.ts. */
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

test('reducer records ready metadata and clears UI state', () => {
	let state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'ready', model: 'default', modelDisplay: 'default -> deepseek-reasoner', maxTurns: 12, standalone: true, cwd: '/tmp/agent', mode: 'bridge'}
	});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'clear'});

	assert.equal(state.ready, true);
	assert.equal(state.model, 'default');
	assert.equal(state.modelDisplay, 'default -> deepseek-reasoner');
	assert.equal(state.maxTurns, 12);
	assert.equal(state.cwd, '/tmp/agent');
	assert.equal(state.transcript.entries.length, 0);
});

test('reducer restores session history from session_restored event', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'fix bug',
			assistantText: 'done',
			thinking: 'planning',
			tools: [{id: 'tool_1', tool: 'shell', args: {command: 'ls'}, status: 'success', summary: 'ok'}],
			tokensUsed: 10
		}]
	}});

	assert.equal(state.sessionId, 'sess-1');
	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'fix bug');
	assert.equal(thinking(state), 'planning');
	assert.equal(tools(state)[0]?.tool, 'shell');
	assert.equal(state.running, false);
	// Legacy crush shape still builds chronological segments
	assert.deepEqual(
		segments(state).map(s => s.kind),
		['thinking', 'tools', 'assistant']
	);
});

test('reducer restores chronological segments from session_restored steps', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'research',
			assistantText: 'done',
			thinking: 'first\nsecond',
			tools: [
				{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'},
				{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}
			],
			steps: [
				{
					reasoning: 'first',
					tools: [{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}],
					text: 'looking'
				},
				{
					reasoning: 'second',
					tools: [{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
					text: 'done'
				}
			]
		}]
	}});

	assert.equal(bridgeTurnCount(state), 1);
	const segs = segments(state);
	assert.deepEqual(
		segs.map(s => s.kind),
		['thinking', 'tools', 'assistant', 'thinking', 'tools', 'assistant']
	);
	const thinkingSegs = segs.filter(s => s.kind === 'thinking');
	assert.equal(thinkingSegs[0] && thinkingSegs[0].kind === 'thinking' ? thinkingSegs[0].text : '', 'first');
	assert.equal(thinkingSegs[1] && thinkingSegs[1].kind === 'thinking' ? thinkingSegs[1].text : '', 'second');
});

test('reducer restores preamble before tools when textBeforeTools is set', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'look',
			assistantText: '我先列目录',
			tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
			steps: [{
				text: '我先列目录',
				textBeforeTools: true,
				tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}]
			}]
		}]
	}});

	assert.deepEqual(
		segments(state).map(s => s.kind),
		['assistant', 'tools']
	);
	assert.equal(assistantText(state), '我先列目录');
});

test('reducer stores sessions_list payload', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'sessions_list',
		sessions: [{
			id: 'sess-1',
			title: 'Auth work',
			summary: 'OAuth fixes',
			lastModified: '2026-06-09T08:00:00Z',
			messageCount: 6,
			cwd: '/tmp/project',
			isCurrent: true
		}]
	}});

	assert.equal(state.sessions.length, 1);
	assert.equal(state.sessions[0]?.title, 'Auth work');
});

test('session_restored mid-run keeps the in-flight turn', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: '继续构建', clientMessageId: 'client_live'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_live', turnId: 'turn_live'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_live', text: '思考中'}});

	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}]
	}});

	assert.equal(bridgeTurnCount(state), 2, 'restored history + live turn');
	assert.equal(assistantEntries(state)[0]?.turnId, 'restored_0');
	assert.equal(assistantEntries(state)[1]?.turnId, 'turn_live');
	assert.equal(assistantEntries(state)[1]?.status, 'streaming');
	assert.equal(state.running, true, 'run stays in flight across restore');
});

test('stray stream after restore never mutates a completed restored turn (dropped as orphan)', () => {
	// session-view drops homeless stream events when no entry is streaming —
	// unlike the old localTurns model, it never resurrects a "synthetic turn".
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}]
	}});

	// Mid-run re-attach replay: deltas arrive without any turn context.
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '接续'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '思考'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', id: 'tool_x', tool: 'shell', args: {command: 'ls'}}});

	assert.equal(assistantText(state), '旧回答', 'restored turn stays frozen');
	assert.equal(thinking(state), '', 'restored turn gains no thinking');
	assert.equal(tools(state).length, 0, 'restored turn gains no tools');
	assert.equal(bridgeTurnCount(state), 1, 'no ghost turn created for the homeless stream');
	assert.equal(state.orphanEvents.length, 3, 'all three stragglers are recorded as orphans, not resurrected');
});

test('ready with a NEW engineEpoch clears pending interactions and explains why', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'approval_requested', id: 'appr_1', runId: 'run_1', turnId: 'turn_1', tool: 'shell', description: 'x', risk: 'Shell', context: 'rm x'
	}});
	state = reducer(state, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'which?'}});
	assert.equal(approvalsFromState(state).length, 1);
	assert.equal(questionsFromState(state).length, 1);

	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-2'}});

	assert.equal(state.engineEpoch, 'epoch-2');
	assert.equal(approvalsFromState(state).length, 0, 'stale approvals dropped');
	assert.equal(questionsFromState(state).length, 0, 'stale User Questions dropped');
	assert.equal(state.inputMode, 'normal');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(notices.some(text => text.includes('引擎已重启')), 'restart notice in transcript');
});

test('ready with the SAME engineEpoch (session switch) adds no restart notice', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'which?'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});

	assert.equal(questionsFromState(state).length, 1, 'same-epoch ready keeps User Questions');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(!notices.some(text => text.includes('引擎已重启')), 'no restart notice');
});

test('first ready never reports a restart even with pending state', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'early?'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});

	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(!notices.some(text => text.includes('引擎已重启')), 'first epoch observation is not a restart');
	assert.equal(state.engineEpoch, 'epoch-1');
});
