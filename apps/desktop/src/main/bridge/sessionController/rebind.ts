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
	assert.equal(task.transcript.entries.length, 0);
	assert.equal(task.lastEventSeq, 0);
	const detach = sent.find(c => c.type === 'DetachSession');
	assert.ok(detach && detach.type === 'DetachSession' && detach.sessionId === 'sess-old');
	const attach = sent.find(c => c.type === 'AttachSession');
	assert.ok(attach && attach.type === 'AttachSession' && attach.sessionId === 'sess-new');
	assert.equal(attach.lastEventSeq, 0);
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
