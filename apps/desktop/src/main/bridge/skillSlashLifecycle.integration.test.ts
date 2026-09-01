/**
 * Integration: SkillSlash lifecycle through SessionController + Composer Gate.
 *
 * Covers the two Fast regressions we reproduced against a real Bridge:
 *  1. Content done but no turn_finished → next /skill enqueues (Stop lit).
 *  2. ask_user_question → question_requested → Stop must extinguish (canCancel=false)
 *     while composer stays prompt-locked until AnswerQuestion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from './SessionController.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';

function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

function controller() {
	const sent: BridgeCommand[] = [];
	const c = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `cid-${++n}`;
		})()
	});
	return {c, sent};
}

function bootSkillSession(
	c: SessionController,
	sessionId: string,
	skills: string[] = ['grilling', 'explain-code']
) {
	const task = c.createTask('T');
	c.acceptNewSession(sessionId, task.id);
	c.handleEvent({type: 'Attached', sessionId, clientId: 'cli'});
	c.handleEvent({
		type: 'commands_available',
		commands: skills.map(name => ({
			name,
			description: name,
			usage: `/${name}`,
			available: true
		}))
	});
	return task;
}

/** Real Bridge SkillSlash accept + host remap + assistant content. */
function skillSlashLive(
	c: SessionController,
	sessionId: string,
	clientId: string,
	hostRunId: string,
	userText = '/grilling design tree'
) {
	c.handleEvent(
		withSid(sessionId, {
			type: 'input_accepted',
			clientMessageId: clientId,
			turnId: clientId
		})
	);
	c.handleEvent(
		withSid(sessionId, {
			type: 'turn_started',
			turnId: clientId,
			clientMessageId: clientId,
			text: userText
		})
	);
	c.handleEvent(
		withSid(sessionId, {
			type: 'thinking_started',
			turnId: clientId,
			turn: 1,
			maxTurns: 1
		})
	);
	c.handleEvent(
		withSid(sessionId, {
			type: 'input_accepted',
			clientMessageId: clientId,
			turnId: hostRunId
		})
	);
	c.handleEvent(
		withSid(sessionId, {
			type: 'agent_call_started',
			turnId: hostRunId,
			agentId: 'skill-grilling',
			name: 'skill: grilling'
		})
	);
	c.handleEvent(
		withSid(sessionId, {
			type: 'assistant_delta',
			turnId: hostRunId,
			text: '**Top Recommendation:** Candidate 1\n\n这些 candidate 中你想深入探讨哪个？'
		})
	);
}

test('INTEGRATION: SkillSlash content without turn_finished → Stop lit + next skill via Bridge command', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-queue');
	skillSlashLive(c, 'sess-queue', 'client-q', '019f-host-q');

	const gate = c.gate();
	assert.equal(gate.runState, 'running');
	assert.equal(gate.canCancel, true, 'Stop lit while model turn still open');
	assert.equal(gate.canEnqueue, true);
	assert.equal(gate.canSubmitNow, false);

	sent.length = 0;
	assert.equal(c.sendMessage('/grilling continue'), true);
	assert.equal(c.getActiveTask()?.queue.length, 0, 'host queue projection-only');
	assert.ok(sent.some(cmd => cmd.type === 'command' && cmd.name === 'grilling'));
});

test('INTEGRATION: turn_finished after SkillSlash → Stop off + direct submit (no enqueue)', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-finish');
	skillSlashLive(c, 'sess-finish', 'client-f', '019f-host-f');
	c.handleEvent(
		withSid('sess-finish', {
			type: 'agent_call_finished',
			turnId: '019f-host-f',
			agentId: 'skill-grilling',
			success: true
		})
	);
	c.handleEvent(
		withSid('sess-finish', {
			type: 'turn_finished',
			turnId: '019f-host-f',
			success: true
		})
	);

	const gate = c.gate();
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.canSubmitNow, true);
	assert.equal(gate.canEnqueue, false);

	sent.length = 0;
	assert.equal(c.sendMessage('/grilling next'), true);
	assert.equal(c.getActiveTask()?.queue.length, 0);
	assert.ok(sent.some(cmd => cmd.type === 'command' && cmd.name === 'grilling'));
});

