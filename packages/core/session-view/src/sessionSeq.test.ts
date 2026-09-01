import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {emptySessionSeq, offer, seqTerminal} from './sessionSeq.js';

function delta(seq: number, text: string, unitId = '1:1'): BridgeEvent {
	return {type: 'assistant_delta', text, eventSeq: seq, unitId};
}

function checkpoint(seq: number, content: string, unitId = '1:1'): BridgeEvent {
	return {type: 'checkpoint', unitId, content, eventSeq: seq};
}

function texts(events: BridgeEvent[]): string[] {
	return events.flatMap(e => {
		if (e.type === 'assistant_delta' || e.type === 'reasoning_delta') return [e.text];
		if (e.type === 'final_answer') return [`fa:${e.text}`];
		if (e.type === 'checkpoint') return [`ck:${e.content}`];
		if (e.type === 'gap') return [`gap:${e.floor}`];
		if (e.type === 'turn_finished' || e.type === 'turn_cancelled') return [e.type];
		return [];
	});
}

test('1,2,3 emit in order and cursor is 3', () => {
	let s = emptySessionSeq();
	const out: BridgeEvent[] = [];
	for (const ev of [delta(1, 'a'), delta(2, 'b'), delta(3, 'c')]) {
		const r = offer(s, ev);
		s = r.state;
		out.push(...r.emit);
	}
	assert.deepEqual(texts(out), ['a', 'b', 'c']);
	assert.equal(s.lastApplied, 3);
	assert.equal(s.syncing, false);
});

test('1,3,2 holds the hole; drain is a,b,c', () => {
	let s = emptySessionSeq();
	const a = offer(s, delta(1, 'a'));
	s = a.state;
	const late = offer(s, delta(3, 'c'));
	s = late.state;
	assert.deepEqual(texts(late.emit), []);
	assert.equal(s.lastApplied, 1);
	assert.equal(s.syncing, true);
	assert.equal(late.resync, true);
	const b = offer(s, delta(2, 'b'));
	assert.deepEqual(texts([...a.emit, ...late.emit, ...b.emit]), ['a', 'b', 'c']);
	assert.equal(b.state.lastApplied, 3);
});

test('duplicate seq emits once', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	const first = offer(s, delta(2, 'b'));
	s = first.state;
	const dup = offer(s, delta(2, 'b'));
	assert.deepEqual(texts(first.emit), ['b']);
	assert.deepEqual(texts(dup.emit), []);
	assert.equal(dup.state.lastApplied, 2);
});

test('live UI and gap do not advance the cursor', () => {
	const live = offer(emptySessionSeq(), {type: 'proc_updated', procId: 'p', status: 'running'});
	assert.equal(live.state.lastApplied, 0);
	assert.deepEqual(live.emit.map(e => e.type), ['proc_updated']);
	const thinking = offer(emptySessionSeq(), {type: 'thinking_started', turn: 1, maxTurns: 50});
	assert.equal(thinking.state.lastApplied, 0);
	assert.deepEqual(thinking.emit.map(e => e.type), ['thinking_started']);
	const gap = offer(emptySessionSeq(), {type: 'gap', floor: 9}, {terminal: false});
	assert.equal(gap.state.lastApplied, 0);
	assert.deepEqual(texts(gap.emit), ['gap:9']);
	assert.equal(gap.resync, true);
});

test('optimistic turn_started without eventSeq does not advance lastApplied', () => {
	const started = offer(emptySessionSeq(), {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 't1',
		text: 'review this doc'
	});
	assert.deepEqual(started.emit.map(e => e.type), ['turn_started']);
	assert.equal(started.state.lastApplied, 0);
});

test('attach hydrate goal_updated without eventSeq does not advance lastApplied', () => {
	const hydrated = offer(emptySessionSeq(), {
		type: 'goal_updated',
		goalId: 'g1',
		phase: 'finished',
		status: 'passed'
	});
	assert.deepEqual(hydrated.emit.map(e => e.type), ['goal_updated']);
	assert.equal(hydrated.state.lastApplied, 0);
});

