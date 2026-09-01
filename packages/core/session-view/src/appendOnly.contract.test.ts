/**
 * Append-only contract for applyBridgeEvent (Candidate J / TUI <Static>).
 *
 * Hot-path events may only grow the settled fingerprint or extend the open
 * tail. Three annotated exceptions may rewrite / prepend freely:
 *   - session_restored (merge)
 *   - session_history_page (ADR-0012 prepend)
 *   - turn_cancelled / applyLocalCancel (cancel terminal sweep)
 *
 * TUI hosts treat exceptions as full-repaint paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	applyLocalCancel,
	createTranscriptState,
	type EntrySegment,
	type TranscriptEntry,
	type TranscriptState
} from './transcriptProjection.js';
import type {BridgeEvent} from '@fastllm/bridge-protocol';

type SettledAtom = {
	entryId: string;
	segmentId: string;
	kind: EntrySegment['kind'];
	text?: string;
	toolIds?: string[];
};

/** Settled atoms: every segment of finished entries + all-but-last of streaming. */
function settledAtoms(state: TranscriptState): SettledAtom[] {
	const atoms: SettledAtom[] = [];
	for (const entry of state.entries) {
		const segments = entry.segments ?? [];
		if (entry.status === 'streaming') {
			for (const segment of segments.slice(0, -1)) {
				atoms.push(atomOf(entry, segment));
			}
			continue;
		}
		for (const segment of segments) {
			atoms.push(atomOf(entry, segment));
		}
	}
	return atoms;
}

function atomOf(entry: TranscriptEntry, segment: EntrySegment): SettledAtom {
	if (segment.kind === 'tools') {
		return {entryId: entry.id, segmentId: segment.id, kind: 'tools', toolIds: [...segment.toolIds]};
	}
	if (segment.kind === 'thinking') {
		return {entryId: entry.id, segmentId: segment.id, kind: 'thinking', text: segment.text};
	}
	if (segment.kind === 'plan') {
		return {
			entryId: entry.id,
			segmentId: segment.id,
			kind: 'plan',
			text: `${segment.plan.planId}:${segment.plan.todos.map(t => t.status).join(',')}`
		};
	}
	return {entryId: entry.id, segmentId: segment.id, kind: 'assistant', text: segment.text};
}

function isPrefix(before: SettledAtom[], after: SettledAtom[]): boolean {
	if (before.length > after.length) return false;
	for (let i = 0; i < before.length; i += 1) {
		if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) return false;
	}
	return true;
}

const EXCEPTION_TYPES = new Set([
	'session_restored',
	'session_history_page',
	'turn_cancelled'
]);

function assertAppendOnly(before: TranscriptState, after: TranscriptState, event: BridgeEvent | {type: 'local_cancel'}): void {
	const prev = settledAtoms(before);
	const next = settledAtoms(after);
	if (event.type === 'local_cancel' || EXCEPTION_TYPES.has(event.type)) {
		return;
	}
	assert.ok(
		isPrefix(prev, next),
		`settled fingerprint must be append-only after ${event.type}\nbefore=${JSON.stringify(prev)}\nafter=${JSON.stringify(next)}`
	);
}

function fold(events: Array<BridgeEvent | {type: 'local_cancel'}>): TranscriptState {
	let state = createTranscriptState();
	for (const event of events) {
		const before = state;
		state =
			event.type === 'local_cancel'
				? applyLocalCancel(state)
				: applyBridgeEvent(state, event);
		assertAppendOnly(before, state, event);
	}
	return state;
}

test('append-only: streaming think → tool → assistant grows settled prefix only', () => {
	const state = fold([
		{type: 'turn_started', turnId: 't1', clientMessageId: 'm1', text: 'go'},
		{type: 'input_accepted', turnId: 'run1', clientMessageId: 'm1'},
		{type: 'reasoning_delta', turnId: 'run1', text: 'think-a'},
		{type: 'reasoning_delta', turnId: 'run1', text: '-b'},
		{type: 'tool_started', turnId: 'run1', id: 'tool1', tool: 'shell', args: {command: 'ls'}},
		{type: 'tool_output', turnId: 'run1', id: 'tool1', tool: 'shell', stream: 'stdout', text: 'out'},
		{type: 'tool_finished', turnId: 'run1', id: 'tool1', tool: 'shell', success: true, fields: {}},
		{type: 'assistant_delta', turnId: 'run1', text: 'hello'},
		{type: 'assistant_delta', turnId: 'run1', text: ' world'},
		{type: 'turn_finished', turnId: 'run1', success: true}
	]);
	assert.equal(state.entries.filter(e => e.role === 'assistant').at(-1)?.status, 'done');
	assert.ok(settledAtoms(state).length >= 2);
});

