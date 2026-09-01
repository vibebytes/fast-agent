/**
 * Dual-client probe: one "stuck IDE" that Hellos then pauses the socket (stops
 * reading), then ink-like BridgeHost must still get EnsureProject accepted.
 */
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	realpathSync,
	readFileSync,
	rmSync,
	existsSync,
	readdirSync
} from 'node:fs';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BridgeHost, bridgePaths, ensureDaemon} from '../../../../packages/core/bridge/client/dist/index.js';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const downloadsRoot = currentEngineDir();
const bundledEngine = currentEngineCli();
if (!bundledEngine || !existsSync(bundledEngine)) {
	console.error('missing modules/engine/current/bin/fast-cli — pnpm fetch-engine');
	process.exit(1);
}
const runDir = mkdtempSync(path.join(tmpdir(), 'fast-dual-probe-run-'));
const home = mkdtempSync(path.join(tmpdir(), 'fast-dual-probe-home-'));
const ideCwd = mkdtempSync(path.join(tmpdir(), 'fast-dual-probe-ide-'));
const inkCwd = mkdtempSync(path.join(tmpdir(), 'fast-dual-probe-ink-'));
mkdirSync(path.join(home, '.fast'), {recursive: true});
writeFileSync(
	path.join(home, '.fast', 'trusted-workspaces'),
	`${realpathSync.native(ideCwd)}\n${realpathSync.native(inkCwd)}\n`
);

const t0 = Date.now();
const log = m => console.log(`[${Date.now() - t0}ms] ${m}`);

const env = {
	...process.env,
	HOME: home,
	FAST_RUN_DIR: runDir,
	FAST_AGENT_ROOT: downloadsRoot,
	FAST_BUNDLED_ENGINE: bundledEngine
};
delete env.FAST_BRIDGE_TRANSPORT;
delete env.FAST_ENGINE_TRANSPORT;

const paths = bridgePaths(env);
const ensured = await ensureDaemon({env});
log(`daemon sock=${ensured.socketPath} spawned=${ensured.spawned}`);

const stuck = net.createConnection({path: paths.socketPath});
await new Promise((resolve, reject) => {
	stuck.once('connect', resolve);
	stuck.once('error', reject);
});
stuck.write(
	JSON.stringify({
		type: 'Hello',
		protocolVersion: 1,
		clientId: 'stuck-ide',
		clientKind: 'fast-ide',
		pid: process.pid,
		cwd: ideCwd,
		authToken: ensured.token
	}) + '\n'
);
await new Promise(resolve => {
	let buf = '';
	const onData = chunk => {
		buf += String(chunk);
		if (buf.includes('"type":"ready"') || buf.includes('"type":"HelloOk"')) {
			if (buf.includes('"type":"ready"')) {
				stuck.off('data', onData);
				stuck.pause();
				log('stuck-ide paused after ready');
				resolve();
			}
		}
	};
	stuck.on('data', onData);
	setTimeout(() => {
		stuck.pause();
		log('stuck-ide pause timeout (forcing)');
		resolve();
	}, 15_000);
});

const ink = new BridgeHost();
const events = [];
try {
	await ink.connect(
		{clientKind: 'fast-ink', clientId: 'probe-ink', cwd: inkCwd, env, heartbeatMs: 0},
		{
			onEvent: e => {
				events.push(e.type);
				log(`ink EVENT ${e.type} ${e.name ?? ''} ${e.status ?? ''} ${e.projectId ?? ''}`);
			},
			onError: m => log(`ink ERROR ${m}`),
			onClose: () => log('ink CLOSE')
		}
	);
	log('ink helloed');
	ink.send({
		type: 'EnsureProject',
		path: inkCwd,
		projectType: 'coding',
		displayName: path.basename(inkCwd)
	});
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (events.includes('command_result')) break;
		await new Promise(r => setTimeout(r, 50));
	}
	log(`done inkEvents=${events.join(',')}`);
	if (!events.includes('command_result')) {
		process.exitCode = 1;
		log('FAIL: ink never got EnsureProject command_result (HOL?)');
	} else {
		log('PASS');
	}
} catch (e) {
	process.exitCode = 1;
	log(`FAIL ${e instanceof Error ? e.message : e}`);
} finally {
	try {
		ink.stop();
	} catch {
		/* ignore */
	}
	try {
		stuck.destroy();
	} catch {
		/* ignore */
	}
	try {
		const pid = Number(readFileSync(path.join(runDir, 'bridge.pid'), 'utf8').trim());
		if (pid > 0) process.kill(pid, 'SIGTERM');
	} catch {
		/* ignore */
	}
	const logDir = path.join(home, '.fast', 'logs');
	if (existsSync(logDir)) {
		for (const f of readdirSync(logDir)) {
			const text = readFileSync(path.join(logDir, f), 'utf8');
			if (text.trim()) {
				console.log('---', f, '---');
				console.log(text.slice(-1500));
			}
		}
	}
	rmSync(runDir, {recursive: true, force: true});
	rmSync(home, {recursive: true, force: true});
	rmSync(ideCwd, {recursive: true, force: true});
	rmSync(inkCwd, {recursive: true, force: true});
}
