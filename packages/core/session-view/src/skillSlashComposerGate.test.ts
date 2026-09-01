/**
 * Evidence for the Fast IDE SkillSlash queue bug (screenshot: "1 Queued" + Stop lit
 * after skill content already rendered).
 *
 * Composer Gate treats any streaming assistant / activeRunId as running. If Bridge
 * never emits turn_finished after SkillSlash, the next /skill is enqueued.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyBridgeEvent, createTranscriptState} from './transcriptProjection.js';
import {composerGate} from './composerGate.js';

function skillSlashLive(clientId: string, hostRunId: string) {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: clientId,
		turnId: clientId
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: clientId,
		clientMessageId: clientId,
		text: '/demo-skill'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: clientId,
		turnId: hostRunId
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: hostRunId,
		text: 'skill body looks done…'
	});
	return state;
}

test('SkillSlash content without turn_finished keeps Composer running → next message enqueues', () => {
	const state = skillSlashLive('client-1', '019f-host');
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'running');
	assert.equal(gate.canEnqueue, true);
	assert.equal(gate.canSubmitNow, false);
	assert.ok(state.activeRunId === '019f-host' || state.entries.some(e => e.status === 'streaming'));
});

test('turn_finished after SkillSlash unlocks Composer (submit now, no enqueue)', () => {
	let state = skillSlashLive('client-2', '019f-host-2');
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: '019f-host-2', success: true});
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canSubmitNow, true);
	assert.equal(gate.canEnqueue, false);
	assert.equal(state.activeRunId, undefined);
	assert.equal(
		state.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('ask_user_question handoff: question_requested extinguishes Stop (canCancel)', () => {
	// Real Bridge order from repro-skillslash-stuck-stop.mjs FIXTURE=ask
	let state = skillSlashLive('client-ask', '019f-ask-host');
	state = applyBridgeEvent(state, {
		type: 'question_requested',
		id: 'q-1',
		runId: '019f-ask-host',
		turnId: '019f-ask-host',
		question: 'Which candidate?',
		options: [
			{id: 'a', label: 'A'},
			{id: 'b', label: 'B'}
		],
		allowCustom: true
	});
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false, 'Stop must not stay lit while waiting for user');
	assert.equal(gate.composerLocked, true);
	assert.equal(state.questions.length, 1);
	assert.equal(
		state.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('pipeline: question → answer → resume streaming → turn_finished restores Submit', () => {
	let state = skillSlashLive('client-pipe', '019f-pipe-host');
	state = applyBridgeEvent(state, {
		type: 'question_requested',
		id: 'q-pipe',
		runId: '019f-pipe-host',
		turnId: '019f-pipe-host',
		question: 'Pick',
		options: [{id: 'a', label: 'A'}],
		allowCustom: false
	});
	assert.equal(composerGate(state, true).canCancel, false);

	state = applyBridgeEvent(state, {
		type: 'question_answered',
		id: 'q-pipe',
		runId: '019f-pipe-host',
		turnId: '019f-pipe-host',
		selectedOptionId: 'a',
		cancelled: false
	});
	assert.equal(state.questions.length, 0);
	// After answer, activeRunId remains until turn_finished; without streaming yet
	// gate may still see activeRunId as running.
	assert.ok(state.activeRunId === '019f-pipe-host');

	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-pipe-host',
		text: 'continuing'
	});
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true).canCancel, true);

	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: '019f-pipe-host',
		success: true
	});
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
	assert.equal(gate.composerLocked, false);
});

test('approval_requested clears streaming and extinguishes Stop', () => {
	let state = skillSlashLive('client-ap', '019f-ap-host');
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: '019f-ap-host',
		turnId: '019f-ap-host',
		tool: 'shell',
		description: 'dangerous',
		risk: 'high'
	});
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.composerLocked, true);
	assert.equal(state.approvals.length, 1);
	assert.equal(
		state.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('SkillSlash wire turn_finished (no turnId) arms postRunTerminal and unlocks Composer', () => {
	let state = skillSlashLive('client-wire', '019f-wire-host');
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true, sessionId: 'sess'});
	assert.equal(state.postRunTerminal, true);
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
});

test('after SkillSlash end, straggler assistant_delta/tool_* must not re-light Stop', () => {
	let state = skillSlashLive('client-strag', '019f-strag-host');
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true});
	const textBefore = state.entries.find(e => e.role === 'assistant')?.text;
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-strag-host',
		text: '\nstraggler'
	});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: '019f-strag-host',
		text: 'late think'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: '019f-strag-host',
		id: 'late-tool',
		tool: 'shell',
		args: {command: 'echo x'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: '019f-strag-host',
		id: 'late-tool',
		tool: 'shell',
		stream: 'stdout',
		text: 'out'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: '019f-strag-host',
		id: 'late-tool',
		tool: 'shell',
		success: true,
		fields: {}
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, textBefore);
	assert.equal(state.entries.some(e => e.status === 'streaming'), false);
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
});

test('turn_finished success:false still arms straggler guard and extinguishes Stop', () => {
	let state = skillSlashLive('client-fail', '019f-fail-host');
	state = applyBridgeEvent(state, {type: 'turn_finished', success: false});
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'error');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-fail-host',
		text: 'ghost'
	});
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'error');
});

test('next SkillSlash turn after postRunTerminal lifts guard and can run again', () => {
	let state = skillSlashLive('client-n1', '019f-n1-host');
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true});
	assert.equal(state.postRunTerminal, true);
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-n1-host',
		text: 'ignored straggler'
	});

	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client-n2',
		turnId: 'client-n2'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-n2',
		clientMessageId: 'client-n2',
		text: '/grilling again'
	});
	assert.equal(state.postRunTerminal, false);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client-n2',
		turnId: '019f-n2-host'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-n2-host',
		text: 'second turn live'
	});
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true).canCancel, true);
});

test('approval resolve then turn_finished: stragglers stay idle (full SkillSlash tool path)', () => {
	let state = skillSlashLive('client-ap2', '019f-ap2-host');
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: '019f-ap2-host',
		id: 't-write',
		tool: 'write_file',
		args: {path: 'x.md'}
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-2',
		runId: '019f-ap2-host',
		turnId: '019f-ap2-host',
		tool: 'write_file',
		description: 'write x.md'
	});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'approval_resolved',
		id: 'ap-2',
		runId: '019f-ap2-host',
		turnId: '019f-ap2-host',
		approved: true
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: '019f-ap2-host',
		id: 't-write',
		tool: 'write_file',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-ap2-host',
		text: '\n写完了。'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: '019f-ap2-host',
		text: 'late'
	});
	const gate = composerGate(state, true);
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
	assert.equal(state.approvals.length, 0);
});
