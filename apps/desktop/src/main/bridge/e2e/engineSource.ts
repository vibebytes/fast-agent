/**
 * Engine source resolution for the bridge E2E tier.
 *
 * FAST_E2E_ENGINE drives which engine binary the integration tests drive:
 *   'placed' (default) — fast/modules/engine/current (skip when absent)
 *   'stage'            — sbt cli/Universal/stage of the ../agent repo, rebuilt
 *                        when agent sources are newer than the staged jars;
 *                        dsh/example extensions + engines.yaml are synced from
 *                        the placed engine so the A-side stays agent-fresh
 *   <path>             — a dist directory containing bin/fast-cli, used as-is
 */
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const desktopPackageDir = path.resolve(here, '../../../..');
export const fastRepoRoot = path.resolve(desktopPackageDir, '../..');
export const agentRepoRoot = path.join(path.resolve(fastRepoRoot, '..'), 'agent');
export const placedEngineDir = path.join(fastRepoRoot, 'modules', 'engine', 'current');

export type EngineSourcePlan = 'placed' | 'stage' | 'dir';

export function planEngineSource(raw: string | undefined): EngineSourcePlan {
	if (!raw || raw === 'placed') return 'placed';
	if (raw === 'stage') return 'stage';
	return 'dir';
}

export type StageFreshness = 'fresh' | 'stale' | 'missing';

export function stageFreshness(srcMtimes: number[], jarMtimes: number[] | undefined): StageFreshness {
	if (!jarMtimes || jarMtimes.length === 0) return 'missing';
	const src = srcMtimes.length ? Math.max(...srcMtimes) : 0;
	return src > Math.max(...jarMtimes) ? 'stale' : 'fresh';
}

export function stageCliFor(agentRoot = agentRepoRoot): string {
	return path.join(agentRoot, 'modules', 'cli', 'cli', 'target', 'universal', 'stage', 'bin', 'fast-cli');
}

export function collectSourceMtimes(agentRoot = agentRepoRoot): number[] {
	const out: number[] = [];
	if (existsSync(path.join(agentRoot, 'build.sbt'))) out.push(statSync(path.join(agentRoot, 'build.sbt')).mtimeMs);
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, {withFileTypes: true})) {
			if (e.name === 'target' || e.name === 'node_modules') continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (/\.(scala|java|sbt|yaml|yml)$/.test(e.name)) out.push(statSync(full).mtimeMs);
		}
	};
	walk(path.join(agentRoot, 'modules'));
	walk(path.join(agentRoot, 'project'));
	return out;
}

export function collectStageJarMtimes(stageDir: string): number[] | undefined {
	const lib = path.join(stageDir, 'lib');
	if (!existsSync(lib)) return undefined;
	return readdirSync(lib)
		.filter(f => f.endsWith('.jar'))
		.map(f => statSync(path.join(lib, f)).mtimeMs);
}

export function placedVersion(dir = placedEngineDir): string {
	const lib = path.join(dir, 'lib');
	if (!existsSync(lib)) return 'unknown';
	for (const f of readdirSync(lib)) {
		const m = /^agent-coding_3-(.+)\.jar$/.exec(f);
		if (m) return m[1];
	}
	return 'unknown';
}

export function syncStageBSide(stageDir: string): void {
	const enginesYaml = path.join(placedEngineDir, 'conf', 'engines.yaml');
	if (existsSync(enginesYaml)) cpSync(enginesYaml, path.join(stageDir, 'conf', 'engines.yaml'));
	for (const name of ['dsh', 'example']) {
		const from = path.join(placedEngineDir, 'extensions', name);
		if (existsSync(from)) cpSync(from, path.join(stageDir, 'extensions', name), {recursive: true});
	}
}

export type StageEngine = {cli: string; freshness: StageFreshness; rebuilt: boolean; provenance: string};

export function ensureStageEngine(): StageEngine {
	const cli = stageCliFor();
	const stageDir = path.dirname(path.dirname(cli));
	const freshness = stageFreshness(collectSourceMtimes(), collectStageJarMtimes(stageDir));
	const rebuilt = freshness !== 'fresh';
	if (rebuilt) {
		const r = spawnSync('sbt', ['cli/Universal/stage'], {cwd: agentRepoRoot, stdio: 'inherit'});
		if (r.status !== 0 || !existsSync(cli)) {
			throw new Error(`FAST_E2E_ENGINE=stage: sbt cli/Universal/stage failed (exit ${r.status}) — fix the agent build or use FAST_E2E_ENGINE=placed`);
		}
	}
	syncStageBSide(stageDir);
	const jarMtimes = collectStageJarMtimes(stageDir) ?? [];
	const built = jarMtimes.length ? new Date(Math.max(...jarMtimes)).toISOString() : 'unknown';
	return {cli, freshness, rebuilt, provenance: `stage agent@${gitSha(agentRepoRoot)} built ${built}`};
}

function gitSha(repo: string): string {
	const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: repo, encoding: 'utf8'});
	return r.status === 0 ? r.stdout.trim() : 'unknown';
}