test('goal chrome without eventSeq does not advance lastApplied', () => {
	const updated = offer(emptySessionSeq(), {
		type: 'goal_updated',
		goalId: 'g1',
		phase: 'finished',
		status: 'passed',
		eventSeq: 1
	});
	assert.equal(updated.state.lastApplied, 1);
	const chrome = offer(updated.state, {
		type: 'turn_started',
		turnId: 'goal-g1-notice',
		messageType: 'goal_outcome',
		text: ''
	});
	assert.deepEqual(chrome.emit.map(e => e.type), ['turn_started']);
	assert.equal(chrome.state.lastApplied, 1);
	const live = offer(updated.state, {type: 'turn_started', turnId: 't1', text: 'hi'} as BridgeEvent);
	assert.deepEqual(live.emit.map(e => e.type), ['turn_started']);
	assert.equal(live.state.lastApplied, 1);
});

test('checkpoint seals a same-unit hole; late delta is ignored', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	s = offer(s, delta(2, 'b')).state;
	const sealed = offer(s, checkpoint(4, 'abcd'));
	assert.deepEqual(texts(sealed.emit), ['ck:abcd']);
	assert.equal(sealed.state.lastApplied, 4);
	const late = offer(sealed.state, delta(3, 'lost'));
	assert.deepEqual(texts(late.emit), []);
	assert.equal(late.state.lastApplied, 4);
});

test('step1 checkpoint does not drop step2 delta', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'one', '1:1')).state;
	s = offer(s, checkpoint(3, 'one', '1:1')).state;
	const two = offer(s, delta(4, 'two', '1:2'));
	assert.deepEqual(texts(two.emit), ['two']);
	assert.equal(two.state.lastApplied, 4);
});

test('two SessionSeq cursors stay isolated', () => {
	let a = emptySessionSeq();
	let b = emptySessionSeq();
	a = offer(a, delta(1, 'A')).state;
	b = offer(b, delta(1, 'B')).state;
	a = offer(a, delta(3, 'skip')).state;
	assert.equal(a.lastApplied, 1);
	assert.equal(b.lastApplied, 1);
	assert.equal(a.syncing, true);
	assert.equal(b.syncing, false);
});

test('unfilled hole without checkpoint stays syncing', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	const held = offer(s, delta(3, 'c'));
	assert.deepEqual(texts(held.emit), []);
	assert.equal(held.state.syncing, true);
	assert.equal(held.state.lastApplied, 1);
	const again = offer(held.state, {type: 'gap', floor: 5, high: 8}, {terminal: false});
	assert.equal(again.state.syncing, true);
	assert.equal(again.state.lastApplied, 1);
	assert.deepEqual(texts(again.emit), ['gap:5']);
});

test('terminal gap jumps to high and does not mark incomplete', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	s = offer(s, delta(3, 'c')).state;
	const patched = offer(s, {type: 'gap', floor: 9, high: 12}, {terminal: true});
	assert.deepEqual(patched.emit, []);
	assert.equal(patched.state.lastApplied, 12);
	assert.equal(patched.state.syncing, false);
	assert.equal(patched.state.pending.size, 0);
	assert.equal(patched.resync, true);
});

test('seqTerminal is false until an assistant has settled', () => {
	assert.equal(seqTerminal({entries: []}), false);
	assert.equal(seqTerminal({postRunTerminal: true, entries: []}), true);
	assert.equal(seqTerminal({entries: [{role: 'user'}]}), false);
	assert.equal(seqTerminal({entries: [{role: 'assistant', status: 'streaming'}]}), false);
	assert.equal(seqTerminal({entries: [{role: 'assistant', status: 'done'}]}), true);
	assert.equal(
		seqTerminal({
			entries: [
				{role: 'assistant', status: 'done'},
				{role: 'assistant', status: 'streaming'}
			]
		}),
		false
	);
});

test('reasoning_delta 1,3,2 holds then drains in order', () => {
	const think = (seq: number, text: string): BridgeEvent =>
		({type: 'reasoning_delta', text, eventSeq: seq, unitId: '1:1'} as BridgeEvent);
	let s = emptySessionSeq();
	const a = offer(s, think(1, 'a'));
	s = a.state;
	const late = offer(s, think(3, 'c'));
	s = late.state;
	assert.deepEqual(texts(late.emit), []);
	const b = offer(s, think(2, 'b'));
	assert.deepEqual(texts([...a.emit, ...late.emit, ...b.emit]), ['a', 'b', 'c']);
	assert.equal(b.state.lastApplied, 3);
});

