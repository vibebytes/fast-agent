/**
 * Isolated HOME/run/runtime + stub model catalog for the engine E2E.
 * The engine resolves `conf/models.yaml` by walking up from its cwd, so the
 * fixture project dir owns the catalog: no DB overlay, no real provider.
 */
import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {placedEngineCli} from '@fastllm/bridge-client';
import {ensureStageEngine, planEngineSource, placedEngineDir, placedVersion} from './engineSource.js';

export const desktopPackageDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

const devEngineRoot = path.resolve(desktopPackageDir, '../../..');

const dumpLogs = async (root: string): Promise<string | null> => {
	try {
		const kept = path.join(tmpdir(), 'fast-e2e-logs', `${path.basename(root)}-${Date.now()}`);
		let found = false;
		const walk = async (dir: string): Promise<void> => {
			for (const entry of await readdir(dir, {withFileTypes: true})) {
				const p = path.join(dir, entry.name);
				if (entry.isDirectory()) await walk(p);
				else if (/\.(log|out|err)$/.test(entry.name)) {
					found = true;
					const dest = path.join(kept, path.relative(root, p));
					await mkdir(path.dirname(dest), {recursive: true});
					await copyFile(p, dest);
				}
			}
		};
		await walk(root);
		return found ? kept : null;
	} catch {
		return null;
	}
};

export type EngineFixture = {
	root: string;
	project: string;
	env: Record<string, string>;
	cleanup: () => Promise<void>;
};

export function stubCatalogYaml(baseUrl: string): string {
	return [
		'defaults:',
		'  completionsPath: /chat/completions',
		'  maxTokens: 4096',
		'  temperature: 0.0',
		'dynamicPlatform: stub',
		'platforms:',
		'  stub:',
		`    baseUrl: ${baseUrl}`,
		'    provider: openai-compat',
		'    models:',
		'      stub-model:',
		'        modelName: stub-model',
		'        aliases: [default]',
		'        supportsThinking: true',
		'        supportedEfforts: [low, medium, high]',
		'        defaultEffort: medium',
		''
	].join('\n');
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const {port} = server.address() as {port: number};
			server.close(() => resolve(port));
		});
	});
}

export async function makeEngineFixture(baseUrl: string): Promise<EngineFixture> {
	const root = await mkdtemp(path.join(tmpdir(), 'fast-engine-e2e-'));
	const project = path.join(root, 'project');
	await mkdir(path.join(project, 'conf'), {recursive: true});
	await mkdir(path.join(root, 'home'), {recursive: true});
	await mkdir(path.join(root, 'run'), {recursive: true});
	await mkdir(path.join(root, 'runtime'), {recursive: true});
	await writeFile(path.join(project, 'conf', 'models.yaml'), stubCatalogYaml(baseUrl));
	const [agentPort, agentHttpPort] = await Promise.all([freePort(), freePort()]);
	return {
		root,
		project,
		env: {
			HOME: path.join(root, 'home'),
			FAST_RUN_DIR: path.join(root, 'run'),
			FAST_RUNTIME_ROOT: path.join(root, 'runtime'),
			FAST_SESSION: 'new',
			FAST_USE_SYSTEM_JAVA: '1',
			FAST_AGENT_PORT: String(agentPort),
			FAST_AGENT_HTTP_PORT: String(agentHttpPort),
			...(process.env.FAST_ENGINES_YAML
				? {FAST_ENGINES_YAML: process.env.FAST_ENGINES_YAML}
				: existsSync(path.join(devEngineRoot, 'modules/engine/current/conf/engines.yaml'))
					? {FAST_ENGINES_YAML: path.join(devEngineRoot, 'modules/engine/current/conf/engines.yaml')}
					: {}),
			FAST_BUNDLED_ENGINE: '',
			ELECTRON_RESOURCES_PATH: '',
			FAST_DSH_PORT: ''
		},
		cleanup: async () => {
			const kept = await dumpLogs(root);
			if (kept) console.log(`[engine-e2e] logs preserved: ${kept}`);
			if (process.env.FAST_E2E_KEEP_ROOT) {
				console.log(`[engine-e2e] root preserved: ${root}`);
				return;
			}
			for (let i = 0; ; i++) {
				try {
					await rm(root, {recursive: true, force: true});
					return;
				} catch (err) {
					if (i >= 2) throw err;
					await new Promise(r => setTimeout(r, 1000));
				}
			}
		}
	};
}

export type EngineLaunch = {
	command: string[];
	kind: 'placed' | 'stage' | 'dir';
	source: string;
};

const ENGINE_ARGS = ['engine', '--mode', 'bridge', '--transport', 'stdio'];

/**
 * `--new` mints a boot session and binds it to the workspace hash, which shadows
 * any session the caller later attaches to. Reopen phases must omit it so the
 * engine restores the existing session instead of minting a fresh one.
 */
export type EngineLaunchOptions = {newSession?: boolean};

/** undefined only in the placed tier when no engine binary is placed (the test skips instead of failing). */
export function engineCommandFor(env: Record<string, string>, opts: EngineLaunchOptions = {}): EngineLaunch | undefined {
	// FAST_E2E_ENGINE is a test-only knob: it lives on neither process.env's nor the
	// fixture env's declared type, so read it explicitly instead of off the merge.
	const merged: Record<string, string> = {
		...process.env,
		...env,
		FAST_BUNDLED_ENGINE: '',
		ELECTRON_RESOURCES_PATH: ''
	};
	const args = opts.newSession === false ? ENGINE_ARGS : [...ENGINE_ARGS, '--new'];
	const plan = planEngineSource(merged.FAST_E2E_ENGINE);
	if (plan === 'stage') {
		const stage = ensureStageEngine();
		return {command: [stage.cli, ...args], kind: 'stage', source: stage.provenance};
	}
	if (plan === 'dir') {
		const dir = path.resolve(merged.FAST_E2E_ENGINE!);
		const cli = path.join(dir, 'bin', 'fast-cli');
		if (!existsSync(cli)) throw new Error(`FAST_E2E_ENGINE=${dir}: ${cli} not found (expected a dist layout with bin/fast-cli)`);
		return {command: [cli, ...args], kind: 'dir', source: `dir ${path.basename(dir)}`};
	}
	const cli = placedEngineCli([desktopPackageDir], merged);
	if (!cli) return undefined;
	spawnSync('bash', [path.resolve(desktopPackageDir, '../../../scripts/patch-engine-java.sh'), path.resolve(cli, '../..')], {stdio: 'ignore'});
	return {command: [cli, ...args], kind: 'placed', source: `placed ${placedVersion(placedEngineDir)}`};
}
