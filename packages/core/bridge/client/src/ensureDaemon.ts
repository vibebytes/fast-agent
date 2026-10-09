import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
	type PathLike
} from 'node:fs';
import {createRotatingLogStream} from './rotatingLog.js';
import os from 'node:os';
import path from 'node:path';
import {bridgePaths} from './paths.js';
import {tryConnectUnix} from './unixConnection.js';
import {shouldReplaceDaemon} from './engineIdentity.js';

export const CONNECT_TIMEOUT_MS = 5_000;
/** Cold Bridge boots commonly take 15–30s (Rocks + Hub seed + session resume). */
export const STARTUP_TIMEOUT_MS = 90_000;
/**
 * How long a non-numeric `bridge.pid` ("starting") may sit with no live Bridge JVM
 * before the claim is treated as a dead spawn and cleared (pidfile only).
 */
export const STARTING_CLAIM_GRACE_MS = 15_000;

export type EnsureDaemonResult = {
	socketPath: string;
	token: string;
	spawned: boolean;
};

export type EnsureDaemonDeps = {
	env?: NodeJS.ProcessEnv;
	connectTimeoutMs?: number;
	startupTimeoutMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	tryConnect?: (socketPath: string) => Promise<boolean>;
	isPidAlive?: (pid: number) => boolean;
	readPid?: (pidFile: string) => number | undefined;
	unlink?: (p: string) => void;
	/** Exclusive create of claim file; throw if exists. */
	claimPidExclusive?: (pidFile: string) => void;
	spawnDaemon?: (command: string, args: string[], opts: {cwd?: string; env: NodeJS.ProcessEnv; logDir: string}) => ChildProcess | undefined;
	readToken?: (tokenFile: string) => string;
	exists?: (p: string) => boolean;
	ensureDir?: (p: string) => void;
	engineLaunch?: (
		socketPath: string,
		env: NodeJS.ProcessEnv,
		loopbackWsPort?: number
	) => {command: string; args: string[]; cwd?: string};
	/** Cloudflare tunnel origin (cloudflare-tunnel-pairing.md §4.6.3): daemon also opens loopback plaintext `--ws 127.0.0.1:<port>`. */
	loopbackWsPort?: number;
	/** PIDs holding `~/.fast/server/rocks/LOCK` (spec §4.2 ENGINE_BUSY). */
	rocksLockHolders?: (lockPath: string) => number[];
	rocksLockPath?: (env: NodeJS.ProcessEnv) => string;
	/** `ps` command line for a pid; used to reject PID-reuse false owners. */
	commandLine?: (pid: number) => string | undefined;
	/** Live Bridge PIDs on *this* `FAST_RUNTIME_ROOT`. */
	liveBridgePids?: () => number[];
	/** Every live Bridge JVM (any root). Used to attach when ports already match. */
	allBridgePids?: () => number[];
	wantEngineId?: string;
	bundledEngine?: string;
	killPid?: (pid: number, signal: NodeJS.Signals) => void;
};

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function isPidAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function readPidFile(pidFile: string): number | undefined {
	try {
		const raw = readFileSync(pidFile, 'utf8').trim();
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n : undefined;
	} catch {
		return undefined;
	}
}

/** O_EXCL claim so only one client races to spawn. Non-numeric content so daemon can overwrite. */
export function claimPidExclusive(pidFile: string): void {
	mkdirSync(path.dirname(pidFile), {recursive: true, mode: 0o700});
	const fd = openSync(pidFile as PathLike, 'wx', 0o600);
	try {
		writeFileSync(fd, 'starting\n');
	} finally {
		closeSync(fd);
	}
}

function unlinkQuiet(p: string): void {
	try {
		unlinkSync(p);
	} catch {
		// ignore
	}
}

function readTokenFile(tokenFile: string): string {
	return readFileSync(tokenFile, 'utf8').trim();
}

/** `~/.fast/server/rocks/LOCK` (or `$FAST_RUNTIME_ROOT/rocks/LOCK`). */
export function rocksLockPath(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
	const root = env.FAST_RUNTIME_ROOT?.trim() || path.join(home, '.fast', 'server');
	return path.join(root, 'rocks', 'LOCK');
}

