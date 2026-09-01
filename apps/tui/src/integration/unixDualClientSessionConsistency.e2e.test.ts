/**
 * Real unix e2e: IDE + cli-ink both Attach the same session, fire multiple
 * slash commands concurrently, and assert display cards stay consistent.
 *
 * Seam: Bridge host fan-out of session-scoped `command_result` (and the ink
 * reducer transcript derived from it). Both Thin Clients must show the same
 * command_result cards after dual-path concurrent commands.
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
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BridgeHost} from '@fastllm/bridge-client';
import type {BridgeEvent} from '../rpc/protocol.js';
import {initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {applyUnixE2eEnv, defaultAgentCli, defaultAgentHome, restoreEnv, runtimeRootUnder} from './unixE2eEnv.js';

const downloadsRoot = defaultAgentHome();
const bundledEngine = defaultAgentCli(downloadsRoot);

type DisplayCard = {name: string; text: string; status: string};

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

function applyEvent(state: UiState, event: BridgeEvent): UiState {
	return reducer(state, {type: 'engine_event', event});
}

/** User-visible slash/command cards (order-insensitive multiset by name+text+status). */
function displayCards(state: UiState): DisplayCard[] {
	const cards: DisplayCard[] = [];
	for (const turn of state.localTurns) {
		for (const msg of turn.systemMessages) {
			if (msg.kind === 'command_result' && msg.commandName) {
				cards.push({
					name: msg.commandName,
					text: msg.text,
					status: msg.commandStatus ?? 'success'
				});
			}
		}
	}
	return cards;
}

function cardKey(c: DisplayCard): string {
	return `${c.name}\0${c.status}\0${c.text}`;
}

function sortedKeys(cards: DisplayCard[]): string[] {
	return cards.map(cardKey).sort();
}

