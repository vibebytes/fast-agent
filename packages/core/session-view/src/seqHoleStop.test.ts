/**
 * User symptom: review text is done, trailing caret still streams, Stop stays lit.
 * Cause: CommandLoop settle / persist run_done never reached applyBridgeEvent
 * (Zod drop or seq-hole hold). This file pipes offer → project → composerGate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	applyBridgeEvent,
	composerGate,
	createTranscriptState,
	emptySessionSeq,
	offer
} from './index.js';

function projectThroughOffer(events: BridgeEvent[]) {
	let seq = emptySessionSeq();
	let state = createTranscriptState();
	for (const ev of events) {
		const r = offer(seq, ev);
		seq = r.state;
		for (const out of r.emit) {
			state = applyBridgeEvent(state, out);
		}
	}
	return {state, seq};
}

const reviewPrefix: BridgeEvent[] = [
	{
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	},
	{type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'},
	{type: 'assistant_delta', turnId: 'run-9', text: '审查通过', eventSeq: 1},
	{type: 'turn_started', turnId: 'run-9-turn-1', clientMessageId: 'client-1'}
];

test('offer → project: CommandLoop turn_finished without eventSeq extinguishes Stop across a seq hole', () => {
	const mid = projectThroughOffer(reviewPrefix);
	assert.equal(composerGate(mid.state, true).canCancel, true, 'Stop lit while the review is still streaming');

	const {state} = projectThroughOffer([
		...reviewPrefix,
		{type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent
	]);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).canCancel, false, 'Stop must go out after CommandLoop settle');
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('offer → project: persist run_done with a seq hole extinguishes Stop', () => {
	const {state, seq} = projectThroughOffer([
		...reviewPrefix,
		{
			type: 'run_done',
			runId: 'run-9',
			success: true,
			summary: '',
			eventSeq: 3
		} as BridgeEvent
	]);
	assert.equal(seq.lastApplied, 1, 'missing EventRow must not advance the cursor');
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).canCancel, false, 'Stop must go out even when seq 2 never arrives');
});

/** DSH/ReAct river after 31167e83: TurnStarted occupies Fast seq and is stamped on the wire. */
const dshLiveThenRiver: BridgeEvent[] = [
	{
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '你是谁'
	},
	{type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'},
	{type: 'thinking_started', turn: 1, maxTurns: 50},
	{type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1},
	{type: 'assistant_delta', turnId: 'run-9', text: '我是 Fast。', eventSeq: 2, unitId: '1:1'},
	{type: 'checkpoint', unitId: '1:1', content: '我是 Fast。', eventSeq: 3},
	{
		type: 'run_done',
		runId: 'run-9',
		success: true,
		summary: '',
		eventSeq: 4
	},
	{type: 'turn_finished', turnId: 'run-9', success: true}
];

test('offer → project: sequenced river TurnStarted + checkpoint + run_done extinguishes Stop', () => {
	const {state, seq} = projectThroughOffer(dshLiveThenRiver);
	assert.equal(seq.lastApplied, 4);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, '我是 Fast。');
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('offer → project: late sequenced TurnStarted after settle must not relight Stop', () => {
	const {state} = projectThroughOffer([
		...dshLiveThenRiver,
		// Attach replay / delayed persist row — empty river opener, already applied as seq 1.
		{type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1},
		// Cursor still 0 when live chrome never advanced (hole at start): seq 1 is new.
		{type: 'turn_started', turnId: 'run-9', text: ''}
	]);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'empty persist TurnStarted must not spawn a new streaming row after the message ended'
	);
	assert.equal(composerGate(state, true).canCancel, false, 'composer Stop must stay off');
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('offer → project: attach replay of empty TurnStarted after settle while lastApplied is 0', () => {
	const {state} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 'client-1',
			clientMessageId: 'client-1',
			text: '你是谁'
		},
		{type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'},
		{type: 'assistant_delta', turnId: 'run-9', text: '我是 Fast。', eventSeq: 2},
		{type: 'turn_finished', turnId: 'run-9', success: true},
		{type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1}
	]);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('offer → project: consecutive turn_finished still paints held suffix', () => {
	const {state} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 't1',
			clientMessageId: 't1',
			text: 'review'
		},
		{type: 'assistant_delta', turnId: 't1', text: 'keep', eventSeq: 1},
		{type: 'assistant_delta', turnId: 't1', text: ' more', eventSeq: 3},
		{type: 'assistant_delta', turnId: 't1', text: ' text', eventSeq: 4},
		{type: 'turn_finished', turnId: 't1', success: true, eventSeq: 2}
	]);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, 'keep more text');
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
});