test('live gap seals a pending checkpoint once another unit no longer blocks it', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'one', '1:1')).state;
	s = offer(s, delta(3, 'two', '1:2')).state;
	s = offer(s, checkpoint(5, 'one-full', '1:1')).state;
	assert.equal(s.lastApplied, 1);
	assert.equal(s.pending.has(5), true);
	s = offer(s, delta(2, 'x', '1:1')).state;
	assert.equal(s.lastApplied, 3);
	const sealed = offer(s, {type: 'gap', floor: 9, high: 12}, {terminal: false});
	assert.deepEqual(texts(sealed.emit), ['ck:one-full']);
	assert.equal(sealed.state.lastApplied, 5);
	assert.equal(sealed.emit.some(e => e.type === 'gap'), false);
});

test('terminal gap jumps to high even when a checkpoint is pending', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a', '1:1')).state;
	s = offer(s, delta(3, 'x', '1:2')).state;
	s = offer(s, checkpoint(4, 'abcd', '1:1')).state;
	assert.equal(s.pending.has(4), true);
	const patched = offer(s, {type: 'gap', floor: 9, high: 12}, {terminal: true});
	assert.deepEqual(patched.emit, []);
	assert.equal(patched.state.lastApplied, 12);
	assert.equal(patched.state.pending.size, 0);
	assert.equal(patched.resync, true);
});

test('live chrome with a skipped EventRow seq still paints', () => {
	const started = offer(emptySessionSeq(), {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 't1',
		text: 'hi'
	} as BridgeEvent);
	const tool = offer(started.state, {
		type: 'tool_started',
		id: 'tc-1',
		tool: 'read_file',
		args: {path: '/tmp/a.md'},
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(tool.emit.map(e => e.type), ['tool_started']);
	assert.equal(tool.state.lastApplied, 0);
	assert.equal(tool.resync, true);
	const think = offer(tool.state, {type: 'reasoning_delta', text: '…', eventSeq: 5} as BridgeEvent);
	assert.deepEqual(think.emit.map(e => e.type), []);
	assert.equal(think.state.lastApplied, 0);
	assert.equal(think.state.pending.has(5), true);
});

test('approval_requested with a seq hole still paints (no silent waiting_approval)', () => {
	let s = emptySessionSeq();
	s = offer(s, {
		type: 'tool_started',
		id: 'g1',
		tool: 'grep',
		args: {path: '/outside'},
		eventSeq: 1
	} as BridgeEvent).state;
	// Engine skipped a no-op row → next wire seq jumps; must not hold the card.
	const card = offer(s, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-1',
		tool: 'grep',
		description: 'grep outside workspace',
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(card.emit.map(e => e.type), ['approval_requested']);
	assert.equal(card.state.lastApplied, 1);
	assert.equal(card.resync, true);
});

test('JsonCallbacks persist types without eventSeq emit and do not advance lastApplied', () => {
	const started = offer(emptySessionSeq(), {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 't1',
		text: 'review this doc'
	} as BridgeEvent);
	const tool = offer(started.state, {
		type: 'tool_started',
		id: 'tc-1',
		tool: 'read_file',
		args: {path: '/tmp/a.md'}
	} as BridgeEvent);
	assert.deepEqual(tool.emit.map(e => e.type), ['tool_started']);
	assert.equal(tool.state.lastApplied, 0);
	const delta = offer(tool.state, {type: 'assistant_delta', text: 'x'} as BridgeEvent);
	assert.deepEqual(delta.emit.map(e => e.type), ['assistant_delta']);
	assert.equal(delta.state.lastApplied, 0);
	const river = offer(delta.state, {type: 'assistant_delta', text: 'y', eventSeq: 1} as BridgeEvent);
	assert.deepEqual(river.emit.map(e => e.type), ['assistant_delta']);
	assert.equal(river.state.lastApplied, 1);
});

test('seq_skip on the next seq advances lastApplied and is not emitted', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	const skip = offer(s, {type: 'seq_skip', eventSeq: 2} as BridgeEvent);
	assert.deepEqual(skip.emit.map(e => e.type), []);
	assert.equal(skip.state.lastApplied, 2);
	const card = offer(skip.state, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-1',
		tool: 'grep',
		description: 'grep outside workspace',
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(card.emit.map(e => e.type), ['approval_requested']);
	assert.equal(card.state.lastApplied, 3);
	assert.equal(card.emit.some(e => e.type === 'seq_skip'), false);
});

test('drain flushes pending seq_skip without emitting it', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, 'a')).state;
	s = offer(s, {type: 'seq_skip', eventSeq: 3} as BridgeEvent).state;
	assert.equal(s.lastApplied, 1);
	assert.equal(s.pending.has(3), true);
	const filled = offer(s, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-1',
		tool: 'grep',
		description: 'grep outside',
		eventSeq: 2
	} as BridgeEvent);
	assert.equal(filled.state.lastApplied, 3);
	assert.deepEqual(filled.emit.map(e => e.type), ['approval_requested']);
	assert.equal(filled.emit.some(e => e.type === 'seq_skip'), false);
});

