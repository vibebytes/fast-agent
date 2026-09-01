/**
 * Real unix e2e for the user symptom: open cli-ink (with IDE already on the
 * Machine Bridge) → footer「引擎无响应」.
 *
 * Seam: AgentProcess continue boot must reach sessionReady despite a concurrent
 * IDE Hello/ready peer, then Heartbeat echoes keep lastEngineEventAt fresh
 * past ENGINE_SILENT (5s).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	realpathSync,
	rmSync,
	readFileSync,
	existsSync
} from 'node:fs';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bridgePaths, ensureDaemon} from '@fastllm/bridge-client';
import {AgentProcess} from '../rpc/AgentProcess.js';
import type {BridgeEvent} from '../rpc/protocol.js';
import {initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {applyUnixE2eEnv, defaultAgentCli, defaultAgentHome, restoreEnv, runtimeRootUnder} from './unixE2eEnv.js';

const downloadsRoot = defaultAgentHome();
const bundledEngine = defaultAgentCli(downloadsRoot);
const ENGINE_SILENT_AFTER_MS = 5_000;
const SETTLE_MS = 8_000;

function sessionReady(state: UiState): boolean {
	return (
		state.ready &&
		Boolean(state.sessionId) &&
		state.inputMode !== 'exited' &&
		state.inputMode !== 'starting'
	);
}

function waitFor(pred: () => boolean, label: string, timeoutMs: number): Promise<void> {
	const t0 = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (pred()) {
				resolve();
				return;
			}
			if (Date.now() - t0 > timeoutMs) {
				reject(new Error(`timeout: ${label}`));
				return;
			}
			setTimeout(tick, 40);
		};
		tick();
	});
}

test('unix open: IDE peer + continue boot stays live (no 引擎无响应)', {timeout: 180_000}, async t => {
	if (process.env.FAST_SKIP_UNIX_E2E === '1') {
		t.skip('FAST_SKIP_UNIX_E2E=1');
		return;
	}
	if (!existsSync(bundledEngine)) {
		t.skip(`bundled engine missing: ${bundledEngine}`);
		return;
	}

	const runDir = mkdtempSync(path.join(tmpdir(), 'fast-open-silent-run-'));
	const home = mkdtempSync(path.join(tmpdir(), 'fast-open-silent-home-'));
	const ideCwd = mkdtempSync(path.join(tmpdir(), 'fast-open-silent-ide-'));
	const inkCwd = mkdtempSync(path.join(tmpdir(), 'fast-open-silent-ink-'));
	mkdirSync(path.join(home, '.fast'), {recursive: true});
	writeFileSync(
		path.join(home, '.fast', 'trusted-workspaces'),
		`${realpathSync.native(ideCwd)}\n${realpathSync.native(inkCwd)}\n`
	);

	const prev = applyUnixE2eEnv(
		{home, runDir, runtimeRoot: runtimeRootUnder(home)},
		{
			FAST_AGENT_ROOT: downloadsRoot,
			FAST_BUNDLED_ENGINE: bundledEngine,
			FAST_SIMULATE_UNIX_SESSION_BOOT: undefined
		}
	);
	const env = {...process.env} as NodeJS.ProcessEnv;
	const prevCwd = process.cwd();
	process.chdir(inkCwd);

	const events: BridgeEvent[] = [];
	const errors: string[] = [];
	let state = initialState;
	const agent = new AgentProcess();
	let ide: net.Socket | undefined;

	t.after(() => {
		try {
			agent.stop();
		} catch {
			/* ignore */
		}
		try {
			ide?.destroy();
		} catch {
			/* ignore */
		}
		process.chdir(prevCwd);
		restoreEnv(prev);
		try {
			const pid = Number(readFileSync(path.join(runDir, 'bridge.pid'), 'utf8').trim());
			if (Number.isFinite(pid) && pid > 0) process.kill(pid, 'SIGTERM');
		} catch {
			/* ignore */
		}
		rmSync(runDir, {recursive: true, force: true});
		rmSync(home, {recursive: true, force: true});
		rmSync(ideCwd, {recursive: true, force: true});
		rmSync(inkCwd, {recursive: true, force: true});
	});

	const ensured = await ensureDaemon({env});
	const paths = bridgePaths(env);

	// Live IDE peer (keeps reading — exercises concurrent withReplyTo vs HostLane pin).
	ide = net.createConnection({path: paths.socketPath});
	await new Promise<void>((resolve, reject) => {
		ide!.once('connect', () => resolve());
		ide!.once('error', reject);
	});
	ide.write(
		JSON.stringify({
			type: 'Hello',
			protocolVersion: 1,
			clientId: 'e2e-open-ide',
			clientKind: 'fast-ide',
			pid: process.pid,
			cwd: ideCwd,
			authToken: ensured.token
		}) + '\n'
	);
	await new Promise<void>((resolve, reject) => {
		let buf = '';
		const onData = (chunk: Buffer | string) => {
			buf += String(chunk);
			if (buf.includes('HelloOk')) {
				ide!.off('data', onData);
				resolve();
			}
		};
		ide!.on('data', onData);
		ide!.once('error', reject);
		setTimeout(() => reject(new Error('IDE HelloOk timeout')), 30_000);
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
			() => events.some(e => e.type === 'command_result' && e.name === 'EnsureProject'),
			`EnsureProject command_result (got=${events.map(e => e.type).join(',') || '∅'}; err=${errors.join('|') || '∅'})`,
			60_000
		);
		await waitFor(
			() => events.some(e => e.type === 'Attached') || sessionReady(state),
			`Attached/sessionReady (sessionId=${state.sessionId ?? '∅'})`,
			60_000
		);
		assert.equal(sessionReady(state), true, 'open must be sessionReady before liveness probe');

		const sessionId = state.sessionId!;
		const hb = setInterval(() => {
			agent.send({
				type: 'Heartbeat',
				sessionId,
				clientId: agent.clientId,
				atMillis: Date.now()
			});
		}, 3000);
		t.after(() => clearInterval(hb));

		await new Promise(r => setTimeout(r, SETTLE_MS));

		const silentMs = Date.now() - (state.lastEngineEventAt ?? 0);
		const heartbeatEchoes = events.filter(e => e.type === 'Heartbeat').length;
		assert.ok(
			heartbeatEchoes >= 1,
			`expected Heartbeat echo(s), got ${heartbeatEchoes}; events=${events.map(e => e.type).join(',')}`
		);
		assert.ok(
			silentMs < ENGINE_SILENT_AFTER_MS,
			`引擎无响应 would show: silent ${Math.floor(silentMs / 1000)}s (>=${ENGINE_SILENT_AFTER_MS / 1000}s); ` +
				`lastEngineEventAt age=${silentMs}ms; heartbeats=${heartbeatEchoes}`
		);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`events=${events.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}\n` +
				`errors=${errors.join(' | ') || '(none)'}\n` +
				`ready=${state.ready} sessionId=${state.sessionId ?? '∅'} inputMode=${state.inputMode}`
		);
	}
});