test('offer → project: held final_answer wins over mid-document deltas', () => {
	const {state} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 't1',
			clientMessageId: 't1',
			text: 'review'
		},
		{type: 'assistant_delta', turnId: 't1', text: 'mid-only', eventSeq: 5},
		{
			type: 'final_answer',
			turnId: 't1',
			text: 'full document body',
			eventSeq: 6
		},
		{type: 'turn_finished', turnId: 't1', success: true}
	]);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, 'full document body');
});

test('offer → project: PR9-like tool chain + held body flushes on turn_finished', () => {
	const tools: BridgeEvent[] = [];
	for (let i = 0; i < 18; i++) {
		tools.push({
			type: 'tool_started',
			id: `tc-${i}`,
			tool: 'read_file',
			args: {path: `/tmp/${i}.md`},
			eventSeq: 100 + i
		} as BridgeEvent);
		tools.push({
			type: 'tool_finished',
			id: `tc-${i}`,
			tool: 'read_file',
			success: true,
			eventSeq: 200 + i
		} as BridgeEvent);
	}
	const {state, seq} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 'client-1',
			clientMessageId: 'client-1',
			text: 'review PR9 Wave2'
		},
		{type: 'input_accepted', turnId: 'run-9', clientMessageId: 'client-1'},
		...tools,
		{type: 'seq_skip', eventSeq: 311} as BridgeEvent,
		{
			type: 'assistant_delta',
			turnId: 'run-9',
			text: '# PR9 + Wave 2',
			eventSeq: 320
		},
		{
			type: 'assistant_delta',
			turnId: 'run-9',
			text: ' review body',
			eventSeq: 321
		},
		{type: 'turn_finished', turnId: 'run-9', success: true}
	]);
	assert.equal(
		state.entries.find(e => e.role === 'assistant')?.text,
		'# PR9 + Wave 2 review body'
	);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
	assert.equal(seq.lastApplied, 321);
	assert.equal(composerGate(state, true).canCancel, false);
});

test('offer → project: dirty cursor still paints 定位到了 after settle', () => {
	const {state} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 'client-1',
			clientMessageId: 'client-1',
			text: '问题定位到了吗'
		},
		{type: 'input_accepted', turnId: 'run-q', clientMessageId: 'client-1'},
		{type: 'reasoning_delta', turnId: 'run-q', text: 'look', eventSeq: 1987},
		{type: 'assistant_delta', turnId: 'run-q', text: '定位到了', eventSeq: 2005},
		{type: 'assistant_delta', turnId: 'run-q', text: '：闸门在 settle 未 flush', eventSeq: 2006},
		{type: 'turn_finished', turnId: 'run-q', success: true}
	]);
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.match(assistant?.text ?? '', /定位到了/);
	assert.equal(assistant?.status, 'done');
	assert.ok(assistant?.reasoning?.includes('look'));
});

test('offer → project: run-1 flush must not write onto a live run-2 row', () => {
	const {state} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 'run-1',
			clientMessageId: 'client-1',
			text: 'first'
		},
		{type: 'assistant_delta', turnId: 'run-1', text: 'r1-a', eventSeq: 1},
		{type: 'assistant_delta', turnId: 'run-1', text: 'r1-held', eventSeq: 3},
		{
			type: 'turn_started',
			turnId: 'run-2',
			clientMessageId: 'client-2',
			text: 'second'
		},
		{type: 'assistant_delta', turnId: 'run-2', text: 'r2-live'} as BridgeEvent,
		{type: 'turn_finished', turnId: 'run-1', success: true}
	]);
	assert.equal(state.entries.find(e => e.turnId === 'run-1' && e.role === 'assistant')?.text, 'r1-ar1-held');
	assert.equal(state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant')?.text, 'r2-live');
	assert.equal(state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant')?.status, 'streaming');
});

