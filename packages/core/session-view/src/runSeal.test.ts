/**
 * Run seal: once the user stops a run, every late event of that run must
 * leave the transcript untouched — zero new rows between the click and the
 * terminal event. Ghost HITL prompts for the sealed run must not re-lock the
 * composer, while a genuinely new run re-arms streaming right away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	applyLeaseExpiry,
	applyLocalCancel,
	createTranscriptState
} from './transcriptProjection.js';
import {chromeAwaitingSettlement, chromePostRun, chromeRunId} from './runChrome.js';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {TranscriptState} from './transcriptProjection.js';

function liveRun(): TranscriptState {
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
		turnId: 'run-1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-1', text: 'partial'});
	return state;
}

test('cancel pending: late tool events add zero transcript rows', () => {
	let state = liveRun();
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 'run-1',
		id: 'tool-late',
		tool: 'shell',
		args: {command: 'sleep 60'}
	});
	state = applyLocalCancel(state);
	assert.equal(chromeAwaitingSettlement(state.chrome), true);
	const frozen = state;

	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 'run-1',
		id: 'tool-after',
		tool: 'shell',
		args: {command: 'echo'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: 'run-1',
		id: 'tool-late',
		tool: 'shell',
		stream: 'stdout',
		text: 'late output'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 'run-1',
		id: 'tool-late',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-1', text: ' ghost'});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'run-1', text: ' ghost'});

	assert.equal(state.entries.length, frozen.entries.length);
	assert.deepEqual(
		state.entries.map(e => e.status),
		frozen.entries.map(e => e.status)
	);
	assert.equal(
		state.entries.some(e => e.turnId === 'run-1' && e.tools?.some(t => t.id === 'tool-after')),
		false,
		'late tool_started must not add a tool row'
	);
});

test('cancel pending: ghost hitl prompt for the sealed run is dropped', () => {
	let state = liveRun();
	state = applyLocalCancel(state);

	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		runId: 'run-1',
		id: 'ap-1',
		tool: 'shell',
		description: 'run something',
		risk: 'low'
	} as BridgeEvent);
	assert.equal(state.approvals.length, 0);

	state = applyBridgeEvent(state, {
		type: 'question_requested',
		runId: 'run-1',
		id: 'q-1',
		question: 'proceed?',
		options: []
	} as BridgeEvent);
	assert.equal(state.questions.length, 0);
});

test('cancel pending: another run\u2019s hitl prompt still passes', () => {
	let state = liveRun();
	state = applyLocalCancel(state);

	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		runId: 'run-other',
		id: 'ap-2',
		tool: 'shell',
		description: 'other run',
		risk: 'low'
	} as BridgeEvent);
	assert.equal(state.approvals.length, 1);
	assert.equal(state.approvals[0]?.runId, 'run-other');
});

test('sealed run: terminal event clears pending; new turn re-arms streaming', () => {
	let state = liveRun();
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 'run-1'});
	assert.equal(chromeAwaitingSettlement(state.chrome), false);
	assert.equal(chromePostRun(state.chrome), true);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_2',
		clientMessageId: 'client_2',
		text: 'next question'
	});
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), 'client_2');

	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'client_2', text: 'fresh'});
	const fresh = state.entries.find(e => e.turnId === 'client_2' && e.role === 'assistant');
	assert.equal(fresh?.text, 'fresh');
	assert.equal(fresh?.status, 'streaming');
});

test('sealed run: late run_state heartbeat must not reopen a user-stopped run', () => {
	let state = liveRun();
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 'run-1'});
	const frozen = state;

	for (const heartbeat of ['running', 'waiting', 'cancelling'] as const) {
		state = applyBridgeEvent(state, {
			type: 'run_state',
			runId: 'run-1',
			turnId: 'run-1',
			state: heartbeat
		} as BridgeEvent);
		assert.equal(chromePostRun(state.chrome), true, `${heartbeat} heartbeat must keep the seal`);
		assert.equal(
			chromeRunId(state.chrome),
			undefined,
			`${heartbeat} heartbeat must not re-arm the stopped run`
		);
		assert.equal(chromeAwaitingSettlement(state.chrome), false);
	}
	assert.equal(state.entries.length, frozen.entries.length);

	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-1', text: ' ghost'});
	assert.equal(state.entries.length, frozen.entries.length);
});

test('lease-settled run: heartbeat without a cancelled entry still revives', () => {
	let state = liveRun();
	state = applyLeaseExpiry(state);
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(state.entries.some(e => e.status === 'cancelled'), false);

	state = applyBridgeEvent(state, {
		type: 'run_state',
		runId: 'run-1',
		turnId: 'run-1',
		state: 'waiting'
	} as BridgeEvent);
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), 'run-1');
});

test('sealed run: late river turn_started for the sealed run is dropped', () => {
	let state = liveRun();
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 'run-1'});
	const frozen = state;

	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run-1'} as BridgeEvent);
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(state.entries.length, frozen.entries.length);
});

test('cancel pending: late context/usage for the dying run are dropped', () => {
	let state = liveRun();
	state = applyLocalCancel(state);

	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'run-1',
		label: 'recall',
		sourceKind: 'recall',
		form: 'inline',
		text: 'late context'
	} as BridgeEvent);
	assert.equal(state.contextInjections?.length ?? 0, 0);

	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'run-1',
		buckets: {}
	} as BridgeEvent);
	assert.equal(state.usage, undefined);
});

test('sealed run: late context/usage/tool-card for the sealed run leave the views untouched', () => {
	let state = liveRun();
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 'run-1'});

	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'run-1',
		label: 'recall',
		sourceKind: 'recall',
		form: 'inline',
		text: 'late context'
	} as BridgeEvent);
	assert.equal(state.contextInjections?.length ?? 0, 0);

	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'run-1',
		buckets: {}
	} as BridgeEvent);
	assert.equal(state.usage, undefined);

	state = applyBridgeEvent(state, {
		type: 'dsh_tool_card',
		runId: 'run-1',
		callId: 'ghost-card',
		name: 'shell',
		title: 'ghost',
		args: {}
	} as BridgeEvent);
	const sealedEntry = state.entries.find(e => e.turnId === 'run-1' && e.role === 'assistant');
	assert.equal(sealedEntry?.tools?.some(t => t.id === 'ghost-card'), false);
});

test('sealed run: context/usage for a new run still apply', () => {
	let state = liveRun();
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', turnId: 'run-1'});

	state = applyBridgeEvent(state, {
		type: 'context_injected',
		runId: 'run-new',
		label: 'recall',
		sourceKind: 'recall',
		form: 'inline',
		text: 'fresh context'
	} as BridgeEvent);
	assert.equal(state.contextInjections?.length, 1);

	state = applyBridgeEvent(state, {
		type: 'usage_reported',
		runId: 'run-new',
		buckets: {}
	} as BridgeEvent);
	assert.equal(state.usage?.runId, 'run-new');
});
