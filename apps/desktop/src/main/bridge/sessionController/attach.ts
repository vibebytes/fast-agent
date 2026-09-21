/** SessionController tests — Attach / Bind / heartbeat / seq. Loaded by SessionController.test.ts. */
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

test('SessionController new task sends CreateSession with path-hash then Attach', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		projectId: () => 'proj-1',
		workspaceId: () => 'ws-hash-1',
		now: () => 1000,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});

	const task = controller.createTask('First task');
	assert.equal(task.title, 'First task');
	assert.equal(task.sessionId, null);
	assert.equal(sent[0]?.type, 'CreateSession');
	if (sent[0]?.type === 'CreateSession') {
		assert.equal(sent[0].projectId, 'proj-1');
		assert.equal(sent[0].title, 'First task');
		assert.equal(sent[0].taskId, task.id);
		// Hosted path-hash → Engine bindHash (skips GetWorkspaceMeta); not Meta UUID.
		assert.equal(sent[0].workspaceId, 'ws-hash-1');
	}
	assert.equal(controller.canSendMessage(), false);

	// Hub passes engineBoundHash from command_result — skip redundant Bind.
	controller.acceptNewSession('engine-sess-1', task.id, 'ws-hash-1');
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'Engine already bound — Attach only'
	);
	const attach = sent.find(c => c.type === 'AttachSession');
	assert.ok(attach);
	if (attach?.type === 'AttachSession') {
		assert.equal(attach.sessionId, 'engine-sess-1');
		assert.equal(attach.lastEventSeq, 0);
		assert.equal(attach.limit, 20);
	}
	assert.equal(controller.getActiveTask()?.sessionId, 'engine-sess-1');
	assert.equal(controller.canSendMessage(), true);

	sent.length = 0;
	assert.equal(controller.renameTask(task.id, 'Renamed'), true);
	const titleCmd = sent.find(c => c.type === 'SetSessionTitle');
	assert.ok(titleCmd);
	if (titleCmd.type === 'SetSessionTitle') {
		assert.equal(titleCmd.sessionId, 'engine-sess-1');
		assert.equal(titleCmd.title, 'Renamed');
	}
	assert.equal(controller.getActiveTask()?.title, 'Renamed');

	controller.handleEvent({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Renamed"',
		status: 'success',
		sessionId: 'engine-sess-1'
	});
	assert.equal(controller.getActiveTask()?.title, 'Renamed');

	sent.length = 0;
	const ok = controller.sendMessage('build it');
	assert.equal(ok, true);
	const submit = sent.find(c => c.type === 'SubmitUserMessage');
	assert.ok(submit);
	if (submit?.type === 'SubmitUserMessage') {
		assert.equal(submit.sessionId, 'engine-sess-1');
		assert.equal(submit.text, 'build it');
		assert.equal(submit.useModel, undefined);
	}
});
test('SessionController acks eventSeq and heartbeats all attached Sessions', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 42,
		createId: () => 'fixed-id'
	});

	const ackTask = controller.createTask('T');
	controller.acceptNewSession('sess-a', ackTask.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli-test'});
	sent.length = 0;

	controller.handleEvent(withSid('sess-a', {
		type: 'assistant_delta',
		turnId: 't1',
		text: 'x',
		eventSeq: 1
	} as BridgeEvent));

	assert.equal(sent[0]?.type, 'Ack');
	if (sent[0]?.type === 'Ack') {
		assert.equal(sent[0].lastEventSeq, 1);
		assert.equal(sent[0].sessionId, 'sess-a');
	}

	sent.length = 0;
	controller.tickHeartbeat();
	const heartbeat = sent.find(cmd => cmd.type === 'Heartbeat');
	assert.ok(heartbeat);
	assert.equal(heartbeat.sessionId, 'sess-a');
	assert.equal(heartbeat.atMillis, 42);
});

test('selectTask re-Attaches when transcript empty and session_restored never arrived', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Old');
	controller.acceptNewSession('sess-miss', task.id);
	assert.ok(controller.isAttached('sess-miss'));
	assert.equal(controller.getActiveTask()?.transcript.entries.length, 0);

	sent.length = 0;
	controller.selectTask(task.id);
	assert.ok(
		sent.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-miss'),
		'must re-Attach to recover missing history'
	);
});

