/**
 * Isolated HOME/run/runtime + stub model catalog for the engine E2E.
 * The engine resolves `conf/models.yaml` by walking up from its cwd, so the
 * fixture project dir owns the catalog: no DB overlay, no real provider.
 */
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {placedEngineCli} from '@fastllm/bridge-client';

export const desktopPackageDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

const devEngineRoot = path.resolve(desktopPackageDir, '../../..');

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
			...(existsSync(path.join(devEngineRoot, 'modules/engine/current/conf/engines.yaml'))
				? {FAST_ENGINES_YAML: path.join(devEngineRoot, 'modules/engine/current/conf/engines.yaml')}
				: {}),
			FAST_BUNDLED_ENGINE: '',
			ELECTRON_RESOURCES_PATH: '',
			FAST_DSH_PORT: ''
		},
		cleanup: () => rm(root, {recursive: true, force: true})
	};
}

/** undefined when no engine binary is placed (the test skips instead of failing). */
export function engineCommandFor(env: Record<string, string>): string[] | undefined {
	const merged = {...process.env, ...env, FAST_BUNDLED_ENGINE: '', ELECTRON_RESOURCES_PATH: ''};
	const cli = placedEngineCli([desktopPackageDir], merged);
	if (!cli) return undefined;
	spawnSync('bash', [path.resolve(desktopPackageDir, '../../../scripts/patch-engine-java.sh'), path.resolve(cli, '../..')], {stdio: 'ignore'});
	return [cli, 'engine', '--mode', 'bridge', '--transport', 'stdio', '--new'];
}
