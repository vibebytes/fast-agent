/**
 * L1 E2E: a new session resolves the Registry default engine — never the engine
 * the Composer/picker was last showing, and never a Host-side fallback.
 *
 * Phase A (precondition): engine + isolated dshd. A control session is created
 * through the engine-owned `/new` path and pinned to dsh with SetEngineKind — so
 * the per-session sticky kind and the process-wide "last active engine" are both
 * dsh. Asserted through /sessions, not through client state: the wire row must
 * say `engineKind: "dsh"`, otherwise every phase-B assertion passes vacuously.
 *
 * Phase B (the regression): the three creation paths a picker=fast client
 * exercises while that dsh state is live —
 *   B1. SessionController.createTask (the production New-chat path;
 *       taskLifecycle.sendCreateSession must put engineKind on the wire),
 *   B2. CreateSession with engineKind omitted (old daemons / legacy hosts),
 *   B3. the `/new` slash command.
 * None of them may inherit dsh; all resolve the Registry default (fast).
 *
 * The assertion authority is the engine's own list: `/sessions` →
 * `sessions_list[].engineKind`, documented in bridge-protocol as
 * "Sticky session.engine_kind — `dsh` or omitted (Fast)".
 *
 * FAST_E2E_ENGINE selects the engine (see e2e/engineSource.ts): 'placed'
 * (default, skipped when absent), 'stage' (sbt stage of the agent repo) or a
 * dist directory path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import {readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import type {TestContext} from 'node:test';
import {startStubLlm} from './e2e/stubLlmServer.js';
import {engineCommandFor, makeEngineFixture, type EngineFixture, type EngineLaunch} from './e2e/engineE2eFixture.js';
import {EngineSessionHarness} from './e2e/sessionHarness.js';
import {startDshScenario} from './e2e/dshScenario.js';

type SessionRow = {id: string; title?: string | null; engineKind?: string | null};

/**
 * Engine kind of a listed session. `engineKind` is omitted for Fast, so both an
 * absent field and the literal "fast" mean the Registry default; `dsh` is the
 * only value that proves inheritance from the last active engine.
 */
const engineOf = (row: SessionRow): string => (row.engineKind ?? 'fast').trim().toLowerCase() || 'fast';

const dumpRuntimeTree = (root: string): void => {
	const walk = (dir: string, rel: string): void => {
		for (const name of readdirSync(dir)) {
			const abs = path.join(dir, name);
			const label = path.posix.join(rel, name);
			const st = statSync(abs);
			if (st.isDirectory()) {
				console.error(`  ${label}/`);
				walk(abs, label);
			} else {
				console.error(`  ${label} (${st.size}b)`);
				if (st.size > 0 && st.size < 20_000 && !name.endsWith('.db')) {
					try {
						console.error(
							execSync(`tail -c 4000 ${JSON.stringify(abs)} 2>/dev/null`, {encoding: 'utf8'})
								.split('\n')
								.map(l => `    | ${l}`)
								.join('\n')
						);
					} catch {
						/* binary */
					}
				}
			}
		}
	};
	try {
		walk(root, '');
	} catch (err) {
		console.error(`  walk failed: ${err}`);
	}
};

