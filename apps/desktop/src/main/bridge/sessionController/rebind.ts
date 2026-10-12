/** SessionController tests — rebindTaskSession (main-session restart swap). Loaded by SessionController.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from '../SessionController.js';
import {withSid} from './kit.js';

test('rebindTaskSession swaps a bound row to a new session and resets per-session state', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 1000,
		createId: () => 'fixed-id'
	});

	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-old', clientId: 'cli-test'});
	controller.handleEvent(
		withSid('sess-old', {
			type: 'assistant_delta',
			turnId: 't1',
			text: 'old content',
			eventSeq: 1
		} as BridgeEvent)
	);
	assert.ok(task.transcript.entries.length > 0);

	sent.length = 0;
	const rebound = controller.rebindTaskSession(task.id, 'sess-new');
	assert.equal(rebound, task);
	assert.equal(task.sessionId, 'sess-new');
	assert.equal(task.sessionType, 'main');
	assert.equal(task.transcript.entries.length, 0);
	assert.equal(task.lastEventSeq, 0);
	const detach = sent.find(c => c.type === 'DetachSession');
	assert.ok(detach && detach.type === 'DetachSession' && detach.sessionId === 'sess-old');
	const attach = sent.find(c => c.type === 'AttachSession');
	assert.ok(attach && attach.type === 'AttachSession' && attach.sessionId === 'sess-new');
	assert.equal(attach.lastEventSeq, 0);
});

test('restartMainSession settles with a timeout notice when the engine never replies', async () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true,
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	(controller as unknown as {restartMainTimeoutMs: number}).restartMainTimeoutMs = 10;
	const result = await controller.restartMainSession();
	assert.equal(result.ok, false);
	assert.equal(result.notice, 'Restart timed out');
});

test('restartMainSession settles on engine reset so the sidebar is not stuck', async () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true,
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const pending = controller.restartMainSession();
	controller.reset();
	const result = await pending;
	assert.equal(result.ok, false);
	assert.equal(result.notice, 'Engine reset');
});

test('rebindTaskSession binds the new main session to the open workspace before attach', () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		workspaceId: () => 'ws-hash',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	sent.length = 0;
	controller.rebindTaskSession(task.id, 'sess-new');
	const bindAt = sent.findIndex(c => c.type === 'BindSessionWorkspace');
	const attachAt = sent.findIndex(c => c.type === 'AttachSession' && c.sessionId === 'sess-new');
	const bind = sent[bindAt];
	assert.ok(bind && bind.type === 'BindSessionWorkspace');
	assert.equal(bind.sessionId, 'sess-new');
	assert.equal(bind.workspaceId, 'ws-hash');
	assert.ok(bindAt >= 0 && attachAt > bindAt);
});

test('rebindTaskSession returns null when the task is unknown', () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true,
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	assert.equal(controller.rebindTaskSession('missing-task', 'sess-new'), null);
});

test('acceptNewSession stays a no-op for an already bound row (rebind is the restart path)', () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true,
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	assert.equal(controller.acceptNewSession('sess-other', task.id, 'ws-hash'), null);
	assert.equal(task.sessionId, 'sess-old');
});

test('late RestartMainSession success after a timeout rebinds the main task row', async () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	controller.handleEvent({type: 'Attached', sessionId: 'sess-old', clientId: 'cli-test'});
	task.sessionType = 'main';

	(controller as unknown as {restartMainTimeoutMs: number}).restartMainTimeoutMs = 10;
	assert.equal((await controller.restartMainSession()).ok, false);

	sent.length = 0;
	controller.handleEvent({type: 'command_result', name: 'RestartMainSession', message: 'sess-new'});
	assert.equal(task.sessionId, 'sess-new');
	assert.ok(sent.some(c => c.type === 'DetachSession' && c.sessionId === 'sess-old'));
	const attach = sent.find(c => c.type === 'AttachSession');
	assert.ok(attach && attach.type === 'AttachSession' && attach.sessionId === 'sess-new');
	assert.equal(controller.consumeHelpNotice(), 'notice.restartMain.adopted');
});

test('duplicate late RestartMainSession success for the already-bound session is a no-op', async () => {
	const sent: BridgeCommand[] = [];
	const controller = new SessionController({
		clientId: 'cli-test',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	task.sessionType = 'main';
	(controller as unknown as {restartMainTimeoutMs: number}).restartMainTimeoutMs = 10;
	await controller.restartMainSession();

	controller.handleEvent({type: 'command_result', name: 'RestartMainSession', message: 'sess-new'});
	assert.equal(controller.consumeHelpNotice(), 'notice.restartMain.adopted');
	sent.length = 0;
	controller.handleEvent({type: 'command_result', name: 'RestartMainSession', message: 'sess-new'});
	assert.equal(task.sessionId, 'sess-new');
	assert.equal(sent.length, 0);
	assert.equal(controller.consumeHelpNotice(), null);
});

test('late RestartMainSession error result does not rebind the main task row', async () => {
	const controller = new SessionController({
		clientId: 'cli-test',
		send: () => true,
		now: () => 1000,
		createId: () => 'fixed-id'
	});
	const task = controller.createTask('Main');
	controller.acceptNewSession('sess-old', task.id, 'ws-hash');
	task.sessionType = 'main';
	(controller as unknown as {restartMainTimeoutMs: number}).restartMainTimeoutMs = 10;
	await controller.restartMainSession();

	controller.handleEvent({
		type: 'command_result',
		name: 'RestartMainSession',
		status: 'error',
		message: 'engine refused'
	});
	assert.equal(task.sessionId, 'sess-old');
	assert.equal(controller.consumeHelpNotice(), null);
});
