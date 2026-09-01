/**
 * Frontend→backend E2E for「重新生成」(RerunRun):
 * a real child-process engine (scripts/dev/mock-engine.mjs) speaking NDJSON stdio,
 * driven through the production BridgeClient + SessionController stack.
 *
 * Regression context: after a run fails (e.g. FaultCarrier handshake timeout),
 * clicking 重新生成 must re-run the message. When the engine rejects the rerun
 * (busy / target active), the rejection must surface ONLY as the conversation
 * banner — never as a painted transcript error card repeating the busy text
 * next to the real failure card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {BridgeClient} from './BridgeClient.js';
import {SessionController, rerunErrorCode} from './SessionController.js';

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

interface Harness {
	bridge: BridgeClient;
	c: SessionController;
	task: ReturnType<SessionController['createTask']>;
	sessionId: string;
	events: BridgeEvent[];
	sent: BridgeCommand[];
}

async function startHarness(title: string, env?: Record<string, string>): Promise<Harness> {
	const sent: BridgeCommand[] = [];
	const events: BridgeEvent[] = [];
	let bridgeError = '';
	let cid = 0;

	const bridge = new BridgeClient({transport: 'stdio'});
	const c = new SessionController({
		clientId: 'rerun-e2e-cli',
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
			FAST_ENGINE_ARGS: mockEnginePath,
			...(env ?? {})
		}
	});
	assert.equal(bridgeError, '', `bridge error: ${bridgeError}`);

	const task = c.createTask(title);
	bridge.send({type: 'command', name: 'new', args: title});
	const restored = await until(
		() => events.find(e => e.type === 'session_restored'),
		Boolean,
		'session_restored'
	) as Extract<BridgeEvent, {type: 'session_restored'}>;

	c.acceptNewSession(restored.sessionId, task.id);
	await until(() => c.isAttached(restored.sessionId), Boolean, 'Attached');
	return {bridge, c, task, sessionId: restored.sessionId, events, sent};
}

const lastRunId = (events: BridgeEvent[]): string | null => {
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const e = events[i];
		if ((e.type === 'run_done' || e.type === 'run_failed') && 'runId' in e) return e.runId;
	}
	return null;
};

test('regenerate after a failed run re-runs the message end-to-end', async () => {
	const h = await startHarness('重跑E2E-成功');
	try {
		// 1) Original run fails like the production FaultCarrier handshake timeout.
		assert.equal(h.c.sendMessage('fail-turn 帮我查一下'), true);
		await until(() => h.c.gate().runState, state => state === 'idle', 'failed run settles');
		const failedRunId = await until(() => lastRunId(h.events), Boolean, 'run_failed observed');
		assert.ok(failedRunId, 'failed run id observed');

		// 2) Regenerate click → RerunRun accepted on the wire → a fresh turn starts.
		assert.equal(h.c.rerunRun(failedRunId), true);
		const rerunResultIdx = await until(
			() =>
				h.events.findIndex(
					e => e.type === 'command_result' && e.name === 'RerunRun' && e.status === 'accepted'
				),
			idx => idx >= 0,
			'rerun command_result accepted'
		);
		const rerunTurnIdx = await until(
			() => h.events.findIndex((e, i) => i > rerunResultIdx && e.type === 'turn_started'),
			idx => idx >= 0,
			'turn_started after accepted rerun'
		);
		assert.ok(rerunTurnIdx > rerunResultIdx, 'rerun turn starts only after acceptance');
		await until(() => h.c.gate().runState, state => state === 'idle', 'replayed failing turn settles');

		const rerunCmd = h.sent.find(cmd => cmd.type === 'RerunRun') as
			| Extract<BridgeCommand, {type: 'RerunRun'}>
			| undefined;
		assert.ok(rerunCmd, 'RerunRun went out on the wire');
		assert.equal(rerunCmd?.sessionId, h.sessionId);
		assert.equal(rerunCmd?.runId, failedRunId);

		// 3) A healthy run regenerates cleanly and produces its answer.
		assert.equal(h.c.sendMessage('普通消息'), true);
		await until(() => h.c.gate().runState, state => state === 'idle', 'healthy turn settles');
		const healthyRunId = await until(() => lastRunId(h.events), Boolean, 'healthy run observed');
		assert.ok(healthyRunId);
		assert.equal(h.c.rerunRun(healthyRunId), true);
		await until(
			() => h.events.find(e => e.type === 'final_answer' && e.text === 'Echo: 普通消息'),
			Boolean,
			'regenerated final answer'
		);
		await until(() => h.c.gate().runState, state => state === 'idle', 'regenerated turn settles');
	} finally {
		h.bridge.stop?.();
	}
});

for (const detail of ['session_busy', 'rerun_target_active']) {
	test(`rejected rerun (${detail}) surfaces once — no transcript error card fan-out`, async () => {
		const h = await startHarness(`重跑E2E-${detail}`, {FAST_MOCK_RERUN_REJECT: detail});
		try {
			assert.equal(h.c.sendMessage('普通消息'), true);
			await until(() => h.c.gate().runState, state => state === 'idle', 'first turn settles');
			const firstRunId = await until(() => lastRunId(h.events), Boolean, 'run_done observed');
			assert.ok(firstRunId);

			const entriesBefore = h.task.transcript.entries.length;
			assert.equal(h.c.rerunRun(firstRunId), true);

			await until(
				() =>
					h.events.some(
						e => e.type === 'command_result' && e.name === 'RerunRun' && e.status === 'rejected'
					),
				Boolean,
				'rejection command_result'
			);
			await new Promise(resolve => setTimeout(resolve, 120));

			assert.equal(
				h.task.transcript.entries.length,
				entriesBefore,
				'rejection must NOT paint a transcript error entry'
			);
			const busyCards = h.task.transcript.entries.filter(
				e => e.role === 'assistant' && e.status === 'error'
			);
			assert.equal(busyCards.length, 0, 'no busy-text error card next to the real failure');
			assert.equal(rerunErrorCode(detail), `rerun.${detail === 'session_busy' ? 'session_busy' : 'target_active'}`);
		} finally {
			h.bridge.stop?.();
		}
	});
}