const dumpForensics = (fixture: EngineFixture, harness: EngineSessionHarness, dshPort: number): void => {
	console.error('=== dsh forensic dump ===');
	console.error(`fixture.env: ${JSON.stringify(fixture.env, null, 1)}`);
	console.error(`runtime tree under ${fixture.env.FAST_RUNTIME_ROOT}:`);
	dumpRuntimeTree(fixture.env.FAST_RUNTIME_ROOT);
	console.error(`home tree under ${fixture.env.HOME}:`);
	dumpRuntimeTree(fixture.env.HOME);
	try {
		console.error(`dshd /debug/state: ${execSync(`curl -s -m 3 http://127.0.0.1:${dshPort}/debug/state`, {encoding: 'utf8'})}`);
	} catch (err) {
		console.error(`dshd /debug/state failed: ${err}`);
	}
	console.error(`harness:\n${harness.diagnose()}`);
};

const runScenario = async (
	fixture: EngineFixture,
	launch: EngineLaunch,
	stubLlmBaseUrl: string,
	t: TestContext
): Promise<void> => {
	const dsh = await startDshScenario(fixture, launch.command[0], stubLlmBaseUrl);
	t.after(() => dsh.cleanup());

	/** Phase-A state the production controller needs to build a real CreateSession. */
	const client: {workspaceId?: string; projectId?: string} = {};
	const a = EngineSessionHarness.start(
		fixture.project,
		{...fixture.env, ...dsh.dshEnv},
		launch,
		'engine-kind-e2e',
		{workspaceId: () => client.workspaceId, projectId: () => client.projectId}
	);
	/** label -> sessionId, plus the id set used to reject already-seen sessions. */
	const created = new Map<string, string>();
	const seenIds = new Set<string>();
	const claim = (label: string, id: string): void => {
		assert.ok(!seenIds.has(id), `${label} re-claimed an existing session ${id} — the step did not create a new session`);
		created.set(label, id);
		seenIds.add(id);
	};

	try {
		a.bridge.send({type: 'RegisterWorkspace', path: fixture.project});
		const ws = await a.waitEvent(
			'command_result',
			(e: any) => e.name === 'RegisterWorkspace' && e.status === 'accepted',
			{what: 'RegisterWorkspace'}
		);
		client.workspaceId = String((ws as any).message ?? (ws as any).workspaceId ?? '').replace(/^workspace:/, '').trim();
		assert.ok(client.workspaceId, `RegisterWorkspace returned no workspace hash: ${JSON.stringify(ws)}`);

		a.bridge.send({type: 'GetWorkspaceMeta'});
		const meta = await a.waitEvent('workspace_meta', undefined, {what: 'workspace_meta'});
		const projects: any[] = (meta as any).projects ?? [];
		const project =
			projects.find(p => p.workspace?.pathHash === client.workspaceId || p.workspace?.rootPath === fixture.project) ??
			projects.find(p => p.isDefault);
		assert.ok(project, `no project row in workspace_meta: ${JSON.stringify(projects).slice(0, 400)}`);
		client.projectId = project.id as string;

		// --- Phase A: pin the control session to dsh. ---
		a.bridge.send({type: 'command', name: 'new', args: 'dsh control'});
		const controlResult = await a.waitEvent(
			'command_result',
			(e: any) => e.name === 'new' && (e as any).sessionId,
			{what: 'new(control)'}
		);
		const controlSession = String((controlResult as any).sessionId);
		claim('control(dsh)', controlSession);

		a.bridge.send({type: 'SetEngineKind', sessionId: controlSession, kind: 'dsh'});
		try {
			const ack = await a.waitEvent(
				'command_result',
				(e: any) => e.name === 'SetEngineKind' && e.status !== 'error' && e.status !== 'rejected',
				{what: 'SetEngineKind(control)'}
			);
			assert.equal((ack as any).status, 'success', `SetEngineKind(dsh) was refused: ${JSON.stringify(ack)}`);
		} catch (err) {
			dumpForensics(fixture, a, dsh.port);
			throw err;
		}

		// --- Phase B1: the production client New-chat path. ---
		// The controller chrome is dsh once its active task is the control session,
		// so a regression that lets a new session inherit the last active engine
		// sends engineKind:'dsh' on this very command.
		const probe = a.controller.createTask('picker fast');
		const probeResult = await a.waitEvent(
			'command_result',
			(e: any) => e.name === 'CreateSession' && e.taskId === probe.id && (e as any).sessionId,
			{what: 'CreateSession(controller)'}
		);
		const sentCreate = a.commands('CreateSession').find(c => c.taskId === probe.id);
		assert.ok(
			sentCreate,
			`SessionController.createTask sent no observable CreateSession for task ${probe.id}\n${a.diagnose()}`
		);
		assert.equal(
			sentCreate.engineKind,
			'fast',
			`the production client must state the new session's engine explicitly — an omitted engineKind silently takes the Host Registry default: ${JSON.stringify(sentCreate)}`
		);
		const probeSession = String((probeResult as any).sessionId);
		claim('CreateSession(controller path)', probeSession);
		a.controller.acceptNewSession(probeSession, probe.id, client.workspaceId);
		await a.waitUntil(() => a.controller.isAttached(probeSession), Boolean, 'controller attached to the new session');

		// --- Phase B2: legacy host — engineKind omitted. ---
		a.bridge.send({type: 'CreateSession', projectId: client.projectId, title: 'omit default'});
		const viaOmit = await a.waitEvent(
			'command_result',
			(e: any) => e.name === 'CreateSession' && (e as any).sessionId && !seenIds.has(String((e as any).sessionId)),
			{what: 'CreateSession(omit)'}
		);
		claim('CreateSession(omit)', String((viaOmit as any).sessionId));

		// --- Phase B3: the `/new` slash path. ---
		a.bridge.send({type: 'command', name: 'new', args: 'slash default'});
		const viaSlash = await a.waitEvent(
			'command_result',
			(e: any) => e.name === 'new' && (e as any).sessionId && !seenIds.has(String((e as any).sessionId)),
			{what: 'new(slash)'}
		);
		claim('slash /new', String((viaSlash as any).sessionId));

		// --- Wire truth: the engine's own rows. ---
		a.bridge.send({type: 'command', name: 'sessions', args: ''});
		const list = await a.waitEvent('sessions_list', undefined, {what: 'sessions_list'});
		const rows: SessionRow[] = (list as any).sessions ?? [];
		const rowOf = (id: string): SessionRow | undefined => rows.find(r => r.id === id);
		const ids = rows.map(r => r.id).join(',');

		const controlRow = rowOf(controlSession);
		assert.ok(controlRow, `control session missing from /sessions: ids=${ids}`);
		assert.equal(
			engineOf(controlRow),
			'dsh',
			`precondition failed — the control session did not stay dsh, so phase B would pass vacuously: ${JSON.stringify(controlRow)}`
		);

		for (const [what, id] of created) {
			if (what.startsWith('control')) continue;
			const row = rowOf(id);
			assert.ok(row, `session from ${what} missing from /sessions: ids=${ids}`);
			assert.notEqual(
				engineOf(row),
				'dsh',
				`new session via ${what} inherited the last active engine (dsh) — BUG\nrow: ${JSON.stringify(row)}`
			);
		}
	} finally {
		await a.close();
	}
};

test('new sessions use the engine default, not the last active engine', async t => {
	const stub = await startStubLlm([{text: 'ok'}]);
	try {
		const launchProbe = await makeEngineFixture(stub.baseUrl);
		const launch = engineCommandFor(launchProbe.env);
		await launchProbe.cleanup();
		if (!launch) {
			t.skip('no placed engine binary: run fast/scripts/fetch-engine.sh or set FAST_E2E_ENGINE=<dist dir>');
			return;
		}
		console.log(`[engine-kind-e2e] engine: ${launch.source}`);
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			const fixture = await makeEngineFixture(stub.baseUrl);
			try {
				await runScenario(fixture, launch, stub.baseUrl, t);
				return;
			} catch (err) {
				lastError = err;
				const msg = String((err as Error)?.message ?? err);
				// Only boot races (port grab / dshd banner / engine exit) are retryable.
				if (!msg.includes('engine exited') || attempt === 2) throw err;
			} finally {
				await fixture.cleanup();
			}
		}
		assert.fail(`exhausted retries: ${lastError}`);
	} finally {
		await stub.close();
	}
});
