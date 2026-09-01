import {mkdtempSync, mkdirSync, writeFileSync, realpathSync, readFileSync, rmSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BridgeHost} from '../../../../packages/core/bridge/client/dist/BridgeHost.js';
import {currentEngineCli, currentEngineDir} from '../../../../scripts/current-engine.mjs';

const downloadsRoot = currentEngineDir();
const bundledEngine = currentEngineCli();
if (!bundledEngine || !existsSync(bundledEngine)) {
	console.error('missing modules/engine/current/bin/fast-cli — pnpm fetch-engine');
	process.exit(1);
}
const runDir = mkdtempSync(path.join(tmpdir(), 'fast-probe-run-'));
const home = mkdtempSync(path.join(tmpdir(), 'fast-probe-home-'));
const cwd = mkdtempSync(path.join(tmpdir(), 'fast-probe-cwd-'));
mkdirSync(path.join(home, '.fast'), {recursive: true});
writeFileSync(path.join(home, '.fast', 'trusted-workspaces'), `${realpathSync.native(cwd)}\n`);

const events = [];
const t0 = Date.now();
const log = m => console.log(`[${Date.now() - t0}ms] ${m}`);

const host = new BridgeHost();
const env = {
	...process.env,
	HOME: home,
	FAST_RUN_DIR: runDir,
	FAST_AGENT_ROOT: downloadsRoot,
	FAST_BUNDLED_ENGINE: bundledEngine
};
delete env.FAST_BRIDGE_TRANSPORT;
delete env.FAST_ENGINE_TRANSPORT;

try {
	await host.connect(
		{clientKind: 'fast-ink', clientId: 'probe-1', cwd, env, heartbeatMs: 0},
		{
			onEvent: e => {
				events.push(e.type);
				log(`EVENT ${e.type} name=${e.name ?? ''} status=${e.status ?? ''} sessionId=${e.sessionId ?? ''} projectId=${e.projectId ?? ''}`);
			},
			onError: m => log(`ERROR ${m}`),
			onClose: () => log('CLOSE')
		}
	);
	log('connected+helloed');
	await new Promise(r => setTimeout(r, 200));
	const sent = host.send({
		type: 'EnsureProject',
		path: cwd,
		projectType: 'coding',
		displayName: path.basename(cwd)
	});
	log(`EnsureProject sent=${sent}`);

	const deadline = Date.now() + 45_000;
	while (Date.now() < deadline) {
		if (events.includes('command_result') || events.includes('workspace_meta')) break;
		await new Promise(r => setTimeout(r, 100));
	}
	log(`done events=${events.join(',')}`);
} catch (e) {
	log(`FAIL ${e instanceof Error ? e.message : e}`);
} finally {
	try {
		host.stop();
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
			console.log('---', f, '---');
			console.log(readFileSync(path.join(logDir, f), 'utf8').slice(-2500));
		}
	}
	rmSync(runDir, {recursive: true, force: true});
	rmSync(home, {recursive: true, force: true});
	rmSync(cwd, {recursive: true, force: true});
}
