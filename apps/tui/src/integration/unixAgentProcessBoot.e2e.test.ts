/**
 * Real unix Bridge e2e (no PTY): AgentProcess → ensureDaemon → Hello → EnsureProject → Attach.
 * Asserts the user-visible failure: session never becomes ready → input would permanently queue.
 *
 * Uses an isolated FAST_RUN_DIR so it does not fight a developer desktop daemon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AgentProcess} from '../rpc/AgentProcess.js';
import type {BridgeEvent} from '../rpc/protocol.js';
import {initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {applyUnixE2eEnv, defaultAgentCli, defaultAgentHome, restoreEnv, runtimeRootUnder} from './unixE2eEnv.js';

const downloadsRoot = defaultAgentHome();
const bundledEngine = defaultAgentCli(downloadsRoot);

function sessionReady(state: UiState): boolean {
	return (
		state.ready &&
		Boolean(state.sessionId) &&
		state.inputMode !== 'exited' &&
		state.inputMode !== 'starting'
	);
}

async function waitFor(pred: () => boolean, label: string, timeoutMs: number): Promise<void> {
	const t0 = Date.now();
	while (!pred()) {
		if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`);
		await new Promise(r => setTimeout(r, 50));
	}
}

test('unix e2e: AgentProcess continue reaches Attached (sessionReady)', {timeout: 120_000}, async t => {
	if (process.env.FAST_SKIP_UNIX_E2E === '1') {
		t.skip('FAST_SKIP_UNIX_E2E=1');
		return;
	}
	if (!existsSync(bundledEngine)) {
		t.skip(`bundled engine missing: ${bundledEngine}`);
		return;
	}

	const runDir = mkdtempSync(path.join(tmpdir(), 'fast-unix-e2e-run-'));
	const home = mkdtempSync(path.join(tmpdir(), 'fast-unix-e2e-home-'));
	const cwd = mkdtempSync(path.join(tmpdir(), 'fast-unix-e2e-cwd-'));
	mkdirSync(path.join(home, '.fast'), {recursive: true});
	writeFileSync(path.join(home, '.fast', 'trusted-workspaces'), `${realpathSync.native(cwd)}\n`);

	const prev = applyUnixE2eEnv(
		{home, runDir, runtimeRoot: runtimeRootUnder(home)},
		{
			FAST_AGENT_ROOT: downloadsRoot,
			FAST_BUNDLED_ENGINE: bundledEngine,
			FAST_SIMULATE_UNIX_SESSION_BOOT: undefined
		}
	);

	const prevCwd = process.cwd();
	process.chdir(cwd);

	const events: BridgeEvent[] = [];
	const errors: string[] = [];
	let state = initialState;
	const agent = new AgentProcess();

	t.after(() => {
		try {
			agent.stop();
		} catch {
			/* ignore */
		}
		process.chdir(prevCwd);
		restoreEnv(prev);
		// Best-effort: stop daemon we spawned in runDir
		try {
			const pid = Number(readFileSync(path.join(runDir, 'bridge.pid'), 'utf8').trim());
			if (Number.isFinite(pid) && pid > 0) process.kill(pid, 'SIGTERM');
		} catch {
			/* ignore */
		}
		rmSync(runDir, {recursive: true, force: true});
		rmSync(home, {recursive: true, force: true});
		rmSync(cwd, {recursive: true, force: true});
	});

	agent.start(
		{
			onEvent: event => {
				events.push(event);
				state = reducer(state, {type: 'engine_event', event});
			},
			onError: message => {
				errors.push(message);
			},
			onExit: () => undefined
		},
		{mode: 'continue'}
	);

	try {
		await waitFor(
			() => events.some(e => e.type === 'ready'),
			`ready (got=${events.map(e => e.type).join(',') || '∅'}; err=${errors.join('|') || '∅'})`,
			60_000
		);

		const ready = events.find(e => e.type === 'ready');
		assert.ok(ready && ready.type === 'ready');
		assert.equal(
			ready.sessionId,
			undefined,
			'unix continue must strip host boot sessionId — otherwise ink attaches wrong session'
		);

		await waitFor(
			() => events.some(e => e.type === 'Attached') || sessionReady(state),
			`Attached/sessionReady (got=${events.map(e => e.type).join(',')}; err=${errors.join('|') || '∅'}; sessionId=${state.sessionId ?? '∅'})`,
			60_000
		);

		assert.ok(state.sessionId, 'sessionId required for composer submit (else permanent queue>)');
		assert.equal(sessionReady(state), true, 'sessionReady must be true so input is not boot-queued');
	} catch (error) {
		const detail = [
			`events: ${events.map(e => e.type).join(', ') || '(none)'}`,
			`errors: ${errors.join(' | ') || '(none)'}`,
			`state: ready=${state.ready} sessionId=${state.sessionId ?? '∅'} inputMode=${state.inputMode}`,
			`runDir: ${runDir}`
		].join('\n');
		throw new Error(`${error instanceof Error ? error.message : String(error)}\n${detail}`);
	}
});
