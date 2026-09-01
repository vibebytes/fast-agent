/**
 * SkillSlash finish/cancel/queue regression — mirrors Bridge event shapes.
 *
 * Symptom 1: after SkillSlash "looks done", next submit queues (composer still
 * hasRun) because turn settles as cancelled (streamStop) → no auto-dequeue.
 * Symptom 2: Stop shows Cancelled but CancelRun targets clientMessageId when
 * Bridge never remaps input_accepted to hostRunId → engine host stays Running.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {canAutoDequeue, composerGate} from '@fast-ide/session-view';
import {initialState, type UiState} from './model.js';
import {reducer} from './reducer.js';
import {runIdFor} from './runId.js';

function skillSlashEvents(clientId: string, hostRunId: string, remapHost: boolean) {
	const events: Array<Record<string, unknown>> = [
		{type: 'ready'},
		{type: 'input_accepted', clientMessageId: clientId, turnId: clientId},
		{type: 'turn_started', turnId: clientId, clientMessageId: clientId, text: '/demo-skill'},
	];
	if (remapHost) {
		events.push({type: 'input_accepted', clientMessageId: clientId, turnId: hostRunId});
	}
	return events;
}

function applyEvents(state: UiState, events: Array<Record<string, unknown>>): UiState {
	return events.reduce<UiState>(
		(s, event) => reducer(s, {type: 'engine_event', event: event as never}),
		state,
	);
}

test('SkillSlash without host remap: Stop CancelRun would target clientMessageId (symptom 2 root)', () => {
	const clientId = 'client-skill-1';
	const hostRunId = '019f-host-run-uuid';
	const state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, false));
	assert.equal(runIdFor(state), clientId, 'without remap CancelRun hits client id, not host');
	assert.notEqual(runIdFor(state), hostRunId);
});

test('SkillSlash with host remap (Bridge contract): CancelRun targets hostRunId', () => {
	const clientId = 'client-skill-2';
	const hostRunId = '019f-host-run-uuid-2';
	const state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	assert.equal(runIdFor(state), hostRunId);
});

test('Cancel before host remap: local_cancel still targets clientMessageId (remap race gap)', () => {
	const clientId = 'client-skill-race';
	const hostRunId = '019f-host-run-race';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, false));
	state = reducer(state, {type: 'local_cancel'});
	assert.equal(state.transcript.awaitingCancelSettlement, true);
	assert.equal(runIdFor(state), clientId, 'CancelRun payload would still be client id before remap');
	assert.notEqual(runIdFor(state), hostRunId);
});

test('Cancel after host remap: Stopping keeps hostRunId until turn_cancelled then composer idle', () => {
	const clientId = 'client-skill-stop';
	const hostRunId = '019f-host-run-stop';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	state = reducer(state, {type: 'local_cancel'});
	assert.equal(runIdFor(state), hostRunId, 'CancelRun must target host while Stopping');
	assert.equal(composerGate(state.transcript, true).canEnqueue, true);

	state = reducer(state, {type: 'engine_event', event: {type: 'turn_cancelled', reason: 'cancelled by user'}});
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(canAutoDequeue(state.lastTurnTerminal), false);
	const gate = composerGate(state.transcript, true);
	assert.equal(gate.canSubmitNow, true, 'after Cancelled settle, next typed input must submit (not silent drop)');
	assert.equal(gate.canEnqueue, false);
	assert.equal(gate.runState, 'idle');
});

test('false cancel settle (streamStop) blocks auto-dequeue after SkillSlash success (symptom 1)', () => {
	const clientId = 'client-skill-3';
	const hostRunId = '019f-host-run-uuid-3';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_cancelled', reason: 'cancelled'}});
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(canAutoDequeue(state.lastTurnTerminal), false);
	const gate = composerGate(state.transcript, true);
	// After false cancel UI is idle for submit — but queued items never auto-send.
	assert.equal(gate.canSubmitNow, true);
	assert.equal(gate.canEnqueue, false);
});

test('true finished settle allows auto-dequeue and immediate next submit after SkillSlash success', () => {
	const clientId = 'client-skill-4';
	const hostRunId = '019f-host-run-uuid-4';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', success: true}});
	assert.equal(state.lastTurnTerminal, 'finished');
	assert.equal(canAutoDequeue(state.lastTurnTerminal), true);
	const gate = composerGate(state.transcript, true);
	assert.equal(gate.canSubmitNow, true);
	assert.equal(gate.runState, 'idle');
});

test('ask_user_question handoff: question_requested extinguishes Stop (canCancel=false)', () => {
	const clientId = 'client-skill-ask';
	const hostRunId = '019f-host-ask';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'assistant_delta',
			turnId: hostRunId,
			text: 'Which candidate?'
		}
	});
	assert.equal(composerGate(state.transcript, true).canCancel, true);
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'question_requested',
			id: 'q1',
			runId: hostRunId,
			turnId: hostRunId,
			question: 'Which candidate?',
			options: [
				{id: 'a', label: 'A'},
				{id: 'b', label: 'B'}
			],
			allowCustom: true
		}
	});
	const gate = composerGate(state.transcript, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.composerLocked, true);
	assert.equal(state.transcript.questions.length, 1);
});

test('SkillSlash turn_finished without turnId: stragglers must not re-light Stop', () => {
	const clientId = 'client-skill-strag';
	const hostRunId = '019f-host-strag';
	let state = applyEvents(initialState, skillSlashEvents(clientId, hostRunId, true));
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'assistant_delta', turnId: hostRunId, text: 'skill body'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'turn_finished', success: true, sessionId: 'sess'}
	});
	assert.equal(state.transcript.postRunTerminal, true);
	assert.equal(composerGate(state.transcript, true).canCancel, false);

	const textBefore = state.transcript.entries.find(e => e.role === 'assistant')?.text;
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'assistant_delta', turnId: hostRunId, text: '\nstraggler'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'tool_started',
			turnId: hostRunId,
			id: 'ghost',
			tool: 'shell',
			args: {command: 'echo x'}
		}
	});
	assert.equal(state.transcript.entries.find(e => e.role === 'assistant')?.text, textBefore);
	const gate = composerGate(state.transcript, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
});