test('attach replay of seq_skip matches the live stream (cursor only)', () => {
	const replayed: BridgeEvent[] = [
		delta(1, 'hi'),
		{type: 'seq_skip', eventSeq: 2} as BridgeEvent,
		{
			type: 'approval_requested',
			id: 'ap-1',
			runId: 'run-1',
			tool: 'grep',
			description: 'grep outside',
			eventSeq: 3
		} as BridgeEvent
	];
	let s = emptySessionSeq();
	const out: BridgeEvent[] = [];
	for (const ev of replayed) {
		const r = offer(s, ev);
		s = r.state;
		out.push(...r.emit);
	}
	assert.equal(s.lastApplied, 3);
	assert.deepEqual(out.map(e => e.type), ['assistant_delta', 'approval_requested']);
	assert.equal(out.some(e => e.type === 'seq_skip'), false);
});

test('ordinary persist terminals without eventSeq are dropped', () => {
	const r = offer(emptySessionSeq(), {type: 'final_answer', text: 'hi'} as BridgeEvent);
	assert.deepEqual(r.emit, []);
	assert.equal(r.state.lastApplied, 0);
});

test('CommandLoop turn_finished without eventSeq still emits (Stop must go out)', () => {
	const r = offer(emptySessionSeq(), {type: 'turn_finished', success: true, turnId: 'run-9'} as BridgeEvent);
	assert.deepEqual(r.emit.map(e => e.type), ['turn_finished']);
	assert.equal(r.state.lastApplied, 0);
});

