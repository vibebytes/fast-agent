/**
 * L1 full-stack E2E: the real engine binary over NDJSON stdio, driven through
 * the production BridgeClient + SessionController, against a stub
 * OpenAI-compatible server. Proves the river: sendMessage → provider stream →
 * assistant_delta → final_answer → turn_finished, with no turn_usage emitted
 * on the builtin fail-closed path.
 *
 * FAST_E2E_ENGINE selects the engine (see e2e/engineSource.ts): 'placed'
 * (default, skipped when absent), 'stage' (sbt stage of the agent repo) or a
 * dist directory path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {startStubLlm} from './e2e/stubLlmServer.js';
import {engineCommandFor, makeEngineFixture} from './e2e/engineE2eFixture.js';
import {EngineSessionHarness} from './e2e/sessionHarness.js';

const PROMPT = 'Say the magic word.';
const ANSWER = 'alakazam';

test('real engine completes one turn over stdio', async t => {
	const stub = await startStubLlm([{text: ANSWER, reasoning: 'think first.', inputTokens: 3, outputTokens: 2}]);
	const fixture = await makeEngineFixture(stub.baseUrl);
	const launch = engineCommandFor(fixture.env);
	if (!launch) {
		await stub.close();
		await fixture.cleanup();
		t.skip('no placed engine binary: run fast/scripts/fetch-engine.sh or set FAST_ENGINE_COMMAND');
		return;
	}
	const h = EngineSessionHarness.start(fixture.project, fixture.env, launch, 'engine-e2e');
	try {
		const c = h.controller;
		const task = c.createTask('engine E2E');
		h.bridge.send({type: 'command', name: 'new', args: 'engine E2E'});
		const restored = await h.waitEvent('session_restored', undefined, {what: 'session_restored', timeoutMs: 120_000});
		const sessionId = (restored as any).sessionId;
		c.acceptNewSession(sessionId, task.id);
		await h.waitUntil(() => c.isAttached(sessionId), Boolean, 'attached', 120_000);
		assert.equal(c.sendMessage(PROMPT), true, 'sendMessage should start a turn');
		const final = await h.waitEvent('final_answer', undefined, {what: 'final_answer', timeoutMs: 120_000});
		const finished = await h.waitEvent('turn_finished', undefined, {what: 'turn_finished', timeoutMs: 120_000});
		await h.waitUntil(() => c.gate().runState, s => s === 'idle', 'turn settles back to idle', 120_000);
		assert.ok(stub.requests.length > 0, 'prompt reached the provider');
		const deltas = h.events.filter(e => e.type === 'assistant_delta');
		assert.equal(
			deltas.map(e => (e as any).text).join(''),
			ANSWER,
			'assistant_delta pieces concatenate to the scripted answer'
		);
		assert.equal((final as any).text, ANSWER, 'final answer matches the scripted turn');
		assert.equal((finished as any).success, true, 'turn finishes successfully');
		assert.equal(
			h.events.some(e => e.type === 'turn_usage'),
			false,
			'builtin engine must not emit turn_usage (fail-closed usage accounting)'
		);
	} finally {
		await h.close();
		await stub.close();
		await fixture.cleanup();
	}
});