test('unix dual-client: same session concurrent commands keep display consistent', {timeout: 180_000}, async t => {
	if (process.env.FAST_SKIP_UNIX_E2E === '1') {
		t.skip('FAST_SKIP_UNIX_E2E=1');
		return;
	}
	if (!existsSync(bundledEngine)) {
		t.skip(`bundled engine missing: ${bundledEngine}`);
		return;
	}

	const runDir = mkdtempSync(path.join(tmpdir(), 'fast-dual-sess-run-'));
	const home = mkdtempSync(path.join(tmpdir(), 'fast-dual-sess-home-'));
	const cwd = mkdtempSync(path.join(tmpdir(), 'fast-dual-sess-cwd-'));
	mkdirSync(path.join(home, '.fast'), {recursive: true});
	writeFileSync(path.join(home, '.fast', 'trusted-workspaces'), `${realpathSync.native(cwd)}\n`);

	const prev = applyUnixE2eEnv(
		{home, runDir, runtimeRoot: runtimeRootUnder(home)},
		{
			FAST_AGENT_ROOT: downloadsRoot,
			FAST_BUNDLED_ENGINE: bundledEngine
		}
	);
	const env = {...process.env} as NodeJS.ProcessEnv;
	const ide = new BridgeHost();
	const ink = new BridgeHost();
	const ideRaw: BridgeEvent[] = [];
	const inkRaw: BridgeEvent[] = [];
	let ideState = initialState;
	let inkState = initialState;
	const errors: string[] = [];

	t.after(() => {
		try {
			ide.stop();
		} catch {
			/* ignore */
		}
		try {
			ink.stop();
		} catch {
			/* ignore */
		}
		restoreEnv(prev);
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

	await ide.connect(
		{clientKind: 'fast-ide', clientId: 'e2e-ide-dual', cwd, env, heartbeatMs: 0},
		{
			onEvent: e => {
				ideRaw.push(e);
				ideState = applyEvent(ideState, e);
			},
			onError: m => errors.push(`ide:${m}`),
			onClose: () => undefined
		}
	);
	await waitFor(() => ideRaw.some(e => e.type === 'ready'), 'IDE ready', 60_000);

	ide.send({
		type: 'EnsureProject',
		path: cwd,
		projectType: 'coding',
		displayName: path.basename(cwd)
	});
	await waitFor(
		() =>
			ideRaw.some(
				e => e.type === 'command_result' && e.name === 'EnsureProject' && e.status === 'accepted' && Boolean(e.projectId)
			),
		'IDE EnsureProject',
		60_000
	);
	const projectId = ideRaw.find(
		(e): e is Extract<BridgeEvent, {type: 'command_result'}> =>
			e.type === 'command_result' && e.name === 'EnsureProject' && e.status === 'accepted'
	)?.projectId;
	assert.ok(projectId, 'projectId from EnsureProject');

	ide.send({type: 'CreateSession', projectId, title: 'dual-consistency'});
	await waitFor(
		() =>
			ideRaw.some(
				e => e.type === 'command_result' && e.name === 'CreateSession' && e.status === 'accepted' && Boolean(e.sessionId)
			),
		'IDE CreateSession',
		60_000
	);
	const sessionId = ideRaw.find(
		(e): e is Extract<BridgeEvent, {type: 'command_result'}> =>
			e.type === 'command_result' && e.name === 'CreateSession' && e.status === 'accepted'
	)?.sessionId;
	assert.ok(sessionId, 'sessionId from CreateSession');

	ide.send({
		type: 'AttachSession',
		sessionId,
		clientId: 'e2e-ide-dual',
		lastEventSeq: 0,
		limit: 50
	});
	try {
		await waitFor(() => ideRaw.some(e => e.type === 'Attached'), 'IDE Attached', 30_000);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`ideEvents=${ideRaw.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}\n` +
				`errors=${errors.join(' | ') || '(none)'}`
		);
	}
	ideState = {...ideState, sessionId, ready: true};

	await ink.connect(
		{clientKind: 'fast-ink', clientId: 'e2e-ink-dual', cwd, env, heartbeatMs: 0},
		{
			onEvent: e => {
				inkRaw.push(e);
				inkState = applyEvent(inkState, e);
			},
			onError: m => errors.push(`ink:${m}`),
			onClose: () => undefined
		}
	);
	await waitFor(() => inkRaw.some(e => e.type === 'ready'), 'ink ready', 60_000);
	ink.send({
		type: 'AttachSession',
		sessionId,
		clientId: 'e2e-ink-dual',
		lastEventSeq: 0,
		limit: 50
	});
	try {
		await waitFor(() => inkRaw.some(e => e.type === 'Attached'), 'ink Attached', 45_000);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`inkEvents=${inkRaw.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}\n` +
				`ideEvents=${ideRaw.map(e => (e.type === 'command_result' ? `${e.type}:${e.name}:${e.status}` : e.type)).join(',')}\n` +
				`errors=${errors.join(' | ') || '(none)'}`
		);
	}
	inkState = {...inkState, sessionId, ready: true};

	// Clear boot noise so we only compare concurrent slash cards.
	const ideBaseline = new Set(sortedKeys(displayCards(ideState)));
	const inkBaseline = new Set(sortedKeys(displayCards(inkState)));

	const commands: Array<{from: 'ide' | 'ink'; name: string; args: string}> = [
		{from: 'ide', name: 'skills', args: ''},
		{from: 'ink', name: 'model', args: ''},
		{from: 'ide', name: 'usage', args: ''},
		{from: 'ink', name: 'history', args: ''},
		{from: 'ide', name: 'debug', args: 'on'},
		{from: 'ink', name: 'context', args: ''},
		{from: 'ide', name: 'agents', args: ''},
		{from: 'ink', name: 'sandbox', args: ''}
	];
	const expectedNames = [...new Set(commands.map(c => c.name))];

	for (const c of commands) {
		const host = c.from === 'ide' ? ide : ink;
		assert.equal(
			host.send({type: 'command', name: c.name, args: c.args, sessionId}),
			true,
			`send /${c.name} from ${c.from}`
		);
	}

	const resultsFor = (raw: BridgeEvent[], name: string) =>
		raw.filter(
			(e): e is Extract<BridgeEvent, {type: 'command_result'}> =>
				e.type === 'command_result' && e.name === name
		);

	try {
		for (const name of expectedNames) {
			await waitFor(
				() => resultsFor(ideRaw, name).length >= 1 && resultsFor(inkRaw, name).length >= 1,
				`both peers got command_result name=${name} (ide=${resultsFor(ideRaw, name).length} ink=${resultsFor(inkRaw, name).length})`,
				45_000
			);
		}

		const ideCards = displayCards(ideState).filter(c => !ideBaseline.has(cardKey(c)));
		const inkCards = displayCards(inkState).filter(c => !inkBaseline.has(cardKey(c)));

		assert.deepEqual(
			sortedKeys(ideCards),
			sortedKeys(inkCards),
			`display cards diverge\nIDE:\n${sortedKeys(ideCards).join('\n')}\nINK:\n${sortedKeys(inkCards).join('\n')}`
		);

		for (const name of expectedNames) {
			assert.ok(
				ideCards.some(c => c.name === name),
				`IDE display missing /${name}`
			);
			assert.ok(
				inkCards.some(c => c.name === name),
				`ink display missing /${name}`
			);
		}

		// Session-scoped results must carry sessionId so router fans out to Attach peers.
		for (const name of expectedNames) {
			const ideHit = resultsFor(ideRaw, name).at(-1);
			const inkHit = resultsFor(inkRaw, name).at(-1);
			assert.equal(ideHit?.sessionId, sessionId, `IDE /${name} missing sessionId stamp`);
			assert.equal(inkHit?.sessionId, sessionId, `ink /${name} missing sessionId stamp`);
			assert.equal(ideHit?.message, inkHit?.message, `/${name} message text mismatch`);
		}
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n` +
				`errors=${errors.join(' | ') || '(none)'}\n` +
				`ideResults=${expectedNames.map(n => `${n}:${resultsFor(ideRaw, n).length}`).join(',')}\n` +
				`inkResults=${expectedNames.map(n => `${n}:${resultsFor(inkRaw, n).length}`).join(',')}\n` +
				`ideCards=${sortedKeys(displayCards(ideState)).join(' || ')}\n` +
				`inkCards=${sortedKeys(displayCards(inkState)).join(' || ')}`
		);
	}
});
