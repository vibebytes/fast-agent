import {existsSync as fsExistsSync} from 'node:fs';
import {placedEngineCli, resourcesEngineCli} from '@fastllm/bridge-client';
import {mobileBridgeEnabled} from './mobileBridgeToken.js';

export type EngineLaunch = {
	command: string;
	args: string[];
	cwd: string;
};

export type SessionLaunchMode = 'new' | 'continue' | 'resume';

export type ResolveEngineLaunchOptions = {
	workspaceRoot: string;
	env?: NodeJS.ProcessEnv;
	/** When set and present on disk (or forced in tests), used if FAST_ENGINE_COMMAND is unset. */
	bundledEnginePath?: string;
	existsSync?: (path: string) => boolean;
	/** Session restore policy (default: continue latest, matching cli-ink). */
	sessionMode?: SessionLaunchMode;
	resumeSessionId?: string;
	/** Default unix for daemon spawn; stdio for tests / FAST_BRIDGE_TRANSPORT=stdio. */
	transport?: 'unix' | 'stdio';
	socketPath?: string;
};

/** Default args for Machine-scoped Bridge host (unix). */
export const DEFAULT_BRIDGE_ARGS = ['engine', '--mode', 'bridge', '--transport', 'unix'] as const;

/** Stdio escape hatch (unit tests / e2e). */
export const DEFAULT_STDIO_BRIDGE_ARGS = ['engine', '--mode', 'bridge', '--transport', 'stdio'] as const;

/**
 * Resolve Engine session-restore flags (aligned with cli-ink `resolveSessionArgs`).
 * Default is `--continue` so opening a Project reloads the latest saved session.
 */
export function resolveSessionArgs(options?: {
	mode?: SessionLaunchMode;
	sessionId?: string;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const env = options?.env ?? process.env;
	if (options?.mode === 'new') return ['--new'];
	if (options?.mode === 'resume' && options.sessionId) {
		return ['--resume', options.sessionId];
	}
	if (env.FAST_SESSION === 'new') return ['--new'];
	if (env.FAST_RESUME?.trim()) return ['--resume', env.FAST_RESUME.trim()];
	return ['--continue'];
}

function alreadyHasSessionFlag(args: string[]): boolean {
	return (
		args.includes('--continue') ||
		args.includes('--new') ||
		args.includes('-n') ||
		args.includes('--resume')
	);
}

function withSessionArgs(base: string[], sessionArgs: string[]): string[] {
	if (alreadyHasSessionFlag(base)) return base;
	return [...base, ...sessionArgs];
}

export function lanWssArgs(env: NodeJS.ProcessEnv = process.env): string[] {
	if (!mobileBridgeEnabled(env)) return [];
	const raw = env.FAST_MOBILE_BRIDGE_PORT?.trim();
	const port = raw ? Number(raw) : 1979;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`FAST_MOBILE_BRIDGE_PORT invalid: ${raw}`);
	}
	return ['--wss', `0.0.0.0:${port}`];
}

function alreadyHasLanWss(args: string[]): boolean {
	if (args.includes('--wss')) return true;
	const i = args.indexOf('--ws');
	const hp = i >= 0 ? (args[i + 1] ?? '') : '';
	return hp.startsWith('0.0.0.0:');
}

function withLanWss(base: string[], env: NodeJS.ProcessEnv): string[] {
	if (alreadyHasLanWss(base)) return base;
	return [...base, ...lanWssArgs(env)];
}

function defaultTransportArgs(
	transport: 'unix' | 'stdio',
	socketPath?: string
): string[] {
	if (transport === 'stdio') return [...DEFAULT_STDIO_BRIDGE_ARGS];
	const args: string[] = [...DEFAULT_BRIDGE_ARGS];
	if (socketPath) {
		args.push('--socket', socketPath);
	}
	return args;
}

/**
 * Resolve how to spawn the Engine for a Project workspace.
 * Dev: FAST_ENGINE_COMMAND + FAST_ENGINE_ARGS (cli-ink compatible).
 * cwd is always the Project working directory.
 * Session args default to `--continue` (cli-ink parity).
 *
 * Default transport is **unix** (Machine-scoped Bridge host). Pass
 * `transport: 'stdio'` or set `FAST_BRIDGE_TRANSPORT=stdio` for the legacy pipe.
 */
export function resolveEngineLaunch(options: ResolveEngineLaunchOptions): EngineLaunch {
	const env = options.env ?? process.env;
	const cwd = options.workspaceRoot;
	const exists = options.existsSync ?? fsExistsSync;
	const transport =
		options.transport ??
		((env.FAST_BRIDGE_TRANSPORT ?? '').trim().toLowerCase() === 'stdio' ? 'stdio' : 'unix');
	const sessionArgs = resolveSessionArgs({
		mode: options.sessionMode,
		sessionId: options.resumeSessionId,
		env
	});

	if (env.FAST_ENGINE_COMMAND) {
		const base =
			env.FAST_ENGINE_ARGS?.split(/\s+/).filter(Boolean) ??
			defaultTransportArgs(transport, options.socketPath);
		return {
			command: env.FAST_ENGINE_COMMAND,
			args: withLanWss(withSessionArgs(base, sessionArgs), env),
			cwd
		};
	}

	const bundled =
		options.bundledEnginePath ?? env.FAST_BUNDLED_ENGINE?.trim() ?? resourcesEngineCli(env);
	if (bundled && exists(bundled)) {
		return {
			command: bundled,
			args: withLanWss(
				withSessionArgs(defaultTransportArgs(transport, options.socketPath), sessionArgs),
				env
			),
			cwd
		};
	}

	const placed = placedEngineCli([cwd], env);
	if (placed && exists(placed)) {
		return {
			command: placed,
			args: withLanWss(
				withSessionArgs(defaultTransportArgs(transport, options.socketPath), sessionArgs),
				env
			),
			cwd
		};
	}

	throw new Error(
		'No Engine configured. Run ./scripts/fetch-engine.sh, or set FAST_ENGINE_COMMAND.'
	);
}
