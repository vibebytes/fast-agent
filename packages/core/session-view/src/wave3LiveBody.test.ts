/**
 * Wave3 review turn (session 「L1/L2扩展层设计」, run 01a02a9f-…):
 * tool + approval + second persist TurnStarted + thinking + streamed body.
 * User symptom: live shows thinking + tools, no reply body. Persist has the review.
 *
 * Desktop seam: offer(..., {terminal: seqTerminal(transcript)}) → applyBridgeEvent
 * → toTimelineItems. Persist river events have eventSeq; CommandLoop chrome does not.
 * streamRun render is a different thread, so persist deltas often have no turnId.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	applyBridgeEvent,
	createTranscriptState,
	emptySessionSeq,
	offer,
	seqTerminal,
	toTimelineItems,
	type SessionSeq,
	type TranscriptState
} from './index.js';

const RUN = '01a02a9f-98d2-7e4d-bd70-48905d5660bb';
const CMID = 'e7803bb4-76cc-4de2-92ef-405b5e04bf88';
const TOOL = 'bbef9c1c-1ca1-4bec-8ea8-b4f23ab3bb46';
const BODY = '这份计划整体质量很高——A/B/C 台阶划分、依赖图到位。**可以按它开 A**。';
const THINK = 'The user asks me to review the wave3 plan.';

function projectAsDesktop(events: BridgeEvent[], start?: SessionSeq) {
	let seq = start ?? {...emptySessionSeq(), lastApplied: 39303};
	let state = createTranscriptState();
	for (const ev of events) {
		const r = offer(seq, ev, {terminal: seqTerminal(state)});
		seq = r.state;
		for (const out of r.emit) state = applyBridgeEvent(state, out);
	}
	return {state, seq};
}

function liveOpeners(): BridgeEvent[] {
	return [
		{type: 'turn_started', turnId: CMID, clientMessageId: CMID, text: 'review 开发计划'},
		{type: 'thinking_started', turn: 1, maxTurns: 50},
		{type: 'input_accepted', turnId: RUN, clientMessageId: CMID}
	];
}

/** Persist mapping from SessionEventStream.render — turnId omitted (poll-thread TLS). */
function persistToolApproval(from = 39304): BridgeEvent[] {
	return [
		{type: 'seq_skip', eventSeq: from} as BridgeEvent,
		{type: 'turn_started', turnId: RUN, clientMessageId: CMID, text: '', eventSeq: from + 1},
		{type: 'llm_network_wait', runId: RUN, phase: 'waiting', eventSeq: from + 2},
		{type: 'llm_network_wait', runId: RUN, phase: 'cleared', eventSeq: from + 3},
		{type: 'seq_skip', eventSeq: from + 4} as BridgeEvent,
		{
			type: 'tool_started',
			id: TOOL,
			tool: 'read_file',
			args: {path: join(homedir(), '.cursor', 'plans', 'wave3_abc_test_plan_5e9b96cd.plan.md')},
			eventSeq: from + 5
		} as BridgeEvent,
		{
			type: 'approval_requested',
			id: TOOL,
			runId: RUN,
			tool: 'read_file',
			description: 'read plan',
			eventSeq: from + 6
		},
		{type: 'approval_resolved', id: TOOL, runId: RUN, approved: true, eventSeq: from + 7},
		{type: 'tool_output', id: TOOL, tool: 'read_file', stream: 'stdout', text: '# plan', eventSeq: from + 8},
		{
			type: 'tool_finished',
			id: TOOL,
			tool: 'read_file',
			success: true,
			eventSeq: from + 9
		} as BridgeEvent,
		{type: 'turn_started', turnId: RUN, clientMessageId: CMID, text: '', eventSeq: from + 10}
	];
}

function persistThinkBody(from = 39315): BridgeEvent[] {
	return [
		{type: 'llm_network_wait', runId: RUN, phase: 'waiting', eventSeq: from},
		{type: 'llm_network_wait', runId: RUN, phase: 'cleared', eventSeq: from + 1},
		{type: 'reasoning_delta', text: THINK, eventSeq: from + 2},
		{type: 'assistant_delta', text: BODY.slice(0, 12), eventSeq: from + 3},
		{type: 'assistant_delta', text: BODY.slice(12), eventSeq: from + 4},
		{type: 'final_answer', text: BODY, eventSeq: from + 5},
		{type: 'final_answer', text: BODY, eventSeq: from + 6},
		{type: 'run_done', runId: RUN, success: true, summary: '', eventSeq: from + 7} as BridgeEvent
	];
}

function assistantRows(state: TranscriptState) {
	return state.entries.filter(e => e.role === 'assistant');
}