test('offer → project: cancel must not flush held prose onto the cancelled row', () => {
	const {state, seq} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 'run-9',
			clientMessageId: 'client-1',
			text: 'stop me'
		},
		{type: 'assistant_delta', turnId: 'run-9', text: 'start', eventSeq: 1},
		{type: 'assistant_delta', turnId: 'run-9', text: 'held body', eventSeq: 3},
		{type: 'turn_cancelled', turnId: 'run-9', reason: 'user cancel'}
	]);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, 'start');
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'cancelled');
	assert.equal(seq.lastApplied, 1);
	assert.equal(composerGate(state, true).canCancel, false);
});

test('offer → project: after one hole the next turn still paints live prose', () => {
	const {state, seq} = projectThroughOffer([
		{
			type: 'turn_started',
			turnId: 't1',
			clientMessageId: 't1',
			text: 'first'
		},
		{type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 1},
		{type: 'assistant_delta', turnId: 't1', text: 'skipped', eventSeq: 3},
		{type: 'turn_finished', turnId: 't1', success: true},
		{
			type: 'turn_started',
			turnId: 't2',
			clientMessageId: 't2',
			text: 'second'
		},
		{type: 'assistant_delta', turnId: 't2', text: 'second live body', eventSeq: 10}
	]);
	assert.equal(seq.lastApplied, 10);
	assert.equal(
		state.entries.find(e => e.role === 'assistant' && e.turnId === 't2')?.text,
		'second live body'
	);
});

test('offer → project: cold session_restored then high-seq live delta paints', () => {
	const {state, seq} = projectThroughOffer([
		{
			type: 'session_restored',
			sessionId: 'sess-sticky',
			turns: [
				{
					turnId: 'old',
					userText: 'prior',
					assistantText: 'already on disk'
				}
			],
			hasMoreOlder: false,
			totalTurnCount: 1
		} as BridgeEvent,
		{
			type: 'turn_started',
			turnId: 't-new',
			clientMessageId: 't-new',
			text: '我们不讨论实施，只讨论哪个方案更好'
		},
		{
			type: 'assistant_delta',
			turnId: 't-new',
			text: '方案 A 更好。',
			eventSeq: 94
		}
	]);
	assert.equal(seq.lastApplied, 94);
	assert.equal(
		state.entries.find(e => e.role === 'assistant' && e.turnId === 't-new')?.text,
		'方案 A 更好。'
	);
});

test('offer → project: settled restore + persist opener with user text stays idle', () => {
	const {state} = projectThroughOffer([
		{
			type: 'session_restored',
			sessionId: 'sess-ended',
			turns: [
				{
					turnId: 'restored_0',
					userText: '继续完成啊',
					assistantText: '剩余 3 项 [~] 及原因'
				}
			],
			hasMoreOlder: false,
			totalTurnCount: 1
		} as BridgeEvent,
		{
			type: 'input_accepted',
			turnId: 'run-9',
			clientMessageId: 'client-old',
			eventSeq: 79
		} as BridgeEvent,
		{
			type: 'turn_started',
			turnId: 'run-9',
			clientMessageId: 'client-old',
			text: '继续完成啊',
			eventSeq: 80
		} as BridgeEvent,
		{type: 'assistant_delta', turnId: 'run-9', text: '剩余 3 项 [~] 及原因', eventSeq: 94}
	]);
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.activeRunId, undefined);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('offer → project: cold session_restored then persist TurnStarted stays idle', () => {
	const {state} = projectThroughOffer([
		{
			type: 'session_restored',
			sessionId: 'sess-cold',
			turns: [
				{
					turnId: 'restored_0',
					userText: 'review 下这个开发计划',
					assistantText: '## Findings\n总结：计划可落地。'
				}
			],
			hasMoreOlder: false,
			totalTurnCount: 1
		} as BridgeEvent,
		{type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1} as BridgeEvent,
		{type: 'turn_started', turnId: 'run-9', text: ''} as BridgeEvent
	]);
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.activeRunId, undefined);
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});