test('INTEGRATION: SkillSlash wire turn_finished (no turnId) + stream stragglers → Stop stays off', () => {
	// Captured from real fast-cli SkillSlash: turn_finished has sessionId+success only.
	const {c} = controller();
	bootSkillSession(c, 'sess-straggle');
	skillSlashLive(c, 'sess-straggle', 'client-s', '019f-host-s');
	c.handleEvent(withSid('sess-straggle', {type: 'turn_finished', success: true}));

	assert.equal(c.gate().canCancel, false);
	assert.equal(c.getActiveTask()?.transcript.postRunTerminal, true);

	c.handleEvent(
		withSid('sess-straggle', {
			type: 'assistant_delta',
			turnId: '019f-host-s',
			text: '\nstraggler after settle'
		})
	);
	c.handleEvent(
		withSid('sess-straggle', {
			type: 'tool_started',
			turnId: '019f-host-s',
			id: 'ghost',
			tool: 'shell',
			args: {}
		})
	);

	const gate = c.gate();
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false, 'Stop must not re-light after SkillSlash ended');
	assert.equal(
		c.getActiveTask()?.transcript.entries.some(e => e.status === 'streaming'),
		false
	);
});

test('INTEGRATION: ask_user_question → question_requested extinguishes Stop; composer locked', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-ask');
	skillSlashLive(c, 'sess-ask', 'client-ask', '019f-host-ask');

	c.handleEvent(
		withSid('sess-ask', {
			type: 'tool_started',
			turnId: '019f-host-ask',
			id: 'tool-ask',
			tool: 'ask_user_question',
			args: {question: 'Which candidate?'}
		})
	);
	c.handleEvent(
		withSid('sess-ask', {
			type: 'question_requested',
			id: 'q-1',
			runId: '019f-host-ask',
			turnId: '019f-host-ask',
			question: 'Which candidate?',
			options: [
				{id: 'a', label: 'A'},
				{id: 'b', label: 'B'}
			],
			allowCustom: true
		})
	);

	const gate = c.gate();
	assert.equal(gate.runState, 'idle', 'waiting for user is not model running');
	assert.equal(gate.canCancel, false, 'Stop must extinguish (DialogueComposer binds Stop to canCancel)');
	assert.equal(gate.composerLocked, true);
	assert.equal(gate.lockReason, 'prompt');
	assert.equal(gate.canSubmitNow, false);
	assert.equal(gate.canEnqueue, false);

	const task = c.getActiveTask();
	assert.equal(task?.transcript.questions.length, 1);
	assert.equal(
		task?.transcript.entries.some(e => e.status === 'streaming'),
		false,
		'assistant streaming chrome cleared on question handoff'
	);

	sent.length = 0;
	assert.equal(c.sendMessage('just type in composer'), false, 'prompt lock blocks send/enqueue');
	assert.equal(task?.queue.length, 0);
	assert.equal(sent.length, 0);
});