test('selectTask does not re-Attach after empty session_restored', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Empty hist');
	controller.acceptNewSession('sess-empty', task.id);
	controller.handleEvent({type: 'session_restored', sessionId: 'sess-empty', turns: []});

	sent.length = 0;
	controller.selectTask(task.id);
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'empty-but-restored session must not loop Attach'
	);
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'restored session must not re-Bind on every select'
	);
});

test('selectTask without workspaceId requests Register and skips Attach', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('Needs bind');
	controller.acceptNewSession('sess-boot', task.id);
	sent.length = 0;
	registerCalls = 0;
	controller.selectTask(task.id);
	assert.equal(registerCalls, 1, 'must request Register before Bind/Attach');
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'must not Attach while workspaceId is missing (pins boot cwd)'
	);
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'must not Bind without workspaceId'
	);
});

test('ensureLive without workspaceId does not Attach (retry after Register)', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	controller.hydrateFromMeta([{id: 'sess-wait', title: 'Wait', status: 'active'}]);
	const task = controller.listTasks().find(t => t.sessionId === 'sess-wait');
	assert.ok(task);
	controller.ensureLive(task.id, {focus: false});
	assert.equal(registerCalls, 1);
	assert.equal(controller.isAttached('sess-wait'), false);
	assert.equal(sent.find(c => c.type === 'BindSessionWorkspace'), undefined);
	assert.equal(sent.find(c => c.type === 'AttachSession'), undefined);
});

test('ensureLive Bind+Attach without moving focus (Open Tab background)', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-bg', title: 'Background', status: 'active'},
		{id: 'sess-focus', title: 'Focused', status: 'active'}
	]);
	const focused = controller.listTasks().find(t => t.sessionId === 'sess-focus');
	const bg = controller.listTasks().find(t => t.sessionId === 'sess-bg');
	assert.ok(focused && bg);
	controller.selectTask(focused.id);
	assert.equal(controller.getActiveTask()?.id, focused.id);
	sent.length = 0;
	const live = controller.ensureLive(bg.id, {focus: false});
	assert.ok(live);
	assert.equal(controller.getActiveTask()?.id, focused.id, 'must not steal focus');
	assert.ok(
		sent.some(
			c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-bg'
		),
		'must Bind background Open Tab session'
	);
	assert.ok(
		sent.some(c => c.type === 'AttachSession' && c.sessionId === 'sess-bg'),
		'must Attach background Open Tab session'
	);
	sent.length = 0;
	controller.ensureLive(bg.id, {focus: false});
	assert.equal(
		sent.find(c => c.type === 'BindSessionWorkspace'),
		undefined,
		'already attached background must not re-Bind'
	);
});

test('selectTask is ensureLive with focus', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	controller.hydrateFromMeta([
		{id: 'sess-a', title: 'A', status: 'active'},
		{id: 'sess-b', title: 'B', status: 'active'}
	]);
	const a = controller.listTasks().find(t => t.sessionId === 'sess-a');
	const b = controller.listTasks().find(t => t.sessionId === 'sess-b');
	assert.ok(a && b);
	controller.selectTask(a.id);
	assert.equal(controller.getActiveTask()?.id, a.id);
	sent.length = 0;
	controller.selectTask(b.id);
	assert.equal(controller.getActiveTask()?.id, b.id);
	assert.ok(sent.some(c => c.type === 'BindSessionWorkspace' && c.sessionId === 'sess-b'));
});