/** Best-effort: PIDs with an open handle on the Rocks LOCK file (macOS/Linux `lsof`). */
export function rocksLockHolders(lockPath: string): number[] {
	if (!existsSync(lockPath) || process.platform === 'win32') return [];
	try {
		const out = execFileSync('lsof', ['-t', lockPath], {
			encoding: 'utf8',
			timeout: 2_000,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return out
			.split(/\n/)
			.map(s => Number(s.trim()))
			.filter(n => Number.isFinite(n) && n > 0);
	} catch {
		// lsof exits non-zero when nobody holds the file
		return [];
	}
}

function aliveLockHolders(
	lockPath: string,
	holders: (p: string) => number[],
	alive: (pid: number) => boolean
): number[] {
	return holders(lockPath).filter(alive);
}

/**
 * PIDs this slot's own engine has claimed for itself: `instance.lock` (written by the
 * JVM at startup) and `bridge.pid`. The bundled Fast.app engine's command line is not
 * visible to `ps`/`pgrep`, so `liveBridgePids` cannot see it; these files are the only
 * reliable way to tell "our engine is booting" from "a foreign JVM holds Rocks".
 */
function slotEnginePids(runDir: string, readPid: (p: string) => number | undefined): number[] {
	const pids: number[] = [];
	for (const name of ['instance.lock', 'bridge.pid']) {
		const pid = readPid(path.join(runDir, name));
		if (pid !== undefined) pids.push(pid);
	}
	return pids;
}

export function engineCommandLine(pid: number): string | undefined {
	try {
		if (process.platform === 'win32') {
			const out = execFileSync(
				'wmic',
				['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
				{encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore']}
			);
			const m = out.match(/CommandLine=(.*)/);
			return m?.[1]?.trim() || undefined;
		}
		const out = execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
			encoding: 'utf8',
			timeout: 2_000,
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

/** True for Bridge hosts: `CliApp … engine … bridge` or bundled `fast-cli` / `fast` / legacy `agent-cli`. */
export function isBridgeEngineCommand(command: string): boolean {
	if (!command.includes('engine') || !command.includes('bridge')) return false;
	return (
		command.includes('ai.fastllm.agent.cli.CliApp') ||
		/(?:^|\/)(?:fast-cli|fast|agent-cli)(?:\.bat)?(?:\s|$)/.test(command)
	);
}

function stripFlagValue(raw: string): string {
	return raw.replace(/^["']|["']$/g, '');
}

/** `ps` leaves spaces inside unquoted `-D` / `--socket` values; the next argv starts with ` -`. */
const NEXT_ARGV = /(?=\s+-|\s*$)/;

function lastRuntimeRootFlag(command: string): string | undefined {
	const hits = [
		...command.matchAll(new RegExp(`-Dfast\\.runtime\\.root=(?:"([^"]+)"|'([^']+)'|(.+?))${NEXT_ARGV.source}`, 'g'))
	];
	const raw = hits.at(-1);
	if (!raw) return undefined;
	const value = stripFlagValue(raw[1] ?? raw[2] ?? raw[3] ?? '');
	return value || undefined;
}

function socketFlag(command: string): string | undefined {
	const m = command.match(
		new RegExp(`--socket(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(.+?))${NEXT_ARGV.source}`)
	);
	if (!m) return undefined;
	const value = stripFlagValue(m[1] ?? m[2] ?? m[3] ?? '');
	return value || undefined;
}

function lastIntProp(command: string, prop: string): number | undefined {
	const hits = [...command.matchAll(new RegExp(`-D${prop}=(\\d+)`, 'g'))];
	const n = Number(hits.at(-1)?.[1]);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function lastBindPort(command: string, flag: string): number | undefined {
	const hits = [...command.matchAll(new RegExp(`${flag}(?:=|\\s+)(\\S+)`, 'g'))];
	const n = Number(hits.at(-1)?.[1]?.split(':').pop());
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function envPort(env: NodeJS.ProcessEnv, keys: readonly string[], fallback: number): number {
	for (const key of keys) {
		const raw = env[key]?.trim();
		if (!raw) continue;
		const n = Number(raw.includes(':') ? raw.split(':').pop() : raw);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return fallback;
}

/** Ports this slot will bind — same defaults as Scala `Ports.load`. */
export function slotPorts(env: NodeJS.ProcessEnv = process.env): {enroll: number; wss: number; ws: number} {
	return {
		enroll: envPort(env, ['FAST_JOIN_PORT', 'FAST_ENROLL_PORT'], 2580),
		wss: envPort(env, ['FAST_BRIDGE_WSS_PORT', 'FAST_BRIDGE_WSS'], 1979),
		ws: envPort(env, ['FAST_BRIDGE_WS_PORT', 'FAST_BRIDGE_WS'], 1981)
	};
}

/** Unix sock from `--socket` or `<last -Dfast.runtime.root=>/run/bridge.sock`. */
export function peerSocket(command: string): string | undefined {
	const sock = socketFlag(command);
	if (sock) return sock;
	const root = lastRuntimeRootFlag(command);
	if (!root) return undefined;
	return path.join(root, 'run', 'bridge.sock');
}

/**
 * True when this JVM already holds an enroll/wss/ws port we would bind.
 * Last `-D` / `--wss` / `--ws` wins; no marker ⇒ packaged defaults (2580/1979/1981).
 */
export function commandSharesSlotPorts(
	command: string,
	ports: {enroll: number; wss: number; ws: number}
): boolean {
	const enroll = lastIntProp(command, 'fast\\.enroll\\.port') ?? 2580;
	const wss = lastIntProp(command, 'fast\\.bridge\\.wss') ?? lastBindPort(command, '--wss') ?? 1979;
	const ws = lastIntProp(command, 'fast\\.bridge\\.ws') ?? lastBindPort(command, '--ws') ?? 1981;
	return (
		(ports.enroll > 0 && enroll === ports.enroll) ||
		(ports.wss > 0 && wss === ports.wss) ||
		(ports.ws > 0 && ws === ports.ws)
	);
}

function normalizeMarker(p: string): string {
	return path.normalize(path.resolve(p.trim()));
}

function markerOverlaps(candidate: string, roots: readonly string[]): boolean {
	if (!candidate) return false;
	const a = normalizeMarker(candidate);
	return roots.some(root => {
		const b = normalizeMarker(root);
		return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
	});
}

/** Resolved root / runDir / sock for this slot — two individuals must not share them. */
export function runtimeMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
	const paths = bridgePaths(env);
	const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
	const root = env.FAST_RUNTIME_ROOT?.trim() || path.join(home, '.fast');
	return [...new Set([root, paths.runDir, paths.socketPath].map(normalizeMarker))];
}

/**
 * Last `-Dfast.runtime.root=` (or `--socket`) wins. No marker → assume this slot
 * so a legacy cmdline still blocks a second JVM on the same root.
 */
export function commandOwnsThisRuntime(command: string, roots: readonly string[]): boolean {
	if (roots.length === 0) return true;
	const declared = lastRuntimeRootFlag(command);
	if (declared !== undefined) return markerOverlaps(declared, roots);
	const sock = socketFlag(command);
	if (sock !== undefined) return markerOverlaps(sock, roots);
	return true;
}

/**
 * Live pid owns the slot only if it is a Bridge engine on *this* runtime root.
 * Alive + non-bridge ⇒ PID reuse / stale pidfile (safe to clear).
 * Alive + unknown cmdline (`ps` failed) ⇒ treat as owner (do not steal).
 * Alive + Bridge on another `FAST_RUNTIME_ROOT` ⇒ not this slot.
 */
export function isLiveBridgeHost(
	pid: number,
	deps: {
		alive?: (pid: number) => boolean;
		commandLine?: (pid: number) => string | undefined;
		runtimeRoots?: readonly string[];
	} = {}
): boolean {
	const alive = deps.alive ?? isPidAlive;
	const commandLine = deps.commandLine ?? engineCommandLine;
	if (!alive(pid)) return false;
	const cmd = commandLine(pid);
	if (cmd === undefined) return true;
	if (!isBridgeEngineCommand(cmd)) return false;
	if (deps.runtimeRoots && !commandOwnsThisRuntime(cmd, deps.runtimeRoots)) return false;
	return true;
}

function ownsThisRuntimeOrUnknown(command: string | undefined, roots: readonly string[]): boolean {
	if (command === undefined) return true;
	return commandOwnsThisRuntime(command, roots);
}

/** Best-effort: Bridge hosts on *this* `FAST_RUNTIME_ROOT`. */
function liveBridgePidsWindows(roots: readonly string[]): number[] {
	try {
		const out = execFileSync(
			'wmic',
			['process', 'where', "CommandLine like '%ai.fastllm.agent.cli.CliApp%'", 'get', 'ProcessId,CommandLine', '/format:list'],
			{encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore']}
		);
		const found = new Set<number>();
		const blocks = out.split(/\r?\n\r?\n/);
		for (const block of blocks) {
			if (!/engine/i.test(block) || !/bridge/i.test(block)) continue;
			if (!ownsThisRuntimeOrUnknown(block, roots)) continue;
			const m = block.match(/ProcessId=(\d+)/i);
			const n = Number(m?.[1]);
			if (Number.isFinite(n) && n > 0 && n !== process.pid) found.add(n);
		}
		return [...found];
	} catch {
		return [];
	}
}

function allLiveBridgePidsUnix(): number[] {
	const patterns = [
		'ai.fastllm.agent.cli.CliApp.*engine.*bridge',
		'fast-cli.*engine.*bridge',
		'(^|/)fast .*engine.*bridge',
		'agent-cli.*engine.*bridge'
	];
	const found = new Set<number>();
	for (const pattern of patterns) {
		try {
			const out = execFileSync('pgrep', ['-f', pattern], {
				encoding: 'utf8',
				timeout: 2_000,
				stdio: ['ignore', 'pipe', 'ignore']
			});
			for (const line of out.split(/\n/)) {
				const n = Number(line.trim());
				if (Number.isFinite(n) && n > 0 && n !== process.pid) found.add(n);
			}
		} catch {
			// pgrep exit 1 = no matches
		}
	}
	return [...found];
}

export function allLiveBridgePids(): number[] {
	if (process.platform === 'win32') return liveBridgePidsWindows([]);
	return allLiveBridgePidsUnix();
}

export function liveBridgePids(env: NodeJS.ProcessEnv = process.env): number[] {
	const roots = runtimeMarkers(env);
	if (process.platform === 'win32') return liveBridgePidsWindows(roots);
	return allLiveBridgePidsUnix().filter(pid => ownsThisRuntimeOrUnknown(engineCommandLine(pid), roots));
}

export function engineBinName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? 'fast-cli.bat' : 'fast-cli';
}

function engineBinNames(platform: NodeJS.Platform = process.platform): readonly string[] {
	return platform === 'win32'
		? ['fast-cli.bat', 'fast.bat', 'agent-cli.bat']
		: ['fast-cli', 'fast', 'agent-cli'];
}

function existingEngineCli(binDir: string): string | undefined {
	for (const n of engineBinNames()) {
		const candidate = path.join(binDir, n);
		if (existsSync(candidate)) return candidate;
	}
}

/** `<root>/bin/<cli>` → `<root>/extensions`, unless FAST_EXTENSIONS is already set. */
export function engineExtensionsDir(
	env: NodeJS.ProcessEnv = process.env,
	cliPath: string,
	exists: (path: string) => boolean = existsSync
): string | undefined {
	if (env.FAST_EXTENSIONS?.trim()) return undefined;
	if (!/[\\/]/.test(cliPath)) return undefined;
	const dir = path.join(path.dirname(path.dirname(cliPath)), 'extensions');
	return exists(dir) ? dir : undefined;
}

/** Packaged Desktop / CLI: `$resources/engine/bin/fast-cli`. */
export function resourcesEngineCli(
	env: NodeJS.ProcessEnv = process.env,
	resourcesPath?: string
): string | undefined {
	const procResources = (process as NodeJS.Process & {resourcesPath?: string}).resourcesPath;
	const roots = [env.ELECTRON_RESOURCES_PATH, env.FAST_RESOURCES, resourcesPath, procResources];
	for (const root of roots) {
		if (!root?.trim()) continue;
		const found = existingEngineCli(path.join(root.trim(), 'engine', 'bin'));
		if (found) return found;
	}
}

/** Walk up from start dirs looking for `modules/engine/current/bin/fast-cli`. */
export function placedEngineCli(
	startDirs: Iterable<string | undefined> = [],
	env: NodeJS.ProcessEnv = process.env
): string | undefined {
	const starts = [...startDirs, env.FAST_AGENT_ROOT, env.INIT_CWD, process.cwd()];
	const seen = new Set<string>();
	for (const start of starts) {
		if (!start) continue;
		let dir = path.resolve(start);
		for (let i = 0; i < 10; i++) {
			if (seen.has(dir)) break;
			seen.add(dir);
			const found = existingEngineCli(path.join(dir, 'modules', 'engine', 'current', 'bin'));
			if (found) return found;
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
}

export function resolveDaemonLaunch(
	socketPath: string,
	env: NodeJS.ProcessEnv = process.env,
	loopbackWsPort?: number
): {command: string; args: string[]; cwd?: string} {
	const launch = resolveDaemonLaunchBase(socketPath, env);
	if (!loopbackWsPort) return launch;
	return {...launch, args: [...launch.args, '--ws', `127.0.0.1:${loopbackWsPort}`]};
}

function resolveDaemonLaunchBase(
	socketPath: string,
	env: NodeJS.ProcessEnv = process.env
): {command: string; args: string[]; cwd?: string} {
	const socketArgs = ['--transport', 'unix', '--socket', socketPath];
	const withSession = (args: string[]) =>
		hasSessionFlag(args) ? args : [...args, '--continue'];
	const runtimeRoot = env.FAST_RUNTIME_ROOT?.trim();
	const withRoot = (args: string[]) =>
		runtimeRoot ? [`-Dfast.runtime.root=${runtimeRoot}`, ...args] : args;
	const agentRoot = env.FAST_AGENT_ROOT?.trim();
	const withExtensions = (cli: string) => {
		const dir = engineExtensionsDir(env, cli);
		if (dir && env.FAST_EXTENSIONS === undefined) env.FAST_EXTENSIONS = dir;
		return cli;
	};
	if (env.FAST_ENGINE_COMMAND?.trim()) {
		const base = env.FAST_ENGINE_ARGS?.split(/\s+/).filter(Boolean) ?? [
			'engine',
			'--mode',
			'bridge'
		];
		const withoutTransport = stripTransportArgs(base);
		return {
			command: withExtensions(env.FAST_ENGINE_COMMAND.trim()),
			args: withRoot(withSession([...withoutTransport, ...socketArgs])),
			cwd: agentRoot
		};
	}
	const bundled =
		env.FAST_BUNDLED_ENGINE?.trim() ||
		(agentRoot ? existingEngineCli(path.join(agentRoot, 'engine', 'bin')) : undefined);
	if (bundled && existsSync(bundled)) {
		return {
			command: withExtensions(bundled),
			args: withRoot(withSession(['engine', '--mode', 'bridge', ...socketArgs])),
			cwd: agentRoot
		};
	}
	const fromResources = resourcesEngineCli(env);
	if (fromResources) {
		return {
			command: withExtensions(fromResources),
			args: withRoot(withSession(['engine', '--mode', 'bridge', ...socketArgs])),
			cwd: agentRoot
		};
	}
	const placed = placedEngineCli([agentRoot], env);
	if (placed) {
		return {
			command: withExtensions(placed),
			args: withRoot(withSession(['engine', '--mode', 'bridge', ...socketArgs])),
			cwd: path.dirname(path.dirname(placed))
		};
	}
	// Dev fallback: java -cp $FAST_ENGINE_CLASSPATH (parity with ink stdio classpath path).
	const classpath = env.FAST_ENGINE_CLASSPATH?.trim();
	if (classpath) {
		return {
			command: env.JAVA_COMMAND?.trim() || 'java',
			args: withRoot(withSession([
				'--add-opens=java.base/java.nio=ALL-UNNAMED',
				'-cp',
				classpath,
				'ai.fastllm.agent.cli.CliApp',
				'engine',
				'--mode',
				'bridge',
				...socketArgs
			])),
			cwd: agentRoot
		};
	}
	return {
		command: engineBinName(),
		args: withRoot(withSession(['engine', '--mode', 'bridge', ...socketArgs])),
		cwd: agentRoot
	};
}

function hasSessionFlag(args: string[]): boolean {
	return (
		args.includes('--continue') ||
		args.includes('--new') ||
		args.includes('-n') ||
		args.includes('--resume')
	);
}

function stripTransportArgs(args: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--transport' || a === '--socket') {
			i += 1;
			continue;
		}
		out.push(a!);
	}
	return out;
}

function defaultSpawnDaemon(
	command: string,
	args: string[],
	opts: {cwd?: string; env: NodeJS.ProcessEnv; logDir: string}
): ChildProcess {
	mkdirSync(opts.logDir, {recursive: true});
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const outLog = createRotatingLogStream(path.join(opts.logDir, `bridge-daemon-${stamp}.out.log`));
	const errLog = createRotatingLogStream(path.join(opts.logDir, `bridge-daemon-${stamp}.err.log`));
	const child = spawn(command, args, {
		cwd: opts.cwd,
		env: opts.env,
		detached: process.platform !== 'win32',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.pipe(outLog);
	child.stderr?.pipe(errLog);
	child.unref();
	return child;
}

/**
 * Spec §4.2 ensureDaemon: connect or spawn Machine-scoped Bridge host.
 * Returns socket path + auth token (from bridge.token after daemon is up).
 */
export async function ensureDaemon(deps: EnsureDaemonDeps = {}): Promise<EnsureDaemonResult> {
	const env = deps.env ?? process.env;
	const paths = bridgePaths(env);
	const startupTimeoutMs = deps.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
	const now = deps.now ?? Date.now;
	const sleep = deps.sleep ?? defaultSleep;
	const tryConnect = deps.tryConnect ?? ((p: string) => tryConnectUnix(p));
	const alive = deps.isPidAlive ?? isPidAlive;
	const readPid = deps.readPid ?? readPidFile;
	const unlink = deps.unlink ?? unlinkQuiet;
	const claim = deps.claimPidExclusive ?? claimPidExclusive;
	const spawnDaemon = deps.spawnDaemon ?? defaultSpawnDaemon;
	const readToken = deps.readToken ?? readTokenFile;
	const exists = deps.exists ?? existsSync;
	const ensureDir = deps.ensureDir ?? ((p: string) => mkdirSync(p, {recursive: true, mode: 0o700}));
	const engineLaunch = deps.engineLaunch ?? resolveDaemonLaunch;
	const lockPathOf = deps.rocksLockPath ?? rocksLockPath;
	const lockHoldersOf = deps.rocksLockHolders ?? rocksLockHolders;
	const commandLine = deps.commandLine ?? engineCommandLine;
	const roots = runtimeMarkers(env);
	const ports = slotPorts(env);
	const bridgePidsOf = deps.liveBridgePids ?? (() => liveBridgePids(env));
	const allBridgesOf = deps.allBridgePids ?? allLiveBridgePids;
	const killPid = deps.killPid ?? ((pid, signal) => process.kill(pid, signal));
	const wantEngineId = deps.wantEngineId ?? env.FAST_WANT_ENGINE_ID;
	const bundledEngine = deps.bundledEngine ?? env.FAST_BUNDLED_ENGINE;
	const lockPath = lockPathOf(env);
	const liveBridge = (pid: number) => isLiveBridgeHost(pid, {alive, commandLine, runtimeRoots: roots});
	const deadline = now() + startupTimeoutMs;

	ensureDir(paths.runDir);
	let spawned = false;
	let staleAliveSince: number | undefined;
	let startingClaimSince: number | undefined;

	while (now() < deadline) {
		if (await tryConnect(paths.socketPath)) {
			return {
				socketPath: paths.socketPath,
				token: await waitToken(paths.tokenFile, readToken, exists, sleep, now, deadline),
				spawned
			};
		}

		// Another root already bound our enroll/wss/ws — attach to its sock, do not spawn.
		for (const pid of allBridgesOf().filter(alive)) {
			const cmd = commandLine(pid);
			if (!cmd || !isBridgeEngineCommand(cmd)) continue;
			if (commandOwnsThisRuntime(cmd, roots)) continue;
			if (!commandSharesSlotPorts(cmd, ports)) continue;
			const sock = peerSocket(cmd);
			if (!sock || sock === paths.socketPath) continue;
			if (!(await tryConnect(sock))) continue;
			return {
				socketPath: sock,
				token: await waitToken(
					path.join(path.dirname(sock), 'bridge.token'),
					readToken,
					exists,
					sleep,
					now,
					deadline
				),
				spawned: false
			};
		}

		// A live Bridge on *this* runtime root owns the slot — wait for sock, never
		// spawn another (unless leftover bundled CLI). Another individual's JVM is ignored.
		const running = bridgePidsOf().filter(liveBridge);
		if (running.length > 0) {
			let reaped = false;
			for (const pid of running) {
				const cmd = commandLine(pid);
				if (
					shouldReplaceDaemon({
						wantId: wantEngineId,
						haveId: undefined,
						commandLine: cmd,
						bundledCli: bundledEngine,
						env
					})
				) {
					try {
						killPid(pid, 'SIGTERM');
					} catch {
						// already gone
					}
					reaped = true;
				}
			}
			if (reaped) {
				unlink(paths.pidFile);
				startingClaimSince = undefined;
				staleAliveSince = undefined;
				await sleep(200);
				continue;
			}
			startingClaimSince = undefined;
			staleAliveSince ??= now();
			if (now() - staleAliveSince >= startupTimeoutMs || now() >= deadline) {
				throw new Error(
					`ENGINE_BUSY: Bridge host pid(s) ${running.join(',')} alive but socket ${paths.socketPath} not accepting`
				);
			}
			await sleep(100);
			continue;
		}
		staleAliveSince = undefined;

		if (exists(paths.pidFile)) {
			const pid = readPid(paths.pidFile);
			if (pid === undefined) {
				// Non-numeric claim ("starting") with no live JVM: peer may still be
				// exec'ing. After STARTING_CLAIM_GRACE_MS with zero JVMs, the spawn died
				// (e.g. ClassNotFound) — clear claim only so we can retry.
				startingClaimSince ??= now();
				if (now() - startingClaimSince < STARTING_CLAIM_GRACE_MS && now() < deadline) {
					await sleep(100);
					continue;
				}
				unlink(paths.pidFile);
				startingClaimSince = undefined;
				// fall through to re-claim / spawn
			} else if (liveBridge(pid)) {
				startingClaimSince = undefined;
				staleAliveSince ??= now();
				if (now() - staleAliveSince >= startupTimeoutMs || now() >= deadline) {
					throw new Error(
						`ENGINE_BUSY: Bridge host pid ${pid} is alive but socket ${paths.socketPath} is not accepting connections`
					);
				}
				await sleep(100);
				continue;
			} else {
				// Dead / PID-reuse pidfile — clear claim only (never touch the socket path).
				startingClaimSince = undefined;
				unlink(paths.pidFile);
			}
		} else {
			startingClaimSince = undefined;
		}

		// Rocks held ⇒ another JVM owns the slot. Unless the holder is *our* engine
		// still booting (its cmdline is invisible to ps/pgrep, so liveBridgePids missed
		// it): then wait for its socket instead of refusing.
		const holders = aliveLockHolders(lockPath, lockHoldersOf, alive);
		if (holders.length > 0) {
			const ours = slotEnginePids(paths.runDir, readPid);
			const foreign = holders.filter(pid => !ours.includes(pid));
			if (foreign.length === 0) {
				staleAliveSince ??= now();
				if (now() - staleAliveSince >= startupTimeoutMs || now() >= deadline) {
					throw new Error(
						`ENGINE_BUSY: Bridge host pid(s) ${holders.join(',')} alive but socket ${paths.socketPath} not accepting`
					);
				}
				await sleep(100);
				continue;
			}
			throw new Error(
				`ENGINE_BUSY: Rocks LOCK held by pid(s) ${foreign.join(',')} at ${lockPath}; refuse another JVM`
			);
		}

		try {
			claim(paths.pidFile);
		} catch {
			await sleep(150);
			continue;
		}
		startingClaimSince = undefined;

		try {
			const launch = engineLaunch(paths.socketPath, env, deps.loopbackWsPort);
			spawnDaemon(launch.command, launch.args, {
				cwd: launch.cwd,
				env: {
					...env,
					FAST_DSH_PORT: env.FAST_DSH_PORT?.trim() || '3080'
				},
				logDir: paths.logDir
			});
			spawned = true;
		} catch (error) {
			unlink(paths.pidFile);
			throw error instanceof Error ? error : new Error(String(error));
		}

		// Wait for sock. If the JVM never appears (or dies), stop after grace — do not
		// burn the full STARTUP_TIMEOUT with a dead "starting" claim.
		let sawJvm = false;
		let missingJvmSince: number | undefined = now();
		while (now() < deadline) {
			await sleep(100);
			if (await tryConnect(paths.socketPath)) {
				return {
					socketPath: paths.socketPath,
					token: await waitToken(paths.tokenFile, readToken, exists, sleep, now, deadline),
					spawned
				};
			}
			const mid = bridgePidsOf().filter(liveBridge);
			if (mid.length > 0) {
				sawJvm = true;
				missingJvmSince = undefined;
				continue;
			}
			missingJvmSince ??= now();
			const grace = sawJvm ? CONNECT_TIMEOUT_MS : STARTING_CLAIM_GRACE_MS;
			if (now() - missingJvmSince >= grace) break;
		}
		const afterHolders = aliveLockHolders(lockPath, lockHoldersOf, alive);
		if (afterHolders.length > 0) {
			throw new Error(
				`ENGINE_BUSY: Rocks LOCK held by pid(s) ${afterHolders.join(',')} at ${lockPath}; refuse another JVM`
			);
		}
		const still = bridgePidsOf().filter(liveBridge);
		if (still.length > 0) {
			throw new Error(
				`ENGINE_BUSY: Bridge host pid(s) ${still.join(',')} alive but socket ${paths.socketPath} not accepting`
			);
		}
		// Spawn vanished (crash before pid write, or never exec'd) — drop claim and retry.
		unlink(paths.pidFile);
		await sleep(200);
	}

	const leftover = bridgePidsOf().filter(liveBridge);
	if (leftover.length > 0) {
		throw new Error(
			`ENGINE_BUSY: Bridge host pid(s) ${leftover.join(',')} alive but socket ${paths.socketPath} not accepting`
		);
	}
	const leftoverHolders = aliveLockHolders(lockPath, lockHoldersOf, alive);
	if (leftoverHolders.length > 0) {
		throw new Error(
			`ENGINE_BUSY: Rocks LOCK held by pid(s) ${leftoverHolders.join(',')} at ${lockPath}; refuse another JVM`
		);
	}
	throw new Error('ENGINE_START_FAILED: Bridge host did not become ready in time');
}

async function waitToken(
	tokenFile: string,
	readToken: (f: string) => string,
	exists: (p: string) => boolean,
	sleep: (ms: number) => Promise<void>,
	now: () => number,
	deadline: number
): Promise<string> {
	while (now() < deadline) {
		if (exists(tokenFile)) {
			try {
				const token = readToken(tokenFile).trim();
				if (token) return token;
			} catch {
				// retry — token file may be mid-write
			}
		}
		await sleep(50);
	}
	throw new Error(`ENGINE_START_FAILED: missing auth token at ${tokenFile}`);
}