function timelineAssistants(state: TranscriptState) {
	return toTimelineItems(state).filter(i => i.kind === 'assistant');
}

function timelineBody(state: TranscriptState) {
	return timelineAssistants(state)
		.map(i => (i.kind === 'assistant' ? i.text : ''))
		.join('');
}

test('wave3 in-order persist: timeline must show the review body', () => {
	const {state} = projectAsDesktop([
		...liveOpeners(),
		...persistToolApproval(),
		...persistThinkBody(),
		{type: 'turn_finished', turnId: RUN, success: true}
	]);
	assert.match(timelineBody(state), /这份计划整体质量很高/, inspect(state));
	assert.equal(state.postRunTerminal, true);
});

test('wave3: approval + second TurnStarted must not leave the visible card body-empty', () => {
	const {state} = projectAsDesktop([
		...liveOpeners(),
		...persistToolApproval(),
		...persistThinkBody()
	]);
	const rows = assistantRows(state);
	assert.equal(rows.length, 1, `one ReAct card, not a tools card plus an empty follow-up\n${inspect(state)}`);
	assert.ok((rows[0]?.tools ?? []).some(t => t.tool === 'read_file'), inspect(state));
	assert.match(rows[0]?.text ?? '', /这份计划整体质量很高/, inspect(state));
});

test('wave3: thinking in-order, hole before body, settle — user sees thought+tools+body', () => {
	// Rocks is contiguous, but the client cursor can sit behind (cancelled-run
	// hole / dropped seq_skip). Persist deltas have no turnId (poll-thread TLS).
	// Previous SETTLE_FLUSH required a matching turnId, so the body stayed held.
	const {state} = projectAsDesktop([
		...liveOpeners(),
		...persistToolApproval(),
		{type: 'llm_network_wait', runId: RUN, phase: 'waiting', eventSeq: 39315},
		{type: 'llm_network_wait', runId: RUN, phase: 'cleared', eventSeq: 39316},
		{type: 'reasoning_delta', text: THINK, eventSeq: 39317},
		{type: 'turn_finished', turnId: RUN, success: true},
		{type: 'assistant_delta', text: BODY.slice(0, 12), eventSeq: 39521},
		{type: 'assistant_delta', text: BODY.slice(12), eventSeq: 39522},
		{type: 'final_answer', text: BODY, eventSeq: 39551}
	]);
	const rows = assistantRows(state);
	assert.equal(rows.length, 1, `ReAct step 2 must resume the approval-sealed card\n${inspect(state)}`);
	assert.ok((rows[0]?.reasoning ?? '').includes('The user asks'), inspect(state));
	assert.ok((rows[0]?.tools ?? []).some(t => t.tool === 'read_file'), inspect(state));
	assert.match(timelineBody(state), /这份计划整体质量很高/, inspect(state));
});

test('wave3: session_restored after settle must not wipe a painted body', () => {
	const painted = projectAsDesktop([
		...liveOpeners(),
		...persistToolApproval(),
		...persistThinkBody(),
		{type: 'turn_finished', turnId: RUN, success: true}
	]);
	assert.match(timelineBody(painted.state), /这份计划整体质量很高/, 'precondition: live painted');

	const restore = {
		type: 'session_restored',
		sessionId: 's1',
		turns: [
			{
				turnId: CMID,
				userText: 'review 开发计划',
				assistantText: '',
				thinking: THINK,
				tools: [{id: TOOL, tool: 'read_file', status: 'success', args: {}}],
				steps: [{tools: [{id: TOOL, tool: 'read_file', status: 'success'}], reasoning: THINK}]
			}
		]
	} as BridgeEvent;
	const r = offer(painted.seq, restore, {terminal: seqTerminal(painted.state)});
	let next = painted.state;
	for (const out of r.emit) next = applyBridgeEvent(next, out);
	assert.match(timelineBody(next), /这份计划整体质量很高/, inspect(next));
});

function inspect(state: TranscriptState): string {
	const rows = assistantRows(state).map(e => ({
		id: e.id,
		status: e.status,
		turnId: e.turnId,
		cmid: e.clientMessageId,
		text: e.text.slice(0, 80),
		reasoning: (e.reasoning ?? '').slice(0, 40),
		tools: (e.tools ?? []).map(t => t.tool),
		segs: (e.segments ?? []).map(s => s.kind)
	}));
	const tl = toTimelineItems(state).map(i =>
		i.kind === 'assistant' ? `assistant:${i.text.slice(0, 40)}` : i.kind
	);
	return JSON.stringify({rows, tl, post: state.postRunTerminal}, null, 2);
}