test('INTEGRATION: AnswerQuestion then turn_finished unlocks composer for next SkillSlash', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-answer');
	skillSlashLive(c, 'sess-answer', 'client-ans', '019f-host-ans');
	c.handleEvent(
		withSid('sess-answer', {
			type: 'question_requested',
			id: 'q-ans',
			runId: '019f-host-ans',
			turnId: '019f-host-ans',
			question: 'Pick one',
			options: [{id: 'a', label: 'A'}],
			allowCustom: false
		})
	);
	assert.equal(c.gate().canCancel, false);
	assert.equal(c.gate().composerLocked, true);

	sent.length = 0;
	assert.equal(c.answerQuestion('q-ans', 'a'), true);
	const answer = sent.find(cmd => cmd.type === 'AnswerQuestion');
	assert.ok(answer && answer.type === 'AnswerQuestion');
	assert.equal(answer.runId, '019f-host-ans');
	assert.equal(answer.questionId, 'q-ans');
	assert.equal(answer.selectedOptionId, 'a');

	c.handleEvent(
		withSid('sess-answer', {
			type: 'question_answered',
			id: 'q-ans',
			runId: '019f-host-ans',
			turnId: '019f-host-ans',
			selectedOptionId: 'a',
			cancelled: false
		})
	);
	// Engine continues the skill turn after answer — may stream again before settle.
	c.handleEvent(
		withSid('sess-answer', {
			type: 'assistant_delta',
			turnId: '019f-host-ans',
			text: 'Got it, continuing…'
		})
	);
	assert.equal(c.gate().runState, 'running');
	assert.equal(c.gate().canCancel, true);

	c.handleEvent(
		withSid('sess-answer', {
			type: 'turn_finished',
			turnId: '019f-host-ans',
			success: true
		})
	);
	assert.equal(c.gate().runState, 'idle');
	assert.equal(c.gate().canCancel, false);
	assert.equal(c.gate().composerLocked, false);
	assert.equal(c.gate().canSubmitNow, true);
});

test('INTEGRATION: approval_requested also extinguishes Stop (same prompt-wait policy)', () => {
	const {c} = controller();
	bootSkillSession(c, 'sess-appr');
	skillSlashLive(c, 'sess-appr', 'client-ap', '019f-host-ap');
	c.handleEvent(
		withSid('sess-appr', {
			type: 'approval_requested',
			id: 'ap-1',
			runId: '019f-host-ap',
			turnId: '019f-host-ap',
			tool: 'shell',
			description: 'rm -rf /tmp/x',
			risk: 'high'
		})
	);
	const gate = c.gate();
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.composerLocked, true);
	assert.equal(gate.lockReason, 'prompt');
});

test('INTEGRATION: cancelRun API still works while question pending (even if Stop UI hidden)', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-cancel-ask');
	skillSlashLive(c, 'sess-cancel-ask', 'client-c', '019f-host-c');
	c.handleEvent(
		withSid('sess-cancel-ask', {
			type: 'question_requested',
			id: 'q-c',
			runId: '019f-host-c',
			turnId: '019f-host-c',
			question: '?',
			options: [{id: 'a', label: 'A'}]
		})
	);
	assert.equal(c.gate().canCancel, false);

	sent.length = 0;
	assert.equal(c.cancelRun('user abort'), true);
	const cancel = sent.find(cmd => cmd.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(c.gate().runState, 'stopping');
	assert.equal(c.gate().canCancel, true, 'Stopping re-enables cancel affordance');
});

test('INTEGRATION: turn_finished success:false + stragglers → Stop off, next skill submits', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-fail');
	skillSlashLive(c, 'sess-fail', 'client-fail', '019f-host-fail');
	c.handleEvent(withSid('sess-fail', {type: 'turn_finished', success: false}));
	assert.equal(c.getActiveTask()?.transcript.postRunTerminal, true);
	assert.equal(c.gate().canCancel, false);

	c.handleEvent(
		withSid('sess-fail', {
			type: 'assistant_delta',
			turnId: '019f-host-fail',
			text: 'late after fail'
		})
	);
	assert.equal(c.gate().runState, 'idle');
	assert.equal(c.gate().canSubmitNow, true);

	sent.length = 0;
	assert.equal(c.sendMessage('/grilling retry'), true);
	assert.equal(c.getActiveTask()?.queue.length, 0);
	assert.ok(sent.some(cmd => cmd.type === 'command' && cmd.name === 'grilling'));
});

