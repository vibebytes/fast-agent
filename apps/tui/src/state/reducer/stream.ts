/** reducer.test — applyEvent stream / tools / compaction. Loaded by reducer.test.ts. */
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

test('reducer appends user and streaming assistant messages', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'hi '}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'there'}});

	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'hello');
	assert.equal(assistantText(state), 'hi there');
});

test('reducer surfaces a compaction result as a system line; plain window trims stay quiet', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'hi'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'context_compacting', runId: 'turn_1', trigger: 'threshold', tokensBefore: 120_000}});
	assert.equal(state.transcript.compacting?.runId, 'turn_1');
	const before = lastLocalTurn(state)?.systemMessages.length ?? 0;
	state = reducer(state, {type: 'engine_event', event: {
		type: 'context_pruned', runId: 'turn_1', prunedIds: [], reason: 'summary', remainingTokens: 48_000, durationMs: 30_000
	}});
	assert.equal(state.transcript.compacting, undefined);
	const line = lastLocalTurn(state)?.systemMessages.at(-1);
	assert.equal(line?.role, 'system');
	assert.equal(line?.text, '历史上下文已压缩为摘要（120k → 48k）');
	// A bare window trim (no compaction reason) adds nothing.
	state = reducer(state, {type: 'engine_event', event: {type: 'context_pruned', runId: 'turn_1', prunedIds: ['m1'], reason: 'window'}});
	assert.equal(lastLocalTurn(state)?.systemMessages.length, (before || 0) + 1);
	// A replayed copy of an already-applied prune (same eventSeq) does not add a second line.
	state = reducer(state, {type: 'engine_event', event: {type: 'context_pruned', runId: 'turn_1', prunedIds: [], reason: 'summary', eventSeq: 7}});
	const afterFirst = lastLocalTurn(state)?.systemMessages.length ?? 0;
	state = reducer(state, {type: 'engine_event', event: {type: 'context_pruned', runId: 'turn_1', prunedIds: [], reason: 'summary', eventSeq: 7}});
	assert.equal(lastLocalTurn(state)?.systemMessages.length, afterFirst);
});

test('reducer captures llm_request snapshots', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'llm_request',
		turnId: 'turn_1',
		turn: 1,
		messages: [
			{role: 'system', content: 'you are an agent'},
			{role: 'user', content: 'hello'}
		]
	}});

	assert.equal(state.llmRequests.length, 1);
	assert.equal(state.llmRequests[0]?.messages.length, 2);
	assert.equal(state.llmRequests[0]?.turn, 1);
});

test('reducer records interleaved segments in arrival order', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'build it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_1', text: 'planning'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_2', tool: 'shell', args: {command: 'cat x'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'done'}});

	const segs = segments(state);
	assert.deepEqual(segs.map(segment => segment.kind), ['thinking', 'tools', 'assistant']);
	const toolsSegment = segs.find(segment => segment.kind === 'tools');
	assert.equal(toolsSegment?.kind === 'tools' ? toolsSegment.toolIds.length : 0, 2);
});

// NB: clarify's system message now lands on `localTurns` (never on the Bridge
// transcript entry's segments — `EntrySegment` has no 'system' kind), so the
// old "assistant text then system message in the same turn" ordering test no
// longer applies; see the clarify-specific tests below instead.

test('reducer uses final answer when no stream delta exists', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: 'final'}});

	assert.equal(assistantText(state), 'final');
});

test('reducer ignores a full-answer AssistantDelta that re-emits already streamed text', () => {
	// Engine bug: native mode streams Content as AssistantDelta, then onFinalAnswer
	// used to emit the whole answer again as AssistantDelta before FinalAnswer —
	// which doubled the text and splitStableChunks painted two identical ✦ blocks.
	const answer = `当前工作目录：\n\n\`\`\`\n${join(homedir(), 'path')}\n\`\`\``;
	let state = reducer(initialState, {type: 'submit_user', text: 'pwd', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(assistantText(state), answer);
	assert.equal(
		(assistantText(state).match(/当前工作目录/g) ?? []).length,
		1,
		'full answer must not be concatenated twice'
	);
	const assistants = turnsToTimeline(state).items.filter(item => item.kind === 'assistant_message');
	assert.equal(
		assistants.filter(item => item.text.includes('当前工作目录')).length,
		1,
		`expected one lead-in assistant block, got: ${JSON.stringify(assistants.map(a => a.text))}`
	);
});

test('AssistantMessage-seeded final_answer after deltas stays one assistant block', () => {
	const answer = '审查结论：计划可落地。';
	let state = reducer(initialState, {type: 'submit_user', text: 'review', clientMessageId: 'client_1'});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'final_answer', turnId: 'turn_1', text: answer}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'turn_finished', turnId: 'turn_1', success: true}
	});
	assert.equal(assistantText(state), answer);
	const assistants = turnsToTimeline(state).items.filter(item => item.kind === 'assistant_message');
	assert.equal(assistants.filter(item => item.text.includes('审查结论')).length, 1);
});

test('protocol anomaly: out-of-order tool output before tool_started does not crash state', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_output', turnId: 'turn_1', id: 'tool_1', tool: 'shell', stream: 'stdout', text: 'out-of-order'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'echo hello'}}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {exit: '0'}}
	});

	assert.equal(tools(state).length, 1);
	assert.equal(tools(state)[0]?.status, 'success');
	assert.equal(tools(state)[0]?.output, '', 'output that preceded tool_started is lost, not resurrected');
});

// ── Approval flow ─────────────────────────────────────────────────

test('agent_final_answer sets assistantText when no stream delta exists', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'build', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'agent_final_answer', turnId: 'turn_1', text: 'agent done'}});

	assert.equal(assistantText(state), 'agent done');
});

test('tool_started stamps startedAt for the live elapsed display', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	const before = Date.now();
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'sleep 5'}}});

	const startedAt = tools(state)[0]?.startedAt;
	assert.ok(startedAt !== undefined && startedAt >= before && startedAt <= Date.now());
});

test('turn_finished resolves orphan running tools', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});

	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_2', tool: 'read_file', args: {path: 'a.txt'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {}}});

	assert.equal(tools(state)[0]?.status, 'success');
	assert.equal(tools(state)[1]?.status, 'running');

	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(tools(state)[0]?.status, 'success', 'already-finished tool stays success');
	assert.equal(tools(state)[1]?.status, 'success', 'orphan running tool resolved to success');
	assert.equal(state.running, false);
});
