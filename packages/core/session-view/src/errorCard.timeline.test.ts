import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	composerGate,
	createTranscriptState,
	regenUserIdOf,
	toTimelineItems,
	type TimelineItem
} from './index.js';

const TRANSPORT =
	'RuntimeException: FaultCarrier: Transport: connection timed out after 10000 ms: open.bigmodel.cn/47.251.66.145:443 (root cause: ConnectTimeoutException: connection timed out after 10000 ms: open.bigmodel.cn/47.251.66.145:443)';

const transportFault = {kind: 'transport', remedy: 'retry_same'} as const;

function assistants(items: readonly TimelineItem[]) {
	return items.filter(
		(i): i is Extract<TimelineItem, {kind: 'assistant'}> => i.kind === 'assistant'
	);
}

function lastAssistant(items: readonly TimelineItem[]) {
	const all = assistants(items);
	return all[all.length - 1];
}

test('transport run_failed on a live turn becomes an error card, not a done reply', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'cm-1',
		text: '帮我查一下'
	});
	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 'run-1',
		error: TRANSPORT,
		fault: transportFault
	});
	const entry = state.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.status, 'error');
	assert.equal(entry?.fault?.kind, 'transport');
	assert.equal(entry?.text, TRANSPORT);

	const items = toTimelineItems(state);
	const card = lastAssistant(items);
	assert.equal(card?.status, 'error');
	assert.equal(card?.text, TRANSPORT);
	assert.equal(card?.fault?.kind, 'transport');
	assert.equal(card?.runId, 'run-1');
	assert.equal(regenUserIdOf(items), null);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
});

test('turn_finished after tools still projects the timeout as an error card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-fail',
		clientMessageId: 'm-fail',
		text: 'do something'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't-fail',
		id: 'c1',
		tool: 'glob',
		args: {pattern: '*.ts'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't-fail',
		id: 'c1',
		tool: 'glob',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 't-fail',
		success: false,
		reason: TRANSPORT
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'error');

	const items = toTimelineItems(state);
	const card = lastAssistant(items);
	assert.equal(card?.status, 'error', 'tools-orphan must not paint the timeout as a done reply');
	assert.equal(card?.text, TRANSPORT);
	assert.equal(regenUserIdOf(items), null);
});

test('thinking-only timeout still lands as an error card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-think',
		clientMessageId: 'm-think',
		text: 'plan it'
	});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't-think',
		text: 'considering files'
	});
	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 't-think',
		error: TRANSPORT,
		fault: transportFault
	});
	const items = toTimelineItems(state);
	const card = lastAssistant(items);
	assert.equal(card?.status, 'error');
	assert.equal(card?.fault?.kind, 'transport');
	assert.equal(regenUserIdOf(items), null);
});

test('run_failed reseals an already-done assistant (FailRun after stream death)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'cm-1',
		text: 'hi'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-1', success: true});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');

	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 'run-1',
		error: TRANSPORT,
		fault: transportFault
	});
	const entry = state.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.status, 'error');
	assert.equal(entry?.text, TRANSPORT);
	assert.equal(entry?.fault?.kind, 'transport');

	const items = toTimelineItems(state);
	assert.equal(lastAssistant(items)?.status, 'error');
	assert.equal(regenUserIdOf(items), null);
});

test('run_failed with no assistant row synthesizes an error card', () => {
	let state = createTranscriptState();
	state = {
		...state,
		entries: [
			{
				id: 'user-run-9',
				role: 'user',
				text: '帮我查一下',
				status: 'done',
				turnId: 'run-9',
				clientMessageId: 'cm-9'
			}
		]
	};
	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 'run-9',
		error: TRANSPORT,
		fault: transportFault
	});
	const entry = state.entries.find(e => e.role === 'assistant');
	assert.ok(entry);
	assert.equal(entry?.status, 'error');
	assert.equal(entry?.turnId, 'run-9');
	assert.equal(entry?.text, TRANSPORT);
	assert.equal(lastAssistant(toTimelineItems(state))?.status, 'error');
});

test('duplicate run_failed (CommandLoop + in-band FailRun) stays a single error card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'cm-1',
		text: '帮我查一下'
	});
	const fail = {
		type: 'run_failed' as const,
		runId: 'run-1',
		error: TRANSPORT,
		fault: transportFault
	};
	state = applyBridgeEvent(state, fail);
	state = applyBridgeEvent(state, fail);
	const cards = state.entries.filter(e => e.role === 'assistant');
	assert.equal(cards.length, 1);
	assert.equal(cards[0]?.status, 'error');
	assert.equal(assistants(toTimelineItems(state)).length, 1);
	assert.equal(regenUserIdOf(toTimelineItems(state)), null);
});

test('thin follow-up run_failed keeps acceptedTurns from the in-band fault', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'cm-1',
		text: 'hi'
	});
	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 'run-1',
		error: 'Declined: 401',
		fault: {kind: 'declined', remedy: 'fail', acceptedTurns: 2, attempts: 3}
	});
	state = applyBridgeEvent(state, {
		type: 'run_failed',
		runId: 'run-1',
		error: TRANSPORT,
		fault: transportFault
	});
	const entry = state.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.fault?.kind, 'transport');
	assert.equal(entry?.fault?.acceptedTurns, 2);
	assert.equal(entry?.fault?.attempts, 3);
});

test('regenUserIdOf lights only the last completed answer, never a failed turn', () => {
	const doneItems: TimelineItem[] = [
		{kind: 'user', id: 'u1', text: 'hi', isCommand: false, runId: 'run-1'},
		{kind: 'assistant', id: 'a1', text: 'ok', status: 'done', runId: 'run-1'}
	];
	assert.equal(regenUserIdOf(doneItems), 'u1');

	const failedItems: TimelineItem[] = [
		{kind: 'user', id: 'u2', text: 'hi', isCommand: false, runId: 'run-2'},
		{kind: 'assistant', id: 'a2', text: TRANSPORT, status: 'error', runId: 'run-2', fault: transportFault}
	];
	assert.equal(regenUserIdOf(failedItems), null);

	const priorDoneThenFail: TimelineItem[] = [
		{kind: 'user', id: 'u1', text: 'first', isCommand: false, runId: 'run-1'},
		{kind: 'assistant', id: 'a1', text: 'ok', status: 'done', runId: 'run-1'},
		{kind: 'user', id: 'u2', text: 'again', isCommand: false, runId: 'run-2'},
		{kind: 'assistant', id: 'a2', text: TRANSPORT, status: 'error', runId: 'run-2'}
	];
	assert.equal(regenUserIdOf(priorDoneThenFail), null);
});

test('session_restored failed turn paints an ErrorCard, not a done reply', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'msg-ok',
				userText: 'first',
				assistantText: 'ok'
			},
			{
				turnId: 'msg-fail',
				userText: 'again',
				assistantText: TRANSPORT,
				failed: true
			}
		]
	});
	const cards = state.entries.filter(e => e.role === 'assistant');
	assert.equal(cards[0]?.status, 'done');
	assert.equal(cards[1]?.status, 'error');
	assert.equal(cards[1]?.text, TRANSPORT);

	const items = toTimelineItems(state);
	assert.equal(lastAssistant(items)?.status, 'error');
	assert.equal(regenUserIdOf(items), null);
});
