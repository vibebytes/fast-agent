/**
 * Isolate unix Bridge e2e from the developer's live ~/.fast/server.
 *
 * Node uses HOME/FAST_RUN_DIR for sock/token; the JVM ignores HOME for
 * user.home on macOS — pass -Duser.home / -Dfast.runtime.root via JAVA_OPTS.
 *
 * Engine: walk up for modules/engine/current (pnpm fetch-engine).
 */
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function walkCurrent(start: string): string | undefined {
	let dir = path.resolve(start);
	for (let i = 0; i < 12; i++) {
		const candidate = path.join(dir, 'modules', 'engine', 'current');
		if (
			['fast-cli', 'fast', 'agent-cli', 'fast-cli.bat', 'fast.bat', 'agent-cli.bat'].some(n =>
				existsSync(path.join(candidate, 'bin', n))
			)
		) {
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
}

function repoRoot(start: string): string {
	let dir = path.resolve(start);
	for (let i = 0; i < 12; i++) {
		if (
			existsSync(path.join(dir, 'pnpm-workspace.yaml')) &&
			existsSync(path.join(dir, 'modules', 'engine'))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(start);
}

/** `modules/engine/current` — walk from cwd / this file. */
export function defaultAgentHome(): string {
	return (
		walkCurrent(process.cwd()) ??
		walkCurrent(path.dirname(fileURLToPath(import.meta.url))) ??
		path.join(repoRoot(process.cwd()), 'modules', 'engine', 'current')
	);
}

export function defaultAgentCli(home = defaultAgentHome()): string {
	const names = ['fast-cli', 'fast', 'agent-cli', 'fast-cli.bat', 'fast.bat', 'agent-cli.bat'];
	for (const n of names) {
		const direct = path.join(home, 'bin', n);
		if (existsSync(direct)) return direct;
	}
	for (const n of names) {
		const nested = path.join(home, 'engine', 'bin', n);
		if (existsSync(nested)) return nested;
	}
	return path.join(home, 'bin', 'fast-cli');
}

export type UnixE2eDirs = {
	home: string;
	runDir: string;
	runtimeRoot: string;
};

export function applyUnixE2eEnv(
	dirs: UnixE2eDirs,
	extra: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
	mkdirSync(dirs.runtimeRoot, {recursive: true});
	const prev: Record<string, string | undefined> = {
		HOME: process.env.HOME,
		FAST_RUN_DIR: process.env.FAST_RUN_DIR,
		JAVA_OPTS: process.env.JAVA_OPTS,
		FAST_AGENT_ROOT: process.env.FAST_AGENT_ROOT,
		FAST_BUNDLED_ENGINE: process.env.FAST_BUNDLED_ENGINE,
		FAST_BRIDGE_TRANSPORT: process.env.FAST_BRIDGE_TRANSPORT,
		FAST_ENGINE_TRANSPORT: process.env.FAST_ENGINE_TRANSPORT,
		...Object.fromEntries(Object.keys(extra).map(k => [k, process.env[k]]))
	};

	const javaOpts = [
		process.env.JAVA_OPTS,
		`-Duser.home=${dirs.home}`,
		`-Dfast.runtime.root=${dirs.runtimeRoot}`
	]
		.filter(Boolean)
		.join(' ');

	process.env.HOME = dirs.home;
	process.env.FAST_RUN_DIR = dirs.runDir;
	process.env.JAVA_OPTS = javaOpts;
	delete process.env.FAST_BRIDGE_TRANSPORT;
	delete process.env.FAST_ENGINE_TRANSPORT;
	for (const [k, v] of Object.entries(extra)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	return prev;
}

export function restoreEnv(prev: Record<string, string | undefined>): void {
	for (const [k, v] of Object.entries(prev)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
}

export function runtimeRootUnder(home: string): string {
	return path.join(home, '.fast', 'server');
}