test('SessionController selectTask keeps prior Attach and routes by sessionId', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		workspaceId: () => 'ws-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `s${++n}`;
		})()
	});

	const taskA = controller.createTask('A');
	controller.acceptNewSession('sess-a', taskA.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	controller.handleEvent({
		type: 'session_restored',
		sessionId: 'sess-a',
		turns: [{turnId: 't-a', userText: 'hi a', assistantText: 'a', tools: []}]
	});
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', text: 'a', eventSeq: 5} as BridgeEvent));

	const taskB = controller.createTask('B');
	controller.acceptNewSession('sess-b', taskB.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});
	controller.handleEvent({type: 'session_restored', sessionId: 'sess-b', turns: []});
	assert.ok(controller.isAttached('sess-a'));
	assert.ok(controller.isAttached('sess-b'));

	sent.length = 0;
	controller.selectTask(taskA.id);

	// Multi-Attach: switching focus must not Detach the other Session.
	assert.equal(
		sent.find(c => c.type === 'DetachSession'),
		undefined
	);
	assert.equal(
		sent.find(c => c.type === 'AttachSession'),
		undefined,
		'A was already attached — no re-Attach'
	);
	assert.equal(controller.getActiveTask()?.id, taskA.id);
	assert.equal(controller.canSendMessage(), true);

	const beforeA = [...(controller.listTasks().find(t => t.id === taskA.id)?.transcript.entries ?? [])]
		.map(e => e.text)
		.join('');
	controller.handleEvent(
		withSid('sess-b', {
			type: 'turn_started',
			eventSeq: 1,
			turnId: 'tb',
			clientMessageId: 'tb',
			text: 'ask B'
		})
	);
	controller.handleEvent(
		withSid('sess-b', {
			type: 'assistant_delta',
			turnId: 'tb',
			text: 'from-b',
			eventSeq: 2
		} as BridgeEvent)
	);
	assert.equal(
		[...(controller.listTasks().find(t => t.id === taskA.id)?.transcript.entries ?? [])]
			.map(e => e.text)
			.join(''),
		beforeA
	);
	const textB = [...(controller.listTasks().find(t => t.id === taskB.id)?.transcript.entries ?? [])]
		.map(e => e.text)
		.join('');
	assert.ok(textB.includes('from-b'), `expected B transcript to include from-b, got ${textB}`);
});

test('SessionController heartbeats every attached Session', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 99,
		createId: (() => {
			let n = 0;
			return () => `h${++n}`;
		})()
	});
	const hbA = controller.createTask('A');
	controller.acceptNewSession('sess-a', hbA.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli'});
	const hbB = controller.createTask('B');
	controller.acceptNewSession('sess-b', hbB.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-b', clientId: 'cli'});

	sent.length = 0;
	controller.tickHeartbeat();
	const beats = sent.filter(c => c.type === 'Heartbeat');
	assert.equal(beats.length, 2);
	const ids = new Set(beats.map(c => (c.type === 'Heartbeat' ? c.sessionId : '')));
	assert.ok(ids.has('sess-a'));
	assert.ok(ids.has('sess-b'));
});
test('markEngineLost lease drop clears Attach but keeps the in-flight turn', () => {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true
	});
	const row = controller.createTask('T');
	controller.acceptNewSession('sess', row.id);
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

	controller.markEngineLost('Connection lost (unknown)', {failTurns: false});
	const task = controller.getActiveTask()!;
	assert.equal(controller.isRunActive(), true);
	assert.equal(controller.getAttachedSessionId(), null);
	const assistant = task.transcript.entries.find(e => e.role === 'assistant');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'streaming');
});
test('acceptNewSession with workspaceId sends Bind before Attach', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-aw',
		workspaceId: () => 'hash-agent-work',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-new'
	});
	const task = controller.createTask('Bind first');
	sent.length = 0;
	controller.acceptNewSession('sess-new', task.id);
	const bindIdx = sent.findIndex(c => c.type === 'BindSessionWorkspace');
	const attachIdx = sent.findIndex(c => c.type === 'AttachSession');
	assert.ok(bindIdx >= 0, 'BindSessionWorkspace required');
	assert.ok(attachIdx >= 0, 'AttachSession required');
	assert.ok(bindIdx < attachIdx, 'Bind must precede Attach');
	const bind = sent[bindIdx];
	if (bind?.type === 'BindSessionWorkspace') {
		assert.equal(bind.sessionId, 'sess-new');
		assert.equal(bind.workspaceId, 'hash-agent-work');
	}
});

