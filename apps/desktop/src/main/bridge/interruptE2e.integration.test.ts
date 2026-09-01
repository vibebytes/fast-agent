/**
 * Frontend→backend E2E for「插话」(InterruptWithMessage):
 * a real child-process engine (scripts/dev/mock-engine.mjs) speaking NDJSON stdio,
 * driven through the production BridgeClient + SessionController stack.
 *
 * Flow: long streaming turn → busy submit queues a follow-up →「插话」on the
 * queued row → run_cancelled(turn1) precedes turn_started(turn2 with the
 * interrupt text), queue drains, composer returns to idle with turn2 answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {BridgeClient} from './BridgeClient.js';
import {SessionController} from './SessionController.js';

const mockEnginePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../scripts/dev/mock-engine.mjs'
);

async function until<T>(probe: () => T, predicate: (value: T) => boolean, what: string): Promise<T> {
	const deadline = Date.now() + 5000;
	let current = probe();
	while (!predicate(current)) {
		if (Date.now() > deadline) assert.fail(`timeout waiting for ${what}`);
		await new Promise(resolve => setTimeout(resolve, 10));
		current = probe();
	}
	return current;
}

test('插话 interrupts a streaming turn and starts the interrupt turn (frontend→backend)', async () => {
	const sent: BridgeCommand[] = [];
	const events: BridgeEvent[] = [];
	let bridgeError = '';
	let cid = 0;

	const bridge = new BridgeClient({transport: 'stdio'});
	const c = new SessionController({
		clientId: 'e2e-cli',
		send: cmd => {
			sent.push(cmd);
			return bridge.send(cmd);
		},
		createId: () => `cid-${++cid}`
	});

	bridge.start('/tmp', {
		onEvent: event => {
			events.push(event);
			c.handleEvent(event);
		},
		onError: message => {
			bridgeError = message;
		},
		onExit: () => {}
		}, {
			env: {
				FAST_ENGINE_COMMAND: process.execPath,
				FAST_ENGINE_ARGS: mockEnginePath
			}
		});

	try {
		assert.equal(bridgeError, '', `bridge error: ${bridgeError}`);

		const task = c.createTask('插话E2E');
		bridge.send({type: 'command', name: 'new', args: '插话E2E'});
		const restored = await until(
			() => events.find(e => e.type === 'session_restored'),
			Boolean,
			'session_restored'
		) as Extract<BridgeEvent, {type: 'session_restored'}>;
		const sessionId = restored.sessionId;

		c.acceptNewSession(sessionId, task.id);
		await until(() => c.isAttached(sessionId), Boolean, 'Attached');

		assert.equal(c.sendMessage('longrun 请继续深挖这个方向'), true);
		await until(() => c.gate().runState, state => state === 'running', 'turn1 running');

		assert.equal(c.sendMessage('quick override 插话内容'), true);
		await until(() => task.queue.length, length => length === 1, 'follow-up queued');
		assert.equal(task.queue[0].text, 'quick override 插话内容');

		assert.equal(c.interruptQueueItem(task.queue[0].id), true);

		await until(
			() => c.gate().runState,
			state => state === 'idle',
			'interrupt turn finished'
		);
		assert.equal(task.queue.length, 0, 'queue drained after插话');

		const submits = sent.filter(cmd => cmd.type === 'SubmitUserMessage');
		assert.equal(submits.length, 2, 'idle submit + busy follow-up submit');
		const interrupt = sent.find(cmd => cmd.type === 'InterruptWithMessage');
		assert.ok(interrupt, 'InterruptWithMessage went out on the wire');
		assert.equal((interrupt as Extract<BridgeCommand, {type: 'InterruptWithMessage'}>).sessionId, sessionId);
		assert.equal((interrupt as Extract<BridgeCommand, {type: 'InterruptWithMessage'}>).text, 'quick override 插话内容');
		assert.ok((interrupt as Extract<BridgeCommand, {type: 'InterruptWithMessage'}>).itemId?.startsWith('fu_'));

		const indexOf = (match: (e: BridgeEvent) => boolean) => events.findIndex(match);
		const cancelledIdx = indexOf(e => e.type === 'run_cancelled');
		const turn1FinishedIdx = indexOf(e => e.type === 'turn_finished' && e.success === false);
		const turn2StartedIdx = indexOf(
			e => e.type === 'turn_started' && e.text === 'quick override 插话内容'
		);
		assert.ok(cancelledIdx >= 0, 'run_cancelled arrived');
		assert.ok(turn1FinishedIdx >= 0, 'turn1 finished unsuccessful');
		assert.ok(turn2StartedIdx >= 0, 'turn2 started with插话 text');
		assert.ok(cancelledIdx < turn2StartedIdx, 'cancel precedes interrupt turn');
		assert.ok(turn1FinishedIdx < turn2StartedIdx, 'turn1 settlement precedes interrupt turn');

		const finalAnswer = events.find(
			e => e.type === 'final_answer' && e.text === 'Echo: quick override 插话内容'
		);
		assert.ok(finalAnswer, 'turn2 final answer visible in transcript feed');

		const gate = c.gate();
		assert.equal(gate.runState, 'idle');
		assert.equal(gate.canCancel, false);
	} finally {
		bridge.stop?.();
	}
});