test('INTEGRATION: after SkillSlash end + stragglers, second turn_started lifts guard', () => {
	const {c} = controller();
	bootSkillSession(c, 'sess-2nd');
	skillSlashLive(c, 'sess-2nd', 'client-a', '019f-host-a');
	c.handleEvent(withSid('sess-2nd', {type: 'turn_finished', success: true}));
	c.handleEvent(
		withSid('sess-2nd', {
			type: 'tool_started',
			turnId: '019f-host-a',
			id: 'ghost',
			tool: 'shell',
			args: {}
		})
	);
	assert.equal(c.gate().canCancel, false);

	skillSlashLive(c, 'sess-2nd', 'client-b', '019f-host-b', '/grilling round 2');
	assert.equal(c.getActiveTask()?.transcript.postRunTerminal, false);
	assert.equal(c.gate().runState, 'running');
	assert.equal(c.gate().canCancel, true);

	c.handleEvent(withSid('sess-2nd', {type: 'turn_finished', turnId: '019f-host-b', success: true}));
	assert.equal(c.gate().runState, 'idle');
	assert.equal(c.gate().canCancel, false);
});

test('INTEGRATION: approval → decide → finish → straggler; composer ready for next SkillSlash', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-appr-full');
	skillSlashLive(c, 'sess-appr-full', 'client-af', '019f-host-af');
	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'tool_started',
			turnId: '019f-host-af',
			id: 'tw',
			tool: 'write_file',
			args: {path: 'note.md'}
		})
	);
	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'approval_requested',
			id: 'ap-full',
			runId: '019f-host-af',
			turnId: '019f-host-af',
			tool: 'write_file',
			description: 'write note.md'
		})
	);
	assert.equal(c.gate().composerLocked, true);
	assert.equal(c.gate().canCancel, false);

	sent.length = 0;
	assert.equal(c.decideApproval('ap-full', true), true);
	assert.ok(sent.some(cmd => cmd.type === 'DecideApproval' && cmd.approved === true));

	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'approval_resolved',
			id: 'ap-full',
			runId: '019f-host-af',
			turnId: '019f-host-af',
			approved: true
		})
	);
	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'tool_finished',
			turnId: '019f-host-af',
			id: 'tw',
			tool: 'write_file',
			success: true,
			fields: {}
		})
	);
	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'assistant_delta',
			turnId: '019f-host-af',
			text: '\nDone writing.'
		})
	);
	c.handleEvent(withSid('sess-appr-full', {type: 'turn_finished', success: true}));
	c.handleEvent(
		withSid('sess-appr-full', {
			type: 'reasoning_delta',
			turnId: '019f-host-af',
			text: 'straggler think'
		})
	);

	const gate = c.gate();
	assert.equal(gate.runState, 'idle');
	assert.equal(gate.canCancel, false);
	assert.equal(gate.composerLocked, false);
	assert.equal(gate.canSubmitNow, true);
	assert.equal(c.getActiveTask()?.transcript.approvals.length, 0);
});

test('INTEGRATION: mid-SkillSlash busy command; turn_finished does not host-dequeue (E4)', () => {
	const {c, sent} = controller();
	bootSkillSession(c, 'sess-qfinish');
	skillSlashLive(c, 'sess-qfinish', 'client-qf', '019f-host-qf');
	assert.equal(c.sendMessage('/grilling queued-while-running'), true);
	assert.ok(sent.some(cmd => cmd.type === 'command' && cmd.name === 'grilling'));
	assert.equal(c.getActiveTask()?.queue.length, 0);

	sent.length = 0;
	c.handleEvent(withSid('sess-qfinish', {type: 'turn_finished', turnId: '019f-host-qf', success: true}));
	// E4: Session drains Follow-up; host must not auto-submit another skill.
	assert.equal(sent.filter(cmd => cmd.type === 'command' && cmd.name === 'grilling').length, 0);
	assert.equal(sent.filter(cmd => cmd.type === 'SubmitUserMessage').length, 0);
});