test('subagent_updated with a seq hole after turn_finished still paints', () => {
	let s = emptySessionSeq();
	s = offer(s, {
		type: 'turn_finished',
		success: true,
		turnId: 'run-1',
		eventSeq: 1
	} as BridgeEvent).state;
	const card = offer(s, {
		type: 'subagent_updated',
		sessionId: 'sess-1',
		childSessionId: 'child-1',
		activity: 'inactive',
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(card.emit.map(e => e.type), ['subagent_updated']);
	assert.equal(card.state.lastApplied, 1);
	assert.equal(card.resync, true);
});

test('subagent_updated without eventSeq still paints after the parent turn', () => {
	let s = emptySessionSeq();
	s = offer(s, {
		type: 'turn_finished',
		success: true,
		turnId: 'run-1',
		eventSeq: 1
	} as BridgeEvent).state;
	const card = offer(s, {
		type: 'subagent_updated',
		sessionId: 'sess-1',
		childSessionId: 'child-1',
		activity: 'inactive'
	} as BridgeEvent);
	assert.deepEqual(card.emit.map(e => e.type), ['subagent_updated']);
	assert.equal(card.state.lastApplied, 1);
});

test('run_done with a seq hole still emits (do not hold the chat terminal)', () => {
	let s = emptySessionSeq();
	s = offer(s, delta(1, '审查通过')).state;
	const done = offer(s, {
		type: 'run_done',
		runId: 'run-9',
		success: true,
		summary: '',
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(done.emit.map(e => e.type), ['run_done']);
	assert.equal(done.state.lastApplied, 1);
	assert.equal(done.resync, true);
});

function turnDelta(seq: number, text: string, turnId: string): BridgeEvent {
	return {type: 'assistant_delta', text, eventSeq: seq, turnId, unitId: '1:1'};
}

test('cold session_restored then a high-seq live delta paints (cursor was never stamped)', () => {
	let s = emptySessionSeq();
	s = offer(s, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'old', userText: 'hi', assistantText: 'prior'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	} as BridgeEvent).state;
	assert.equal(s.lastApplied, 0);
	assert.equal(s.restored, true);
	const started = offer(s, {type: 'turn_started', turnId: 't2', clientMessageId: 't2', text: 'again'});
	s = started.state;
	const live = offer(s, turnDelta(80, 'live after restore', 't2'));
	assert.deepEqual(texts(live.emit), ['live after restore']);
	assert.equal(live.state.lastApplied, 80);
	assert.equal(live.state.restored, false);
	assert.equal(live.resync, false);
});

test('one unfilled hole must not freeze the next turn in the same session', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	const held = offer(s, turnDelta(3, 'c', 't1'));
	s = held.state;
	assert.deepEqual(texts(held.emit), []);
	assert.equal(s.lastApplied, 1);
	assert.equal(s.syncing, true);
	s = offer(s, {type: 'turn_started', turnId: 't2', clientMessageId: 't2', text: 'next'}).state;
	const next = offer(s, turnDelta(10, 'second turn', 't2'));
	assert.deepEqual(texts(next.emit), ['second turn']);
	assert.equal(next.state.lastApplied, 10);
	assert.equal(next.state.syncing, false);
	assert.equal(next.state.pending.size, 0);
});

test('same-turn 1,3,2 still holds after lastTurnId is known', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	const late = offer(s, turnDelta(3, 'c', 't1'));
	assert.deepEqual(texts(late.emit), []);
	assert.equal(late.state.lastApplied, 1);
	const filled = offer(late.state, turnDelta(2, 'b', 't1'));
	assert.deepEqual(texts(filled.emit), ['b', 'c']);
	assert.equal(filled.state.lastApplied, 3);
});

test('settled hole jumps so a late empty-row fill can paint', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	s = offer(s, turnDelta(3, 'held', 't1')).state;
	const late = offer(s, turnDelta(8, 'straggler', 't1'), {terminal: true});
	assert.deepEqual(texts(late.emit), ['straggler']);
	assert.equal(late.state.lastApplied, 8);
	assert.equal(late.state.syncing, false);
});

test('same-turn held delta flushes before unsequenced turn_finished', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	const held = offer(s, turnDelta(3, 'body', 't1'));
	s = held.state;
	assert.deepEqual(texts(held.emit), []);
	const settled = offer(s, {type: 'turn_finished', success: true, turnId: 't1'} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['body', 'turn_finished']);
	assert.equal(settled.state.lastApplied, 3);
	assert.equal(settled.state.pending.size, 0);
	assert.equal(settled.state.syncing, false);
});

test('turn_finished with empty pending still emits immediately', () => {
	const r = offer(emptySessionSeq(), {type: 'turn_finished', success: true, turnId: 'run-9'} as BridgeEvent);
	assert.deepEqual(r.emit.map(e => e.type), ['turn_finished']);
	assert.equal(r.state.lastApplied, 0);
	assert.equal(r.state.pending.size, 0);
});

test('turn_cancelled drops held deltas instead of painting them', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	s = offer(s, turnDelta(3, 'do not paint', 't1')).state;
	const cancelled = offer(s, {type: 'turn_cancelled', turnId: 't1', reason: 'user cancel'} as BridgeEvent);
	assert.deepEqual(texts(cancelled.emit), ['turn_cancelled']);
	assert.equal(cancelled.state.lastApplied, 1, 'cancel must not jump the cursor over a missing row');
	assert.equal(cancelled.state.pending.size, 0);
});

