/**
 * Real unix e2e: stuck IDE (Hello then pause reading) + ink continue must still
 * reach Attached. Catches HOL where ink's IO thread awaited IDE writeLine during
 * ready fan-out and never finished EnsureProject → permanent queue> / 引擎无响应.
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
		await new Promise(r => setTimeout(r, 40));
	}
}

test('unix dual-client: stuck IDE + ink continue still Attaches', {timeout: 120_000}, async t => {
	if (process.env.FAST_SKIP_UNIX_E2E === '1') {
		t.skip('FAST_SKIP_UNIX_E2E=1');
		return;
	}
	if (!existsSync(bundledEngine)) {
		t.skip(`bundled engine missing: ${bundledEngine}`);
		return;
	}

	const runDir = mkdtempSync(path.join(tmpdir(), 'fast-dual-run-'));
	const home = mkdtempSync(path.join(tmpdir(), 'fast-dual-home-'));
	const ideCwd = mkdtempSync(path.join(tmpdir(), 'fast-dual-ide-'));
	const inkCwd = mkdtempSync(path.join(tmpdir(), 'fast-dual-ink-'));
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
	const inkEvents: BridgeEvent[] = [];
	const inkErrors: string[] = [];
	let state = initialState;
	const agent = new AgentProcess();
	const prevCwd = process.cwd();
	let stuckIde: net.Socket | undefined;

	t.after(() => {
		try {
			agent.stop();
		} catch {
			/* ignore */
		}
		try {
			stuckIde?.destroy();
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
	stuckIde = net.createConnection({path: paths.socketPath});
	await new Promise<void>((resolve, reject) => {
		stuckIde!.once('connect', () => resolve());
		stuckIde!.once('error', reject);
	});
	stuckIde.write(
		JSON.stringify({
			type: 'Hello',
			protocolVersion: 1,
			clientId: 'e2e-stuck-ide',
			clientKind: 'fast-ide',
			pid: process.pid,
			cwd: ideCwd,
			authToken: ensured.token
		}) + '\n'
	);
	await new Promise<void>(resolve => {
		let buf = '';
		const onData = (chunk: Buffer | string) => {
			buf += String(chunk);
			if (buf.includes('"type":"ready"')) {
				stuckIde!.off('data', onData);
				stuckIde!.pause();
				resolve();
			}
		};
		stuckIde!.on('data', onData);
		setTimeout(() => {
			stuckIde!.pause();
			resolve();
		}, 15_000);
	});

	process.chdir(inkCwd);
	agent.start(
		{
			onEvent: event => {
				inkEvents.push(event);
				state = reducer(state, {type: 'engine_event', event});
			},
			onError: message => {
				inkErrors.push(message);
			},
			onExit: () => undefined
		},
		{mode: 'continue'}
	);

	try {
		await waitFor(
			() => inkEvents.some(e => e.type === 'Attached') || sessionReady(state),
			`ink Attached while IDE paused (ink=${inkEvents.map(e => e.type).join(',')}; err=${inkErrors.join('|') || '∅'})`,
			60_000
		);
		assert.ok(state.sessionId, 'ink must get sessionId while stuck IDE stays connected');
		assert.equal(sessionReady(state), true);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`ink=${inkEvents.map(e => e.type).join(',')}\n` +
				`err=${inkErrors.join(' | ') || '(none)'}\n` +
				`sessionId=${state.sessionId ?? '∅'}`
		);
	}
});
