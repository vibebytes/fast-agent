/**
 * Session 「定位 fast -> 设置 ->执行引擎 设置Ui的代码位置」
 * (01a02e33-e37f-73b1-8263-2097f74572d1), first visible turn.
 *
 * Same document-slot miss as Wave3 / settle-before-body: persist prose must
 * land on this run’s card, not a cancelled opener or a split ReAct row.
 * Rocks: cancelled opener (seq 1–3, ~2s) then explore ReAct (6× TurnStarted,
 * grep/list/read, no approval) and persist body 「已定位。…」 (seq 72–85).
 *
 * Desktop seam: offer(..., {terminal: seqTerminal(transcript)}) → applyBridgeEvent
 * → toTimelineItems. Persist deltas have no turnId (poll-thread TLS).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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

const RUN1 = '01a02e34-864e-7e6a-9ade-628b5c282713';
const CMID1 = '51bc8282-8248-47a7-8cbe-90b39713cdc3';
const RUN2 = '01a02e34-bdfb-7fa8-8f47-095397118b41';
const CMID2 = '2bdd53db-f8cd-4bf7-8c8a-58303976591b';
const BODY = '已定位。「fast → 设置 → 执行引擎」页面的代码链路如下';
const USER = '定位 fast -> 设置 ->执行引擎 设置Ui的代码位置';

function projectAsDesktop(events: BridgeEvent[], start?: SessionSeq) {
	let seq = start ?? emptySessionSeq();
	let state = createTranscriptState();
	for (const ev of events) {
		const r = offer(seq, ev, {terminal: seqTerminal(state)});
		seq = r.state;
		for (const out of r.emit) state = applyBridgeEvent(state, out);
	}
	return {state, seq};
}

function timelineBody(state: TranscriptState): string {
	return toTimelineItems(state)
		.filter(i => i.kind === 'assistant')
		.map(i => (i.kind === 'assistant' ? i.text : ''))
		.join('');
}

function inspect(state: TranscriptState): string {
	const rows = state.entries
		.filter(e => e.role === 'assistant')
		.map(e => ({
			id: e.id,
			status: e.status,
			turnId: e.turnId,
			cmid: e.clientMessageId,
			text: e.text.slice(0, 80),
			tools: (e.tools ?? []).map(t => t.tool),
			segs: (e.segments ?? []).map(s => s.kind)
		}));
	const tl = toTimelineItems(state).map(i => {
		if (i.kind === 'assistant') return `assistant:${i.text.slice(0, 40)}`;
		if (i.kind === 'processStack') return `processStack:${i.stepCount}`;
		return i.kind;
	});
	return JSON.stringify({rows, tl, post: state.postRunTerminal}, null, 2);
}

function cancelledOpener(): BridgeEvent[] {
	return [
		{type: 'turn_started', turnId: CMID1, clientMessageId: CMID1, text: USER},
		{type: 'input_accepted', turnId: RUN1, clientMessageId: CMID1},
		{type: 'seq_skip', eventSeq: 1} as BridgeEvent,
		{type: 'turn_started', turnId: RUN1, clientMessageId: CMID1, text: '', eventSeq: 2},
		{type: 'turn_cancelled', turnId: RUN1, reason: 'user cancel'},
		{type: 'run_cancelled', runId: RUN1, reason: 'user cancel', eventSeq: 3}
	];
}

function liveSecondSubmit(): BridgeEvent[] {
	return [
		{type: 'turn_started', turnId: CMID2, clientMessageId: CMID2, text: USER},
		{type: 'thinking_started', turn: 1, maxTurns: 50},
		{type: 'input_accepted', turnId: RUN2, clientMessageId: CMID2}
	];
}

function persistExplore(from = 4): BridgeEvent[] {
	const tools = [
		{id: 't-list', tool: 'list_dir'},
		{id: 't-grep1', tool: 'grep'},
		{id: 't-grep2', tool: 'grep'},
		{id: 't-read1', tool: 'read_file'},
		{id: 't-grep3', tool: 'grep'},
		{id: 't-glob', tool: 'glob'},
		{id: 't-read2', tool: 'read_file'},
		{id: 't-grep4', tool: 'grep'},
		{id: 't-grep5', tool: 'grep'}
	];
	const events: BridgeEvent[] = [
		{type: 'seq_skip', eventSeq: from} as BridgeEvent,
		{type: 'turn_started', turnId: RUN2, clientMessageId: CMID2, text: '', eventSeq: from + 1},
		{type: 'reasoning_delta', text: 'Search the workspace for 执行引擎.', eventSeq: from + 4}
	];
	let seq = from + 5;
	for (const t of tools) {
		events.push({
			type: 'tool_started',
			id: t.id,
			tool: t.tool,
			args: {q: t.tool},
			eventSeq: seq++
		} as BridgeEvent);
		events.push({
			type: 'tool_finished',
			id: t.id,
			tool: t.tool,
			success: true,
			eventSeq: seq++
		} as BridgeEvent);
	}
	for (let i = 0; i < 5; i++) {
		events.push({
			type: 'turn_started',
			turnId: RUN2,
			clientMessageId: CMID2,
			text: '',
			eventSeq: seq++
		});
	}
	return events;
}

function persistBody(from = 72): BridgeEvent[] {
	return [
		{type: 'assistant_delta', text: BODY.slice(0, 12), eventSeq: from},
		{type: 'assistant_delta', text: BODY.slice(12), eventSeq: from + 1},
		{type: 'final_answer', text: BODY, eventSeq: from + 13},
		{type: 'run_done', runId: RUN2, success: true, summary: '', eventSeq: from + 14} as BridgeEvent
	];
}

test('explore session: cancelled opener + 6 ReAct turns — timeline shows 已定位', () => {
	const {state} = projectAsDesktop([
		...cancelledOpener(),
		...liveSecondSubmit(),
		...persistExplore(),
		...persistBody(),
		{type: 'turn_finished', turnId: RUN2, success: true}
	]);
	assert.match(timelineBody(state), /已定位/, inspect(state));
});

test('explore session: hole after cancelled TurnStarted (seq 3 missing) still shows body', () => {
	// Real session: persist 1=RunCreated, 2=TurnStarted(run1), 3=RunCancelled.
	// If RunCancelled is late, lastTurnId stays run1 while run2 persist is live-chrome
	// (does not commit). bindHeld then stamps run1 onto no-turnId body deltas.
	const {state} = projectAsDesktop([
		{type: 'turn_started', turnId: CMID1, clientMessageId: CMID1, text: USER},
		{type: 'input_accepted', turnId: RUN1, clientMessageId: CMID1},
		{type: 'seq_skip', eventSeq: 1} as BridgeEvent,
		{type: 'turn_started', turnId: RUN1, clientMessageId: CMID1, text: '', eventSeq: 2},
		{type: 'turn_cancelled', turnId: RUN1, reason: 'user cancel'},
		...liveSecondSubmit(),
		...persistExplore(),
		...persistBody(),
		{type: 'turn_finished', turnId: RUN2, success: true}
	]);
	assert.match(timelineBody(state), /已定位/, inspect(state));
	assert.equal(
		state.entries.some(e => e.role === 'assistant' && e.turnId === RUN1 && e.text.includes('已定位')),
		false,
		`body must not land on the cancelled opener\n${inspect(state)}`
	);
});

test('explore session: client never saw cancelled persist (lastApplied=0, seq starts at 4)', () => {
	const {state} = projectAsDesktop([
		{type: 'turn_started', turnId: CMID1, clientMessageId: CMID1, text: USER},
		{type: 'input_accepted', turnId: RUN1, clientMessageId: CMID1},
		{type: 'turn_cancelled', turnId: RUN1, reason: 'user cancel'},
		...liveSecondSubmit(),
		...persistExplore(),
		...persistBody(),
		{type: 'turn_finished', turnId: RUN2, success: true}
	]);
	assert.match(timelineBody(state), /已定位/, inspect(state));
});

test('explore session: cancelled persist TurnStarted arrives during the second run', () => {
	const {state} = projectAsDesktop([
		{type: 'turn_started', turnId: CMID1, clientMessageId: CMID1, text: USER},
		{type: 'input_accepted', turnId: RUN1, clientMessageId: CMID1},
		{type: 'turn_cancelled', turnId: RUN1, reason: 'user cancel'},
		...liveSecondSubmit(),
		{type: 'seq_skip', eventSeq: 1} as BridgeEvent,
		{type: 'turn_started', turnId: RUN1, clientMessageId: CMID1, text: '', eventSeq: 2},
		{type: 'run_cancelled', runId: RUN1, reason: 'user cancel', eventSeq: 3},
		...persistExplore(),
		...persistBody(),
		{type: 'turn_finished', turnId: RUN2, success: true}
	]);
	assert.match(timelineBody(state), /已定位/, inspect(state));
});

test('explore session: mid-run restore (thinking+tools, empty body) then persist answer', () => {
	const painted = projectAsDesktop([
		...cancelledOpener(),
		...liveSecondSubmit(),
		...persistExplore()
	]);
	const restore = {
		type: 'session_restored',
		sessionId: '01a02e33-e37f-73b1-8263-2097f74572d1',
		turns: [
			{
				turnId: CMID2,
				userText: USER,
				assistantText: '',
				thinking: 'Search the workspace for 执行引擎.',
				tools: [{id: 't-grep1', tool: 'grep', status: 'success', args: {}}],
				steps: [{reasoning: 'Search the workspace for 执行引擎.', tools: [{id: 't-grep1'}]}]
			}
		]
	} as BridgeEvent;
	const r = offer(painted.seq, restore, {terminal: seqTerminal(painted.state)});
	let next = painted.state;
	for (const out of r.emit) next = applyBridgeEvent(next, out);
	let seq = r.state;
	for (const ev of [...persistBody(), {type: 'turn_finished', turnId: RUN2, success: true} as BridgeEvent]) {
		const o = offer(seq, ev, {terminal: seqTerminal(next)});
		seq = o.state;
		for (const out of o.emit) next = applyBridgeEvent(next, out);
	}
	assert.match(timelineBody(next), /已定位/, inspect(next));
});

test('explore session: settle before persist body — process stack + reply', () => {
	const {state} = projectAsDesktop([
		...cancelledOpener(),
		...liveSecondSubmit(),
		...persistExplore(),
		{type: 'turn_finished', turnId: RUN2, success: true},
		...persistBody()
	]);
	const kinds = toTimelineItems(state)
		.filter(i => i.kind !== 'user')
		.map(i => i.kind);
	assert.ok(
		kinds.includes('processStack') || kinds.includes('exploring'),
		`expected explore chrome, got ${kinds.join(',')}\n${inspect(state)}`
	);
	assert.match(timelineBody(state), /已定位/, inspect(state));
});
