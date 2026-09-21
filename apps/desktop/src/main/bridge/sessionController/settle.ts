/** SessionController tests — cancel / lease / completion cue. Loaded by SessionController.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	chromeAwaitingSettlement,
	chromeFromServer,
	chromeRunId,
	createTranscriptState,
	type TranscriptState
} from '@fast-ide/session-view';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from '../SessionController.js';
import {assertSkillCommandPinned} from '../skillSlashContract.js';
import {cueController, withSid} from './kit.js';

test('local cancel drops stray assistant_delta', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: () => 'cid'
	});
	const _bind6 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind6.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'x', eventSeq: 1}));
	assert.equal(controller.cancelRun(), true);
	controller.handleEvent(withSid('sess', {type: 'assistant_delta', turnId: 't1', text: 'ghost', eventSeq: 2}));
	const assistant = controller.getActiveTask()?.transcript.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'cancelled');
	assert.equal(assistant?.text, '');
});

test('user sequence: cancel settle → resubmit stays streaming; third turn accepts content', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const _bind7 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind7.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'c1',
		clientMessageId: 'c1',
		text: '继续寻找方法'
	}));
	controller.handleEvent(withSid('sess', {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}));
	assert.equal(controller.cancelRun('stop'), true);
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 2}));
	assert.equal(controller.canSubmitNow(), true);

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 3,
		turnId: 'c2',
		clientMessageId: 'c2',
		text: '继续'
	}));
	controller.handleEvent(withSid('sess', {type: 'reasoning_delta', turnId: 'c2', text: 'thinking', eventSeq: 4}));
	const a2 = controller.getActiveTask()?.transcript.entries.find(
		e => e.role === 'assistant' && e.turnId === 'c2'
	);
	assert.equal(a2?.status, 'streaming');
	assert.equal(a2?.reasoning, 'thinking');

	assert.equal(controller.cancelRun('stop'), true);
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 5}));
	assert.equal(controller.canSubmitNow(), true);
	sent.length = 0;
	assert.equal(controller.sendMessage('继续'), true);
	assert.equal(sent.some(c => c.type === 'SubmitUserMessage'), true);

	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 6,
		turnId: 'c3',
		clientMessageId: 'c3',
		text: '继续'
	}));
	controller.handleEvent(withSid('sess', {type: 'reasoning_delta', turnId: 'c3', text: 'plan', eventSeq: 7}));
	const a3 = controller.getActiveTask()?.transcript.entries.find(
		e => e.role === 'assistant' && e.turnId === 'c3'
	);
	assert.equal(a3?.status, 'streaming');
	assert.equal(a3?.reasoning, 'plan');
});

test('cancel → CancelAssociated; turn_cancelled unlocks; no host drain (V6)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const _bind8 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind8.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'first'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	}));
	assert.equal(chromeRunId(controller.getActiveTask()?.transcript.chrome), '019f-server-run');
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.canSubmitNow(), false);

	assert.equal(controller.sendMessage('queued follow-up'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage' && c.text === 'queued follow-up'));
	controller.handleEvent(
		withSid('sess', {
			type: 'follow_up_changed',
			paused: false,
			itemsJson: JSON.stringify([{id: 'fu-a', text: 'queued follow-up', order: 0}])
		})
	);
	assert.equal(controller.getActiveTask()?.queue.length, 1);

	sent.length = 0;
	assert.equal(controller.cancelRun('stop'), true);
	const cancel = sent.find(c => c.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(chromeAwaitingSettlement(controller.getActiveTask()?.transcript.chrome), true);
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.canSubmitNow(), false);
	assert.equal(controller.canEnqueue(), true, 'Stopping allows Follow-up submit');
	assert.equal(controller.gate().runState, 'stopping');
	assert.equal(controller.sendMessage('during cancel'), true);
	assert.ok(sent.some(c => c.type === 'SubmitUserMessage' && c.text === 'during cancel'));

	sent.length = 0;
	controller.handleEvent(withSid('sess', {type: 'turn_cancelled', reason: 'stop', eventSeq: 2}));
	assert.equal(chromeAwaitingSettlement(controller.getActiveTask()?.transcript.chrome), false);
	assert.equal(controller.isRunActive(), false);
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.getActiveTask()?.queue.length, 1, 'projection unchanged until follow_up_changed');
	assert.equal(sent.filter(c => c.type === 'SubmitUserMessage').length, 0);

	assert.equal(controller.sendMessage('after settle'), true);
	const submits = sent.filter(c => c.type === 'SubmitUserMessage');
	assert.equal(submits.length, 1);
	if (submits[0]?.type === 'SubmitUserMessage') {
		assert.equal(submits[0].text, 'after settle');
	}
});

test('cancel settlement timeout unlocks submit when turn_cancelled never arrives', async () => {
	const sent: BridgeCommand[] = [];
	let changes = 0;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		cancelSettlementTimeoutMs: 30,
		onChange: () => {
			changes += 1;
		}
	});
	const _bind9 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind9.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'first'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(chromeAwaitingSettlement(controller.getActiveTask()?.transcript.chrome), true);
	assert.equal(controller.canSubmitNow(), false);

	await new Promise(r => setTimeout(r, 80));
	assert.equal(chromeAwaitingSettlement(controller.getActiveTask()?.transcript.chrome), false);
	assert.equal(controller.isRunActive(), false);
	assert.equal(controller.canSubmitNow(), true);
	assert.ok(changes >= 1, 'onChange must fire so UI can unlock');
	assert.equal(controller.sendMessage('after timeout'), true);
});

test('cancel settlement timers are per-task: arming B does not disarm A', async () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
		cancelSettlementTimeoutMs: 30
	});
	const a = controller.createTask('A');
	controller.acceptNewSession('sess-a', a.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent(withSid('sess-a', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_a',
		clientMessageId: 'client_a',
		text: 'run a'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(chromeAwaitingSettlement(controller.listTasks().find(t => t.id === a.id)?.transcript.chrome), true);

	const b = controller.createTask('B');
	controller.acceptNewSession('sess-b', b.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	controller.selectTask(b.id);
	controller.handleEvent(withSid('sess-b', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'client_b',
		clientMessageId: 'client_b',
		text: 'run b'
	}));
	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(chromeAwaitingSettlement(controller.listTasks().find(t => t.id === b.id)?.transcript.chrome), true);
	assert.equal(chromeAwaitingSettlement(controller.listTasks().find(t => t.id === a.id)?.transcript.chrome), true);

	await new Promise(r => setTimeout(r, 80));
	assert.equal(
		chromeAwaitingSettlement(controller.listTasks().find(t => t.id === a.id)?.transcript.chrome),
		false,
		'A watchdog must fire even after B armed its own'
	);
	assert.equal(chromeAwaitingSettlement(controller.listTasks().find(t => t.id === b.id)?.transcript.chrome), false);
});

test('run lease expiry attaches then locally settles after grace', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'assistant_delta',
		eventSeq: 2,
		turnId: 'run-1',
		text: 'hello'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	assert.equal(controller.getActiveTask()?.transcript.leaseAware, true);
	assert.equal(controller.gate().runState, 'running');

	now = 1_000 + 16_000;
	sent.length = 0;
	controller.tickRunLeases();
	assert.ok(sent.some(c => c.type === 'AttachSession'));
	assert.equal(controller.gate().runState, 'running', 'grace keeps chrome busy');

	now += 5_000;
	controller.tickRunLeases();
	assert.equal(chromeRunId(controller.getActiveTask()?.transcript.chrome), undefined);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.consumeHelpNotice(), 'errors.lease.expired');
	controller.reset();
});

test('run lease does not expire before a run_state (legacy engine)', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	now = 1_000 + 60_000;
	controller.tickRunLeases();
	assert.equal(sent.some(c => c.type === 'AttachSession' && 'lastEventSeq' in c && c.lastEventSeq > 0), false);
	assert.equal(controller.gate().runState, 'running');
	controller.reset();
});

test('run lease heartbeat during grace renews and does not settle', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 'run-1',
		clientMessageId: 'c1',
		text: 'hi'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	now = 1_000 + 16_000;
	controller.tickRunLeases();
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'run-1',
		state: 'running',
		ts: now
	}));
	now += 5_000;
	controller.tickRunLeases();
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.consumeHelpNotice(), null);
	controller.reset();
});

test('run lease expires a Goal-only overlay after grace', () => {
	const sent: BridgeCommand[] = [];
	let now = 1_000;
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => now,
		leaseScanIntervalMs: 0,
		createId: () => 'cid'
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'goal_updated',
		goalId: 'g1',
		phase: 'started',
		status: 'running'
	}));
	controller.handleEvent(withSid('sess', {
		type: 'run_state',
		runId: 'goal-run',
		state: 'running',
		ts: now
	}));
	assert.equal(controller.gate().runState, 'running');
	assert.equal(controller.gate().canCancel, false);
	assert.equal(chromeRunId(controller.getActiveTask()?.transcript.chrome), undefined);

	now = 1_000 + 16_000;
	sent.length = 0;
	controller.tickRunLeases();
	assert.ok(sent.some(c => c.type === 'AttachSession'));
	assert.equal(controller.gate().runState, 'running', 'grace keeps Goal chrome busy');

	now += 5_000;
	controller.tickRunLeases();
	assert.equal(controller.getActiveTask()?.goalCard, undefined);
	assert.equal(controller.gate().runState, 'idle');
	assert.equal(controller.canSubmitNow(), true);
	assert.equal(controller.consumeHelpNotice(), 'errors.lease.expired');
	controller.reset();
});

test('cancel without server Run id still sends CancelAssociated (V6 Stop)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'cid'
	});
	const _bind10 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind10.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 'client_only', text: 'early', eventSeq: 1}));
	// Peer-turn pin keeps Composer Gate honest but is NOT a server Run id —
	// Stop uses CancelAssociated over the whole FanOut, never CancelRun('client_only').
	assert.equal(chromeRunId(controller.getActiveTask()?.transcript.chrome), 'client_only');
	assert.equal(chromeFromServer(controller.getActiveTask()?.transcript.chrome), false);

	assert.equal(controller.cancelRun('stop'), true);
	assert.equal(sent.some(c => c.type === 'CancelRun'), false);
	assert.equal(sent.some(c => c.type === 'CancelSession'), false);
	const cancel = sent.find(c => c.type === 'CancelAssociated');
	assert.ok(cancel && cancel.type === 'CancelAssociated');
	assert.equal(chromeAwaitingSettlement(controller.getActiveTask()?.transcript.chrome), true);
});

test('killProc sends KillProc and clears liveProcs optimistically', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-kill'
	});
	const task = controller.createTask('Kill');
	controller.acceptNewSession('sess-kill', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-kill', clientId: 'cli'});
	controller.handleEvent(
		withSid('sess-kill', {
			type: 'proc_updated',
			procId: 'p-stuck',
			status: 'running',
			command: 'sbt test'
		} as BridgeEvent)
	);
	assert.equal(controller.getActiveTask()?.transcript.liveProcs?.length, 1);

	assert.equal(controller.killProc('p-stuck'), true);
	const kill = sent.find(c => c.type === 'KillProc');
	assert.ok(kill && kill.type === 'KillProc');
	assert.equal(kill.procId, 'p-stuck');
	assert.equal(kill.reason, 'user_stopped');
	assert.equal(controller.getActiveTask()?.transcript.liveProcs?.length, 0);
});
test('markEngineLost fails in-flight streaming turn and clears cancel settlement gate', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const _bind13 = controller.createTask('T');
	controller.acceptNewSession('sess', _bind13.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	controller.handleEvent(withSid('sess', {
		type: 'turn_started',
		eventSeq: 1,
		turnId: 't1',
		clientMessageId: 't1',
		text: 'hello'
	}));
	controller.handleEvent(withSid('sess', {type: 'assistant_delta', turnId: 't1', text: 'partial', eventSeq: 2}));
	assert.equal(controller.isRunActive(), true);

	controller.markEngineLost('Engine exited (1)');
	const task = controller.getActiveTask()!;
	assert.equal(controller.isRunActive(), false);
	assert.equal(chromeAwaitingSettlement(task.transcript.chrome), false);
	assert.equal(chromeRunId(task.transcript.chrome), undefined);
	assert.equal(controller.getAttachedSessionId(), null);
	const assistant = task.transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'error');
});
test('turn_finished after a live run offers a completion cue once', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	assert.equal(controller.consumeCompletionCue(), null);
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
	assert.equal(controller.consumeCompletionCue(), null);
});

test('turn_finished success:false still cues; cancel does not', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: false}));
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: false});

	const again = cueController();
	again.controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	again.controller.handleEvent(withSid('sess', {type: 'turn_cancelled', turnId: 't1', reason: 'stop'}));
	assert.equal(again.controller.consumeCompletionCue(), null);
});
test('replay turn_finished without a live run does not cue', () => {
	const {controller} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(controller.consumeCompletionCue(), null);
});

test('run_done after a live run offers a completion cue', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(
		withSid('sess', {type: 'run_done', runId: 't1', success: true, summary: 'ok'})
	);
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
});

test('run_done then late turn_finished cues only once', () => {
	const {controller, task} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(
		withSid('sess', {type: 'run_done', runId: 't1', success: true, summary: 'ok'})
	);
	assert.deepEqual(controller.consumeCompletionCue(), {taskId: task.id, success: true});
	controller.handleEvent(withSid('sess', {type: 'turn_finished', turnId: 't1', success: true}));
	assert.equal(controller.consumeCompletionCue(), null);
});

test('run_cancelled does not cue', () => {
	const {controller} = cueController();
	controller.handleEvent(withSid('sess', {type: 'turn_started', turnId: 't1', text: 'hi'}));
	controller.handleEvent(withSid('sess', {type: 'run_cancelled', runId: 't1', reason: 'stop'}));
	assert.equal(controller.consumeCompletionCue(), null);
});
