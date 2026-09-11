/**
 * L1 E2E: dsh conversation must reload after engine restart.
 *
 * Phase A: engine + isolated dshd (the engine spawns it via FAST_DSH_COMMAND
 * on a pinned port; the dsh root is pre-installed in the fixture runtime). A
 * scripted turn is committed through the production BridgeClient +
 * SessionController, then the bridge is stopped — the dshd survives.
 *
 * Phase B: a fresh BridgeClient starts against the same fixture env, binds the
 * session to the workspace (RegisterWorkspace → BindSessionWorkspace →
 * AttachSession) and asserts session_restored replays the phase-A turn through
 * the still-running dshd.
 *
 * FAST_E2E_ENGINE selects the engine (see e2e/engineSource.ts): 'placed'
 * (default, skipped when absent), 'stage' (sbt stage of the agent repo) or a
 * dist directory path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {projectHash} from './projectHash.js';
import {startStubLlm} from './e2e/stubLlmServer.js';
import {engineCommandFor, makeEngineFixture, type EngineFixture, type EngineLaunch} from './e2e/engineE2eFixture.js';
import {EngineSessionHarness} from './e2e/sessionHarness.js';
import {startDshScenario} from './e2e/dshScenario.js';

const PROMPT = 'remember token7788';
const ANSWER = 'recorded token7788';

const runScenario = async (fixture: EngineFixture, launch: EngineLaunch, stubLlmBaseUrl: string, t: TestContext, stubRequests: () => number): Promise<void> => {
	const dsh = await startDshScenario(fixture, launch.command[0], stubLlmBaseUrl);
	t.after(() => dsh.cleanup());

	const a = EngineSessionHarness.start(fixture.project, {...fixture.env, ...dsh.dshEnv}, launch, 'dsh-reopen-e2e');
	let sessionId = '';
	try {
		const c = a.controller;
		const task = c.createTask('dsh reopen');
		a.bridge.send({type: 'command', name: 'new', args: 'dsh reopen'});
		const restoredA = await a.waitEvent('session_restored', undefined, {what: 'session_restored(A)', timeoutMs: 120_000});
		sessionId = (restoredA as any).sessionId;
		c.acceptNewSession(sessionId, task.id);
		await a.waitUntil(() => c.isAttached(sessionId), Boolean, 'attached(A)');
		a.bridge.send({type: 'SetEngineKind', sessionId, kind: 'dsh'});
		const kindAck = await a.waitEvent('command_result', (e: any) => e.name === 'SetEngineKind', {what: 'SetEngineKind ack(A)'});
		assert.equal(
			(kindAck as any).status,
			'success',
			`SetEngineKind was rejected — the turn would run on the fast engine and the dsh assertions below would fail misleadingly: ${JSON.stringify(kindAck)}`
		);
		c.sendMessage(PROMPT);
		try {
			await a.waitEvent('turn_finished', (e: any) => e.sessionId === sessionId, {what: 'turn_finished(A)', timeoutMs: 120_000});
		} catch (err) {
			console.error(`--- dshd log tail ---\n${dsh.dshdLog().slice(-2500)}`);
			console.error(`--- stub llm requests: ${stubRequests()} ---`);
			throw err;
		}
		const answer = a.events
			.filter((e: any) => e.type === 'assistant_delta' && e.sessionId === sessionId)
			.map((e: any) => String(e.text ?? ''))
			.join('');
		assert.ok(
			answer.includes('recorded'),
			`dsh turn should acknowledge the prompt via delta: ${answer}`
		);
	} finally {
		await a.close();
	}

	const reopenLaunch: EngineLaunch = {...launch, command: launch.command.filter(a => a !== '--new')};
	const b = EngineSessionHarness.start(fixture.project, {...fixture.env, ...dsh.dshEnv}, reopenLaunch, 'dsh-reopen-e2e-b');
	try {
		b.bridge.send({type: 'RegisterWorkspace', path: fixture.project});
		const ws = await b.waitEvent('command_result', (e: any) => e.name === 'RegisterWorkspace' && e.status === 'accepted', {
			what: 'RegisterWorkspace(B)'
		});
		const workspaceId = (ws as any).message;
		assert.equal(workspaceId, projectHash(fixture.project));
		b.bridge.send({type: 'BindSessionWorkspace', sessionId: sessionId, workspaceId});
		b.bridge.send({type: 'AttachSession', sessionId, lastEventSeq: 0, clientId: 'dsh-reopen-e2e-b'});
		const restoredB = await b.waitEvent('session_restored', (e: any) => e.sessionId === sessionId, {what: 'session_restored(B)', timeoutMs: 120_000});
		const payload = restoredB as any;
		const turns = payload.turns ?? payload.messages ?? [];
		assert.ok(
			Array.isArray(turns) && turns.length > 0,
			`reopen produced an empty restore window — BUG\npayload: ${[...JSON.stringify(payload)].slice(0, 600).join('')}\n${b.diagnose()}`
		);
		const texts = turns.map((x: any) => `${x.userText ?? x.role ?? ''}|${x.assistantText ?? x.text ?? ''}`).join(' // ');
		assert.ok(texts.includes(PROMPT), `replayed window is missing the phase-A user turn: ${[...texts].slice(0, 300).join('')}`);
	} finally {
		await b.close();
	}
};

test('dsh conversation reloads after engine restart', async t => {
	const stub = await startStubLlm([{text: ANSWER}]);
	try {
		const launch = engineCommandFor({});
		if (!launch) {
			t.skip('no placed engine binary: run fast/scripts/fetch-engine.sh or set FAST_ENGINE_COMMAND');
			return;
		}
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			const fixture = await makeEngineFixture(stub.baseUrl);
			try {
				await runScenario(fixture, launch, stub.baseUrl, t, () => stub.requests.length);
				return;
			} catch (err) {
				lastError = err;
				const msg = String((err as Error)?.message ?? err);
				if (!msg.includes('engine exited') || attempt === 2) throw err;
			} finally {
				await fixture.cleanup();
			}
		}
	} finally {
		await stub.close();
	}
});