test('acceptNewSession without workspaceId requests Register and still Attaches', () => {
	const sent: BridgeCommand[] = [];
	let registerCalls = 0;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => undefined,
		requestRegister: () => {
			registerCalls += 1;
		},
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-reg'
	});
	const task = controller.createTask('Needs register');
	sent.length = 0;
	registerCalls = 0;
	controller.acceptNewSession('sess-reg', task.id);
	assert.equal(registerCalls, 1);
	assert.equal(sent.find(c => c.type === 'BindSessionWorkspace'), undefined);
	assert.ok(sent.find(c => c.type === 'AttachSession'));
	assert.equal(controller.getActiveTask()?.sessionId, 'sess-reg');
});

test('createTask stamps path-hash workspaceId on CreateSession when Slot known', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'a1b2c3d4e5f6',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-no-ws'
	});
	controller.createTask('Has slot');
	const create = sent.find(c => c.type === 'CreateSession');
	assert.ok(create && create.type === 'CreateSession');
	if (create?.type === 'CreateSession') {
		assert.equal(create.workspaceId, 'a1b2c3d4e5f6');
	}
});

test('acceptNewSession Binds when engineBoundHash missing or mismatches', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'proj-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-bind-fallback'
	});
	const task = controller.createTask('Needs bind');
	sent.length = 0;
	controller.acceptNewSession('sess-boot', task.id, 'boot-hash');
	const bind = sent.find(c => c.type === 'BindSessionWorkspace');
	assert.ok(bind && bind.type === 'BindSessionWorkspace');
	if (bind?.type === 'BindSessionWorkspace') {
		assert.equal(bind.workspaceId, 'proj-hash');
	}
	assert.ok(sent.find(c => c.type === 'AttachSession'));
});

test('retryPendingNew is no-op when CreateSession already requested', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => 'proj-1',
		workspaceId: () => 'hash-after-register',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-retry'
	});
	controller.createTask('Retry me');
	assert.equal(controller.getActiveTask()?.pendingNew, true);
	assert.equal(controller.getActiveTask()?.createRequested, true);
	sent.length = 0;
	assert.equal(controller.retryPendingNew(), false, 'must not double CreateSession');
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 0);
});

test('retryPendingNew sends once when create was waiting on projectId', () => {
	const sent: BridgeCommand[] = [];
	let projectId: string | undefined;
	const controller = new SessionController({
		clientId: 'cli',
		projectId: () => projectId,
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: () => 'task-wait-proj'
	});
	controller.createTask('Wait for meta');
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 0);
	assert.equal(controller.getActiveTask()?.createRequested, false);
	projectId = 'proj-1';
	assert.equal(controller.retryPendingNew(), true);
	assert.equal(sent.filter(c => c.type === 'CreateSession').length, 1);
	assert.equal(controller.retryPendingNew(), false);
});
test('SessionController holds assistant_delta across a seq hole and does not Ack past it', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		}
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-a', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess-a', clientId: 'cli-test'});
	controller.handleEvent(withSid('sess-a', {type: 'turn_started', turnId: 't1', text: 'hi', eventSeq: 1} as BridgeEvent));
	sent.length = 0;
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 't1', text: 'c', eventSeq: 3} as BridgeEvent));
	const afterHole = controller.listTasks()[0]!;
	assert.doesNotMatch(afterHole.transcript.entries.map(e => e.text).join(''), /c/);
	assert.equal(afterHole.lastEventSeq, 1);
	assert.ok(sent.some(c => c.type === 'AttachSession' && c.lastEventSeq === 1));
	controller.handleEvent(withSid('sess-a', {type: 'assistant_delta', turnId: 't1', text: 'b', eventSeq: 2} as BridgeEvent));
	const done = controller.listTasks()[0]!;
	assert.equal(done.transcript.entries.find(e => e.role === 'assistant')?.text, 'bc');
	assert.equal(done.lastEventSeq, 3);
});
test('ready without eventSeq does not reset lastEventSeq', () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess-a', task.id);
	const got = controller.listTasks()[0]!;
	got.lastEventSeq = 7;
	controller.handleEvent({type: 'ready', protocolVersion: 1});
	assert.equal(controller.listTasks()[0]!.lastEventSeq, 7);
});