test('append-only: second turn does not rewrite first turn settled atoms', () => {
	const afterFirst = fold([
		{type: 'turn_started', turnId: 't1', clientMessageId: 'm1', text: 'one'},
		{type: 'assistant_delta', turnId: 't1', text: 'answer-1'},
		{type: 'turn_finished', turnId: 't1', success: true}
	]);
	const firstSettled = settledAtoms(afterFirst);

	let state = afterFirst;
	const secondEvents: BridgeEvent[] = [
		{type: 'turn_started', turnId: 't2', clientMessageId: 'm2', text: 'two'},
		{type: 'reasoning_delta', turnId: 't2', text: 'plan'},
		{type: 'assistant_delta', turnId: 't2', text: 'answer-2'},
		{type: 'turn_finished', turnId: 't2', success: true}
	];
	for (const event of secondEvents) {
		const before = state;
		state = applyBridgeEvent(state, event);
		assertAppendOnly(before, state, event);
	}
	assert.ok(isPrefix(firstSettled, settledAtoms(state)));
});

test('append-only: input_accepted remaps open turnId without rewriting settled prefix', () => {
	fold([
		{type: 'turn_started', turnId: 'client-1', clientMessageId: 'client-1', text: 'hi'},
		{type: 'reasoning_delta', turnId: 'client-1', text: 'r'},
		{type: 'assistant_delta', turnId: 'client-1', text: 'partial'},
		{type: 'input_accepted', turnId: 'server-run', clientMessageId: 'client-1'},
		{type: 'assistant_delta', turnId: 'server-run', text: ' more'},
		{type: 'turn_finished', turnId: 'server-run', success: true}
	]);
});

test('exception: session_restored may rewrite entries (annotated)', () => {
	let state = fold([
		{type: 'turn_started', turnId: 'live', clientMessageId: 'live', text: 'live q'},
		{type: 'assistant_delta', turnId: 'live', text: 'live a'}
	]);
	const before = state;
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-restore',
		turns: [
			{
				turnId: 'old1',
				userText: 'old',
				assistantText: 'restored',
				thinking: null,
				tools: null
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	// Exception: fingerprint need not be a prefix — assert rewrite happened.
	assert.notEqual(JSON.stringify(settledAtoms(before)), JSON.stringify(settledAtoms(state)));
	assert.ok(state.entries.some(e => e.turnId === 'old1'));
	assert.ok(state.entries.some(e => e.turnId === 'live' && e.status === 'streaming'));
});

test('exception: session_history_page may prepend (annotated)', () => {
	let state = fold([
		{type: 'turn_started', turnId: 't2', clientMessageId: 'm2', text: 'newer'},
		{type: 'assistant_delta', turnId: 't2', text: 'n'},
		{type: 'turn_finished', turnId: 't2', success: true}
	]);
	const beforeIds = state.entries.map(e => e.id);
	state = applyBridgeEvent(state, {
		type: 'session_history_page',
		sessionId: 'sess-page',
		turns: [
			{
				turnId: 't1',
				userText: 'older',
				assistantText: 'o',
				thinking: null,
				tools: null
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 2,
		beforeTurnId: 't2'
	});
	assert.equal(state.entries[0]?.turnId, 't1');
	assert.deepEqual(
		state.entries.slice(2).map(e => e.id),
		beforeIds
	);
});

test('exception: turn_cancelled / local cancel may sweep streaming entries (annotated)', () => {
	let state = fold([
		{type: 'turn_started', turnId: 't1', clientMessageId: 'm1', text: 'q'},
		{type: 'reasoning_delta', turnId: 't1', text: 'r'},
		{type: 'tool_started', turnId: 't1', id: 'x', tool: 'shell', args: {}},
		{type: 'assistant_delta', turnId: 't1', text: 'partial'}
	]);
	const before = state;
	state = applyLocalCancel(state);
	assertAppendOnly(before, state, {type: 'local_cancel'});
	assert.equal(
		state.entries.find(e => e.role === 'assistant')?.status,
		'cancelled'
	);
	const mid = state;
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 't1'});
	assertAppendOnly(mid, state, {type: 'turn_cancelled', turnId: 't1'});
	assert.equal(state.awaitingCancelSettlement, false);
});
