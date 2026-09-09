/**
 * L1 full-stack E2E: the real placed engine binary over NDJSON stdio, driven
 * through the production BridgeClient + SessionController, against a stub
 * OpenAI-compatible server. Proves the river events the desktop consumes come
 * out of a real engine turn instead of the mock engine. Exercises the default
 * builtin engine; the DSH/Sbt daemon full-chain is covered by the Scala-side
 * sbt E2E.
 *
 * Requires a placed engine (`fast/scripts/fetch-engine.sh`); skips otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {BridgeClient} from './BridgeClient.js';
import {SessionController} from './SessionController.js';
import {startStubLlm} from './e2e/stubLlmServer.js';
import {engineCommandFor, makeEngineFixture} from './e2e/engineE2eFixture.js';

const PROMPT = '请用一句话回答：stub 在线吗';
const ANSWER = 'stub 在线，一句话回答完毕。';

test('真实引擎跑通一轮 turn 并产出 river 四事件', async t => {
	const stub = await startStubLlm([{text: ANSWER, reasoning: '先想一想。', inputTokens: 33, outputTokens: 11}]);
	const fixture = await makeEngineFixture(stub.baseUrl);
	const command = engineCommandFor(fixture.env);
	if (!command) {
		await stub.close();
		await fixture.cleanup();
		t.skip('no placed engine binary: run fast/scripts/fetch-engine.sh or set FAST_ENGINE_COMMAND');
		return;
	}

	const events: BridgeEvent[] = [];
	const logs: string[] = [];
	let bridgeError = '';
	let exited: {code: number | null; signal: string | null} | null = null;
	let cid = 0;
	const bridge = new BridgeClient({transport: 'stdio'});
	const c = new SessionController({
		clientId: 'engine-e2e',
		send: cmd => bridge.send(cmd),
		createId: () => `cid-${++cid}`
	});

	const note = (line: string) => {
		if (logs.length < 500) logs.push(line);
	};
	const diagnose = () => {
		const kinds: Record<string, number> = {};
		for (const e of events) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
		const statuses = events
			.filter((e): e is Extract<BridgeEvent, {type: 'engine_status'}> => e.type === 'engine_status')
			.map(e => `${e.stage}: ${e.message}`);
		return [
			`events: ${JSON.stringify(kinds)}`,
			`statuses: ${JSON.stringify(statuses.slice(-3))}`,
			`exit: ${JSON.stringify(exited)} bridgeError: ${bridgeError}`,
			`log tail:\n${logs.slice(-40).join('\n')}`
		].join('\n');
	};

	try {
		bridge.start(
			fixture.project,
			{
				onEvent: event => {
					events.push(event);
					c.handleEvent(event);
				},
				onError: message => {
					bridgeError = message;
					note(`[bridge-error] ${message}`);
				},
				onLog: note,
				onExit: (code, signal) => {
					exited = {code, signal};
					note(`[exit] code=${code} signal=${signal}`);
				}
			},
			{
				env: {
					...fixture.env,
					FAST_ENGINE_COMMAND: command[0],
					FAST_ENGINE_ARGS: command.slice(1).join(' ')
				}
			}
		);

		const until = async <T>(probe: () => T, predicate: (value: T) => boolean, what: string): Promise<T> => {
			const deadline = Date.now() + 120_000;
			let current = probe();
			while (!predicate(current)) {
				if (exited) assert.fail(`engine exited before ${what}\n${diagnose()}`);
				if (Date.now() > deadline) assert.fail(`timeout waiting for ${what}\n${diagnose()}`);
				await new Promise(resolve => setTimeout(resolve, 20));
				current = probe();
			}
			return current;
		};

		const task = c.createTask('engine E2E');
		bridge.send({type: 'command', name: 'new', args: 'engine E2E'});
		const restored = (await until(
			() => events.find(e => e.type === 'session_restored'),
			Boolean,
			'session_restored'
		)) as Extract<BridgeEvent, {type: 'session_restored'}>;
		c.acceptNewSession(restored.sessionId, task.id);
		await until(() => c.isAttached(restored.sessionId), Boolean, 'attached');

		assert.equal(c.sendMessage(PROMPT), true);
		await until(() => events.some(e => e.type === 'final_answer'), Boolean, 'final_answer');
		const finished = await until(
			() => events.find(e => e.type === 'turn_finished'),
			(e): e is Extract<BridgeEvent, {type: 'turn_finished'}> => Boolean(e),
			'turn_finished'
		);
		await until(() => c.gate().runState, state => state === 'idle', 'turn settled');

		assert.equal(stub.requests.length > 0, true, 'stub received at least one completion request');
		const lastRequest = stub.requests[stub.requests.length - 1];
		assert.equal(lastRequest.model, 'stub-model', 'engine resolved the stub catalog model');
		assert.match(JSON.stringify(lastRequest.messages), /stub 在线吗/, 'prompt reached the provider');

		const deltas = events.filter(e => e.type === 'assistant_delta');
		assert.equal(
			deltas.map(e => e.text).join(''),
			ANSWER,
			'assistant_delta pieces concatenate to the scripted answer'
		);
		const final = events.find(e => e.type === 'final_answer') as Extract<
			BridgeEvent,
			{type: 'final_answer'}
		>;
		assert.equal(final.text, ANSWER);
		assert.ok(finished, 'turn_finished emitted');
		assert.equal(finished.success, true, 'turn finished successfully');
		// turn_usage is DSH-only (plan G1, dsh-agent-loop.md §9.2); the builtin engine stays fail-closed.
		assert.equal(
			events.some(e => e.type === 'turn_usage'),
			false,
			'builtin engine emits no turn_usage (DSH-scoped)'
		);
	} finally {
		bridge.stop?.();
		await stub.close();
		await fixture.cleanup();
	}
});
