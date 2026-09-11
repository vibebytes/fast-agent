/**
 * Real dshd sidecar for the engine E2E.
 *
 * Spawns the desktop app's installed `dsh web` daemon on a pinned port with an
 * isolated HOME, captures the startup banner (port + token), writes the token
 * where DshProcess probes it (`<runtime>/engines/dsh/.token`) and exposes the
 * env that makes the engine attach instead of installing/spawning its own:
 *   FAST_DSH_PORT      — pinned port (attach path)
 *   FAST_DSH_COMMAND   — wrapper re-exec of the same daemon (spawn fallback)
 *   FAST_DSH_TOKEN     — banner token
 * Also writes <FAST_RUNTIME_ROOT>/conf/engines.overlay.yaml enabling the dsh
 * engine entry (EngineLoad reads the overlay relative to FAST_RUNTIME_ROOT).
 */
import {spawn, execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {chmod, cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {EngineFixture} from './engineE2eFixture.js';

const DSHD_BIN =
	process.env.FAST_E2E_DSHD_BIN ??
	path.join(os.homedir(), 'Library/Application Support/@fast-ide/desktop/runtime/engines/dsh/node_modules/.bin/dsh');

// dsh needs node >= 20 (node:util parseEnv); the ambient PATH may carry node 18
const resolveNodeBin = (): string => {
	if (process.env.FAST_E2E_NODE) return process.env.FAST_E2E_NODE;
	const bundled = '/Applications/Fast.app/Contents/Resources/bin/node';
	return existsSync(bundled) ? bundled : 'node';
};

export type DshScenario = {
	port: number;
	dshEnv: Record<string, string>;
	dshdLog: () => string;
	cleanup: () => Promise<void>;
};

const waitPort = (port: number, timeoutMs: number): Promise<void> =>
	new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const attempt = (): void => {
			const probe = net.connect({port, host: '127.0.0.1'});
			probe.once('connect', () => {
				probe.destroy();
				resolve();
			});
			probe.once('error', () => {
				probe.destroy();
				if (Date.now() > deadline) reject(new Error(`dshd never listened on 127.0.0.1:${port}`));
				else setTimeout(attempt, 200);
			});
		};
		attempt();
	});

const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const {port} = server.address() as {port: number};
			server.close(() => resolve(port));
		});
	});

const killPort = (port: number): void => {
	try {
		const pids = execSync(`lsof -ti tcp:${port}`, {encoding: 'utf8'});
		for (const pid of pids.split('\n').filter(Boolean)) {
			try {
				process.kill(Number(pid), 'SIGKILL');
			} catch {
				/* already gone */
			}
		}
	} catch {
		/* nothing listening */
	}
};

const waitBannerToken = (getBanner: () => string, timeoutMs: number): Promise<string | undefined> =>
	new Promise(resolve => {
		const deadline = Date.now() + timeoutMs;
		const attempt = (): void => {
			const m = getBanner().match(/token=([A-Za-z0-9._~+-]+)/);
			if (m) resolve(m[1]);
			else if (Date.now() > deadline) resolve(undefined);
			else setTimeout(attempt, 200);
		};
		attempt();
	});

export async function startDshScenario(fixture: EngineFixture, engineCliPath: string, stubLlmBaseUrl: string): Promise<DshScenario> {
	if (!existsSync(DSHD_BIN)) {
		throw new Error(`dsh CLI not installed at ${DSHD_BIN} — open the desktop app once or set FAST_E2E_DSHD_BIN`);
	}
	const extYamlPath = path.join(path.dirname(path.dirname(engineCliPath)), 'conf', 'extensions.yaml');
	const extYaml = await readFile(extYamlPath, 'utf8');
	const extYamlOriginal = /^\s*dsh:/m.test(extYaml) ? null : extYaml;
	if (extYamlOriginal !== null) {
		await writeFile(extYamlPath, extYaml.replace(/^(extensions:\s*$)/m, '$1\n  dsh:\n    enabled: true\n    apiVersion: "1"\n'));
	}
	const port = await freePort();
	const nodeBin = resolveNodeBin();
	const dshRoot = path.join(fixture.env.FAST_RUNTIME_ROOT, 'engines', 'dsh');
	const home = path.join(fixture.env.HOME, 'dshd-home');
	await mkdir(dshRoot, {recursive: true});
	await mkdir(home, {recursive: true});
	await writeFile(path.join(dshRoot, '.installed'), '');

	const child = spawn(DSHD_BIN, ['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			HOME: home,
			// dsh session turns default to the deepseek-official llm route; point
			// it at the E2E stub so no real key/network is needed
			DEEPSEEK_API_KEY: 'e2e-stub-key',
			DEEPSEEK_BASE_URL: stubLlmBaseUrl,
			PATH: `${path.dirname(nodeBin)}:${process.env.PATH ?? ''}`
		}
	});
	let banner = '';
	child.stdout.on('data', (chunk: Buffer) => {
		banner += chunk.toString();
	});
	child.stderr.on('data', (chunk: Buffer) => {
		banner += chunk.toString();
	});
	await waitPort(port, 20_000);
	const bannerMatch = await waitBannerToken(() => banner, 15_000);
	const token = bannerMatch ?? process.env.FAST_E2E_DSH_TOKEN;
	if (!token) throw new Error(`dshd banner had no token (first 400 chars): ${banner.slice(0, 400)}`);
	await writeFile(path.join(dshRoot, '.token'), token);

	const wrapper = path.join(dshRoot, 'dshd-wrapper.sh');
	await writeFile(wrapper, `#!/bin/sh\nexec "${DSHD_BIN}" web --no-open --host 127.0.0.1 --port ${port}\n`);
	await chmod(wrapper, 0o755);

	const overlay = path.join(fixture.env.FAST_RUNTIME_ROOT, 'conf', 'engines.overlay.yaml');
	await mkdir(path.dirname(overlay), {recursive: true});
	await writeFile(
		overlay,
		['apiVersion: "1"', 'engines:', '  - id: dsh', '    enabled: true', '    apiVersion: "1"', ''].join('\n')
	);
	// FAST_RUNTIME_ROOT/extensions is the engine's extension root in the E2E env
	// (EngineAssembly falls back to it when no fast.extensions prop is set); the
	// dsh jar must exist there or startOne warns StartFailed and the kind stays
	// unregistered ("unknown kind: dsh").
	const extSource = path.join(path.dirname(path.dirname(engineCliPath)), 'extensions', 'dsh');
	const extTarget = path.join(fixture.env.FAST_RUNTIME_ROOT, 'extensions', 'dsh');
	if (existsSync(extSource)) {
		await mkdir(path.dirname(extTarget), {recursive: true});
		await cp(extSource, extTarget, {recursive: true});
	}

	return {
		port,
		dshEnv: {
			FAST_DSH_PORT: String(port),
			FAST_DSH_COMMAND: wrapper,
			// engine may fall back to spawning the wrapper; its shim needs node >= 20
			PATH: `${path.dirname(nodeBin)}:${process.env.PATH ?? ''}`,
			...(token ? {FAST_DSH_TOKEN: token} : {})
		},
		dshdLog: () => banner,
		cleanup: async () => {
			if (extYamlOriginal !== null) await writeFile(extYamlPath, extYamlOriginal);
			child.kill('SIGTERM');
			await new Promise(r => setTimeout(r, 300));
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			killPort(port);
		}
	};
}
