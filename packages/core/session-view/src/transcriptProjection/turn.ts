/** transcriptProjection tests — turn_started / input_accepted / river remap. Loaded by transcriptProjection.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	appendProcPreview,
	applyBridgeEvent,
	applyLocalCancel,
	composerGate,
	createTranscriptState,
	formatActivitySummary,
	LIVE_PROC_PREVIEW_MAX,
	nextFireAtFromDetail,
	normalizeToolOutput,
	parseDiffWithLineNumbers,
	parseExitCode,
	resolveToolStatus,
	toTimelineItems
} from '../index.js';
import {runChromeTransition, chromeRunId, chromePostRun, chromeAwaitingSettlement} from '../runChrome.js';
import {exploreFinished} from './kit.js';

test('input_accepted sets activeRunId to server Run id; local cancel awaits turn_cancelled', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	// Peer/local turn_started pins activeRunId immediately so Composer Gate can enqueue.
	assert.equal(chromeRunId(state.chrome), 'client_1');
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	assert.equal(chromeRunId(state.chrome), 'client_1');
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	});
	assert.equal(chromeRunId(state.chrome), '019f-server-run');

	state = applyLocalCancel(state);
	assert.equal(chromeAwaitingSettlement(state.chrome), true);
	assert.equal(state.entries[1]?.status, 'cancelled');
	assert.equal(chromeRunId(state.chrome), '019f-server-run', 'run id kept until settlement for diagnostics');

	// Late accept after local cancel must NOT unlock before turn_cancelled
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	});
	assert.equal(chromeAwaitingSettlement(state.chrome), true);

	state = applyBridgeEvent(state, {type: 'turn_cancelled', reason: 'user cancel'});
	assert.equal(chromeAwaitingSettlement(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), undefined);
});

test('full-answer assistant_delta that re-emits streamed text is ignored', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'q'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello world'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello world'});
	assert.equal(state.entries[1]?.text, 'hello world');
});

test('long assistant stream preserves immutable snapshots and mirrored segment text', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'turn_started',
		turnId: 'long',
		clientMessageId: 'long',
		text: 'q'
	});
	const chunks = Array.from({length: 1_000}, (_, i) => `${i % 10}x`);
	for (const text of chunks) {
		state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'long', text});
	}

	const before = state;
	const beforeAssistant = before.entries[1]!;
	const next = applyBridgeEvent(before, {
		type: 'assistant_delta',
		turnId: 'long',
		text: 'tail'
	});
	const expected = `${chunks.join('')}tail`;
	const assistant = next.entries[1]!;
	const assistantSegment = assistant.segments?.at(-1);

	assert.equal(before.entries[1], beforeAssistant);
	assert.equal(beforeAssistant.text, chunks.join(''), 'prior snapshot must not observe the next delta');
	assert.equal(next.entries[0], before.entries[0], 'settled user prefix keeps object identity');
	assert.notEqual(assistant, beforeAssistant, 'changed assistant remains a new object for tail diff');
	assert.equal(assistant.text, expected);
	assert.equal(assistantSegment?.kind, 'assistant');
	assert.equal(assistantSegment?.text, expected);
});

test('double input_accepted: entry id stays stable; deltas route via server turnId', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	const entryId = state.entries[1]?.id;
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'server-uuid-1'
	});
	assert.equal(state.entries[1]?.id, entryId, 'entry id must not change after remap');
	assert.equal(state.entries[1]?.turnId, 'server-uuid-1');
	assert.equal(chromeRunId(state.chrome), 'server-uuid-1');

	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 'server-uuid-1',
		text: 'thinking'
	});
	assert.equal(state.entries[1]?.reasoning, 'thinking');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'server-uuid-1',
		text: 'reply'
	});
	assert.equal(state.entries[1]?.text, 'reply');
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 'server-uuid-1',
		success: true
	});
	assert.equal(state.entries[1]?.status, 'done');
});

test('double input_accepted: later turn_started does not duplicate entries', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'server-uuid-1'
	});
	const before = state.entries.length;
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'server-uuid-1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	assert.equal(state.entries.length, before);
	assert.equal(state.entries[1]?.turnId, 'server-uuid-1');
});

test('local cancel blocks late deltas from mutating cancelled entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'hello'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'partial'});
	state = applyLocalCancel(state);
	assert.equal(state.entries[1]?.status, 'cancelled');
	const textBefore = state.entries[1]?.text;
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: ' late'});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't1',
		text: 'ghost'
	});
	assert.equal(state.entries[1]?.text, textBefore);
	assert.equal(state.entries[1]?.reasoning ?? '', '');
	assert.equal(state.entries.length, 2);
});
test('live turn_started without eventSeq paints Follow-up display text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-fu',
		text: '/goal draft the launch plan'
	});
	assert.equal(
		state.entries.find(e => e.role === 'user')?.text,
		'/goal draft the launch plan'
	);
});

test('live PlanBuild display survives persist TurnStarted with model text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-pb',
		clientMessageId: 'client-pb',
		text: '执行计划：review-findings-fix',
		messageType: 'plan_build',
		planId: 'plan-1',
		planName: 'review-findings-fix'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-pb'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-pb',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 4
	});
	const users = state.entries.filter(e => e.role === 'user');
	assert.equal(users.length, 1);
	assert.equal(users[0]?.text, '执行计划：review-findings-fix');
});

test('approval-sealed card + persist TurnStarted with model text must not spawn a second user', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix',
		messageType: 'plan_build',
		planId: 'plan-1',
		planName: 'review-findings-fix'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-9',
		tool: 'shell',
		description: 'ls'
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 20
	});
	const users = state.entries.filter(e => e.role === 'user');
	assert.equal(users.length, 1);
	assert.equal(users[0]?.text, '执行计划：review-findings-fix');
});
test('orphaned streaming assistant from a dropped turn is sealed when the next turn starts', () => {
	// Repro: Turn 1 streams partial output then the LLM stream drops silently (no
	// turn_finished/turn_cancelled). The user sends a new message; Turn 2's deltas
	// must NOT route into the stale streaming entry via the patchAssistant fallback.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'first'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'partial reply'});
	assert.equal(state.entries[1]?.status, 'streaming');
	assert.equal(state.entries[1]?.text, 'partial reply');

	// No turn_finished — stream just stopped. User sends a new message.
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't2',
		clientMessageId: 'm2',
		text: 'second'
	});

	// Stale entry is sealed as done — not cancelled (user did not Stop) and not red error.
	const firstAssistant = state.entries.find(e => e.turnId === 't1' && e.role === 'assistant');
	assert.equal(firstAssistant?.status, 'done');
	assert.equal(firstAssistant?.sealedUnconfirmed, true);
	assert.equal(firstAssistant?.text, 'partial reply');

	// New turn has its own streaming assistant.
	const secondAssistant = state.entries.find(e => e.turnId === 't2' && e.role === 'assistant');
	assert.ok(secondAssistant);
	assert.equal(secondAssistant?.status, 'streaming');

	// Deltas for t2 route into the new entry, not the stale one.
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't2', text: 'second reply'});
	assert.equal(state.entries.find(e => e.turnId === 't2' && e.role === 'assistant')?.text, 'second reply');
	assert.equal(firstAssistant?.text, 'partial reply', 'stale entry untouched');

	const items = toTimelineItems(state);
	assert.equal(
		items.some(i => i.kind === 'processStack' && i.cancelled),
		false,
		'neutral seal must not paint 已取消'
	);
});

test('river turn_started with same clientMessageId and different turnId does not split', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review this'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'client-1', text: 'look'});
	const before = state.entries.length;
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'engine-run-9',
		clientMessageId: 'client-1'
	});
	assert.equal(state.entries.length, before);
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'streaming');
	assert.equal(assistant?.turnId, 'client-1', 'must not adopt river `$runId-turn-N`');
	assert.equal(assistant?.clientMessageId, 'client-1');
	assert.equal(state.entries.filter(e => e.role === 'user').length, 1);
});

test('river turn_started with a different id remaps the live optimistic turn', () => {
	// CommandLoop emits turn_started(clientMessageId); river TurnStarted is the
	// same turn — merge, do not seal / split, do not overwrite the live turnId.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review this'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'client-1', text: 'look'});
	state = exploreFinished(state, 'client-1', 'r1', 'a.ts');
	state = exploreFinished(state, 'client-1', 'r2', 'b.ts');
	const before = state.entries.length;

	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'engine-run-9'});

	assert.equal(state.entries.length, before);
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'streaming');
	assert.equal(assistant?.turnId, 'client-1', 'must not adopt river `$runId-turn-N`');
	assert.equal(assistant?.clientMessageId, 'client-1');
	assert.equal(state.entries.filter(e => e.role === 'user').length, 1);

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.equal(
		items.some(i => i.kind === 'processStack' && i.cancelled),
		false
	);
	assert.equal(items.filter(i => i.kind === 'processStack').length, 1);
});

test('run_done after river TurnStarted remaps turnId off the run id must extinguish Stop', () => {
	// Live order: CommandLoop turn_started(client id) → input_accepted(run id) →
	// deltas keyed by run id → persist TurnStarted uses `$runId-turn-N`.
	// Reconciliation must keep the run id so run_done can match.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-9', text: '审查通过'});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9-turn-1',
		clientMessageId: 'client-1'
	});
	assert.equal(
		state.entries.find(e => e.role === 'assistant')?.turnId,
		'run-9',
		'input_accepted run id must survive river TurnStarted'
	);
	assert.equal(composerGate(state, true).canCancel, true);
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'run_done must seal the remapped streaming row'
	);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(composerGate(state, true).canCancel, false, 'Stop must go out when the run completes');
});

test('second ReAct TurnStarted without clientMessageId must not leave Stop lit after run_done', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-9', text: '审查通过'});
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: '1'});
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: '2'});
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-9', success: true});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(composerGate(state, true).canCancel, false);
});

test('sequenced empty TurnStarted after settle does not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '你是谁'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-9',
		text: '我是 Fast。',
		unitId: '1:1'
	});
	state = applyBridgeEvent(state, {type: 'checkpoint', unitId: '1:1', content: '我是 Fast。'});
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-9', success: true});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run-9', text: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});