test('run_cancelled drops held deltas', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 'run-9')).state;
	s = offer(s, turnDelta(3, 'held', 'run-9')).state;
	const cancelled = offer(s, {type: 'run_cancelled', runId: 'run-9', reason: 'stop'} as BridgeEvent);
	assert.deepEqual(cancelled.emit.map(e => e.type), ['run_cancelled']);
	assert.equal(cancelled.emit.some(e => e.type === 'assistant_delta'), false);
	assert.equal(cancelled.state.pending.size, 0);
});

test('held final_answer flushes before turn_finished', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'partial', 't1')).state;
	const held = offer(s, {type: 'final_answer', text: 'full body', turnId: 't1', eventSeq: 3} as BridgeEvent);
	s = held.state;
	assert.deepEqual(texts(held.emit), []);
	const settled = offer(s, {type: 'turn_finished', success: true, turnId: 't1'} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['fa:full body', 'turn_finished']);
	assert.equal(settled.state.lastApplied, 3);
});

test('consecutive turn_finished flushes held deltas before settle', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'a', 't1')).state;
	s = offer(s, turnDelta(3, 'b', 't1')).state;
	s = offer(s, turnDelta(4, 'c', 't1')).state;
	const settled = offer(s, {type: 'turn_finished', success: true, turnId: 't1', eventSeq: 2} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['b', 'c', 'turn_finished']);
	assert.equal(settled.state.pending.size, 0);
});

test('flush prefers held final_answer over partial deltas in the same batch', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, 'start', 't1')).state;
	s = offer(s, turnDelta(3, 'mid', 't1')).state;
	s = offer(s, {type: 'final_answer', text: 'start mid end', turnId: 't1', eventSeq: 4} as BridgeEvent).state;
	const settled = offer(s, {type: 'turn_finished', success: true, turnId: 't1'} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['fa:start mid end', 'turn_finished']);
	assert.equal(settled.emit.some(e => e.type === 'assistant_delta'), false);
	assert.equal(settled.state.lastApplied, 4);
});

test('flush does not advance lastApplied using run_done.eventSeq over a hole', () => {
	let s = emptySessionSeq();
	s = offer(s, turnDelta(1, '审查通过', 'run-9')).state;
	const done = offer(s, {
		type: 'run_done',
		runId: 'run-9',
		success: true,
		summary: '',
		eventSeq: 3
	} as BridgeEvent);
	assert.deepEqual(done.emit.map(e => e.type), ['run_done']);
	assert.equal(done.state.lastApplied, 1);
});

test('cancel forgets lastTurnId so the next run bindHeld cannot inherit it', () => {
	let s = emptySessionSeq();
	s = offer(s, {type: 'turn_started', turnId: 'run-1', text: '', eventSeq: 1} as BridgeEvent).state;
	assert.equal(s.lastTurnId, 'run-1');
	s = offer(s, {type: 'turn_cancelled', turnId: 'run-1', reason: 'user cancel'} as BridgeEvent).state;
	assert.equal(s.lastTurnId, undefined);
	s = offer(s, {type: 'turn_started', turnId: 'run-2', clientMessageId: 'c2', text: 'next'}).state;
	assert.equal(s.liveTurnId, 'run-2');
	s = offer(s, {type: 'assistant_delta', text: '已定位', eventSeq: 4} as BridgeEvent).state;
	const settled = offer(s, {type: 'turn_finished', turnId: 'run-2', success: true} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['已定位', 'turn_finished']);
});

test('held persist deltas without turnId still flush on run-level settle', () => {
	let s = emptySessionSeq();
	s = offer(s, {type: 'turn_started', turnId: 'run-9', text: '', eventSeq: 1} as BridgeEvent).state;
	s = offer(s, {type: 'assistant_delta', text: '这份计划', eventSeq: 3} as BridgeEvent).state;
	const settled = offer(s, {type: 'turn_finished', turnId: 'run-9', success: true} as BridgeEvent);
	assert.deepEqual(texts(settled.emit), ['这份计划', 'turn_finished']);
	assert.equal(settled.state.lastApplied, 3);
});
