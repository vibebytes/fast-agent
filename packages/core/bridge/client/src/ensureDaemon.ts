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
import {createWriteStream} from 'node:fs';
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
	engineLaunch?: (socketPath: string, env: NodeJS.ProcessEnv) => {command: string; args: string[]; cwd?: string};
	/** PIDs holding `~/.fast/server/rocks/LOCK` (spec §4.2 ENGINE_BUSY). */
	rocksLockHolders?: (lockPath: string) => number[];
	rocksLockPath?: (env: NodeJS.ProcessEnv) => string;
	/** `ps` command line for a pid; used to reject PID-reuse false owners. */
	commandLine?: (pid: number) => string | undefined;
	/** All live Bridge engine PIDs on this machine (process scan). */
	liveBridgePids?: () => number[];
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

/**
 * Live pid owns the slot only if it is a Bridge engine.
 * Alive + non-bridge ⇒ PID reuse / stale pidfile (safe to clear).
 * Alive + unknown cmdline (`ps` failed) ⇒ treat as owner (do not steal).
 */
export function isLiveBridgeHost(
	pid: number,
	deps: {
		alive?: (pid: number) => boolean;
		commandLine?: (pid: number) => string | undefined;
	} = {}
): boolean {
	const alive = deps.alive ?? isPidAlive;
	const commandLine = deps.commandLine ?? engineCommandLine;
	if (!alive(pid)) return false;
	const cmd = commandLine(pid);
	if (cmd === undefined) return true;
	return isBridgeEngineCommand(cmd);
}

/** Best-effort: every live Bridge host JVM/cli on this machine. */
function liveBridgePidsWindows(): number[] {
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
			const m = block.match(/ProcessId=(\d+)/i);
			const n = Number(m?.[1]);
			if (Number.isFinite(n) && n > 0 && n !== process.pid) found.add(n);
		}
		return [...found];
	} catch {
		return [];
	}
}

export function liveBridgePids(): number[] {
	if (process.platform === 'win32') return liveBridgePidsWindows();
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
	env: NodeJS.ProcessEnv = process.env
): {command: string; args: string[]; cwd?: string} {
	const socketArgs = ['--transport', 'unix', '--socket', socketPath];
	const withSession = (args: string[]) =>
		hasSessionFlag(args) ? args : [...args, '--continue'];
	const agentRoot = env.FAST_AGENT_ROOT?.trim();
	if (env.FAST_ENGINE_COMMAND?.trim()) {
		const base = env.FAST_ENGINE_ARGS?.split(/\s+/).filter(Boolean) ?? [
			'engine',
			'--mode',
			'bridge'
		];
		const withoutTransport = stripTransportArgs(base);
		return {
			command: env.FAST_ENGINE_COMMAND,
			args: withSession([...withoutTransport, ...socketArgs]),
			cwd: agentRoot
		};
	}
	const bundled =
		env.FAST_BUNDLED_ENGINE?.trim() ||
		(agentRoot ? existingEngineCli(path.join(agentRoot, 'engine', 'bin')) : undefined);
	if (bundled && existsSync(bundled)) {
		return {
			command: bundled,
			args: withSession(['engine', '--mode', 'bridge', ...socketArgs]),
			cwd: agentRoot
		};
	}
	const fromResources = resourcesEngineCli(env);
	if (fromResources) {
		return {
			command: fromResources,
			args: withSession(['engine', '--mode', 'bridge', ...socketArgs]),
			cwd: agentRoot
		};
	}
	const placed = placedEngineCli([agentRoot], env);
	if (placed) {
		return {
			command: placed,
			args: withSession(['engine', '--mode', 'bridge', ...socketArgs]),
			cwd: path.dirname(path.dirname(placed))
		};
	}
	// Dev fallback: java -cp $FAST_ENGINE_CLASSPATH (parity with ink stdio classpath path).
	const classpath = env.FAST_ENGINE_CLASSPATH?.trim();
	if (classpath) {
		return {
			command: env.JAVA_COMMAND?.trim() || 'java',
			args: withSession([
				'--add-opens=java.base/java.nio=ALL-UNNAMED',
				'-cp',
				classpath,
				'ai.fastllm.agent.cli.CliApp',
				'engine',
				'--mode',
				'bridge',
				...socketArgs
			]),
			cwd: agentRoot
		};
	}
	return {
		command: engineBinName(),
		args: withSession(['engine', '--mode', 'bridge', ...socketArgs]),
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
	const outLog = createWriteStream(path.join(opts.logDir, `bridge-daemon-${stamp}.out.log`), {flags: 'a'});
	const errLog = createWriteStream(path.join(opts.logDir, `bridge-daemon-${stamp}.err.log`), {flags: 'a'});
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
	const bridgePidsOf = deps.liveBridgePids ?? liveBridgePids;
	const killPid = deps.killPid ?? ((pid, signal) => process.kill(pid, signal));
	const wantEngineId = deps.wantEngineId ?? env.FAST_WANT_ENGINE_ID;
	const bundledEngine = deps.bundledEngine ?? env.FAST_BUNDLED_ENGINE;
	const lockPath = lockPathOf(env);
	const liveBridge = (pid: number) => isLiveBridgeHost(pid, {alive, commandLine});

	ensureDir(paths.runDir);

	const deadline = now() + startupTimeoutMs;
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

		// Any live Bridge JVM owns the machine slot — wait for sock, never spawn another
		// unless it is our leftover bundled CLI (identity replace; never a public --ws host).
		const running = bridgePidsOf().filter(alive);
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

		// Rocks held ⇒ another JVM owns the slot.
		const holders = aliveLockHolders(lockPath, lockHoldersOf, alive);
		if (holders.length > 0) {
			throw new Error(
				`ENGINE_BUSY: Rocks LOCK held by pid(s) ${holders.join(',')} at ${lockPath}; refuse another JVM`
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
			const launch = engineLaunch(paths.socketPath, env);
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
			const mid = bridgePidsOf().filter(alive);
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
		const still = bridgePidsOf().filter(alive);
		if (still.length > 0) {
			throw new Error(
				`ENGINE_BUSY: Bridge host pid(s) ${still.join(',')} alive but socket ${paths.socketPath} not accepting`
			);
		}
		// Spawn vanished (crash before pid write, or never exec'd) — drop claim and retry.
		unlink(paths.pidFile);
		await sleep(200);
	}

	const leftover = bridgePidsOf().filter(alive);
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
