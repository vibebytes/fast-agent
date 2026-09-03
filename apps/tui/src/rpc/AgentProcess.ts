import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {BridgeHost, isStdioTransport, placedEngineCli, resourcesEngineCli} from '@fastllm/bridge-client';
import {bridgeEventSchema, type BridgeCommand, type BridgeEvent} from './protocol.js';
import {parseNdjsonChunk} from './parseNdjson.js';
import {utf8Stream, reportInvalidEngineLine} from '@fastllm/bridge-protocol';
import {resolveSessionArgs, type SessionLaunchConfig} from './sessionLaunch.js';
import {
	emptyUnixBootstrap,
	stepUnixBootstrap,
	type UnixBootstrap
} from './unixSessionBootstrap.js';

export type {SessionLaunchConfig} from './sessionLaunch.js';

/** Stdio e2e: exercise unix EnsureProject→Attach path against mock-engine. */
function simulateUnixSessionBoot(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.FAST_SIMULATE_UNIX_SESSION_BOOT === '1';
}

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function engineLaunch(config?: SessionLaunchConfig): Promise<{command: string; args: string[]; cwd: string}> {
	const cwd = process.env.FAST_AGENT_ROOT ?? agentRoot;
	const sessionArgs = resolveSessionArgs(config);
	const appendSessionArgs = (args: string[]) => [...args, ...sessionArgs];
	if (process.env.FAST_ENGINE_COMMAND) {
		return {
			command: process.env.FAST_ENGINE_COMMAND,
			args: appendSessionArgs(process.env.FAST_ENGINE_ARGS?.split(' ').filter(Boolean) ?? ['engine', '--mode', 'bridge', '--transport', 'stdio']),
			cwd
		};
	}

	const bundledEngine =
		process.env.FAST_BUNDLED_ENGINE?.trim() ||
		resourcesEngineCli(process.env) ||
		placedEngineCli([cwd, agentRoot]) ||
		path.join(agentRoot, 'engine', 'bin', process.platform === 'win32' ? 'fast-cli.bat' : 'fast-cli');
	if (existsSync(bundledEngine)) {
		return {
			command: bundledEngine,
			args: appendSessionArgs(['engine', '--mode', 'bridge', '--transport', 'stdio']),
			cwd
		};
	}

	const classpath = await resolveRuntimeClasspath(cwd);
	return {
		command: process.env.JAVA_COMMAND ?? 'java',
		args: appendSessionArgs([
			'--add-opens=java.base/java.nio=ALL-UNNAMED',
			'-cp',
			classpath,
			'ai.fastllm.agent.cli.CliApp',
			'engine',
			'--mode',
			'bridge',
			'--transport',
			'stdio'
		]),
		cwd
	};
}

/**
 * Resolve the Scala classpath via sbt WITHOUT blocking the event loop:
 * the old spawnSync froze the entire UI (input, spinner, redraws) for the
 * tens of seconds sbt takes on a cold start.
 */
function resolveRuntimeClasspath(cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('sbt', ['-batch', 'show cli / Runtime / fullClasspath'], {cwd});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', chunk => {
			stdout += String(chunk);
		});
		child.stderr.on('data', chunk => {
			stderr += String(chunk);
		});
		child.on('error', reject);
		child.on('close', status => {
			if (status !== 0) {
				reject(new Error(stderr || stdout || 'Failed to resolve Scala runtime classpath'));
				return;
			}
			const matches = [...stdout.matchAll(/Attributed\(([^)]+)\)/g)].map(match => match[1]).filter(Boolean);
			if (matches.length === 0) {
				reject(new Error('Failed to parse Scala runtime classpath from sbt output'));
				return;
			}
			resolve(matches.join(path.delimiter));
		});
	});
}

export type AgentProcessHandlers = {
	onEvent: (event: BridgeEvent) => void;
	onError: (message: string) => void;
	onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export class AgentProcess {
	private child?: ChildProcessWithoutNullStreams;
	private host?: BridgeHost;
	private stdoutBuffer = '';
	private handlers?: AgentProcessHandlers;
	private starting = false;
	private stopped = false;
	/** Stable for Hello / Attach / Ack / Heartbeat (shared with AppContainer). */
	readonly clientId = `fast-ink-${randomUUID()}`;
	private sessionConfig: SessionLaunchConfig = {mode: 'continue'};
	private unixBoot: UnixBootstrap = emptyUnixBootstrap();
	/** Unix path owns AttachSession; AppContainer must not Attach again. */
	get ownsAttach(): boolean {
		return !isStdioTransport(process.env) || simulateUnixSessionBoot();
	}

	start(handlers: AgentProcessHandlers, sessionConfig?: SessionLaunchConfig): void {
		if (this.child || this.host || this.starting) {
			return;
		}
		this.starting = true;
		this.stopped = false;
		this.unixBoot = emptyUnixBootstrap();
		this.sessionConfig = sessionConfig ?? {mode: 'continue'};
		void this.startAsync(handlers, sessionConfig).finally(() => {
			this.starting = false;
		});
	}

	private async startAsync(handlers: AgentProcessHandlers, sessionConfig?: SessionLaunchConfig): Promise<void> {
		this.handlers = handlers;
		if (isStdioTransport(process.env)) {
			await this.startStdio(handlers, sessionConfig);
			return;
		}
		await this.startUnix(handlers);
	}

	private async startUnix(handlers: AgentProcessHandlers): Promise<void> {
		handlers.onEvent({type: 'engine_status', stage: 'connecting_bridge', message: 'Connecting Machine-scoped Bridge host'});
		const host = new BridgeHost();
		this.host = host;
		const cwd = process.cwd();
		// agentRoot here is modules/cli; repo agent root is two levels up for bundled engine.
		const repoAgentRoot = process.env.FAST_AGENT_ROOT ?? path.resolve(agentRoot, '../..');
		try {
			await host.connect(
				{
					clientKind: 'fast-ink',
					clientId: this.clientId,
					cwd,
					clientVersion: process.env.npm_package_version,
					env: {
						...process.env,
						FAST_AGENT_ROOT: repoAgentRoot
					}
				},
				{
					onEvent: event => {
						recordBridge('event', event);
						const forwarded = this.onUnixBridgeEvent(event, cwd);
						if (forwarded) handlers.onEvent(forwarded);
					},
					onError: message => handlers.onError(message),
					onClose: () => {
						this.host = undefined;
						if (!this.stopped) {
							handlers.onExit(null, null);
						}
					}
				}
			);
		} catch (error) {
			this.host = undefined;
			handlers.onError(error instanceof Error ? error.message : String(error));
			return;
		}
		if (this.stopped) {
			host.stop();
			this.host = undefined;
		}
	}

	/** Unix (or simulated): EnsureProject + project-scoped session boot. */
	private onUnixBridgeEvent(event: BridgeEvent, cwd: string): BridgeEvent | undefined {
		if (
			event.type === 'command_result' &&
			event.name === 'EnsureProject' &&
			event.status === 'error'
		) {
			this.handlers?.onError(event.message || 'EnsureProject failed');
		}
		const step = stepUnixBootstrap(this.unixBoot, event, {
			cwd,
			clientId: this.clientId,
			sessionConfig: this.sessionConfig,
			displayName: path.basename(cwd),
			stopped: this.stopped
		});
		this.unixBoot = step.bootstrap;
		for (const cmd of step.sends) {
			this.send(cmd);
		}
		return step.forward;
	}

	private async startStdio(handlers: AgentProcessHandlers, sessionConfig?: SessionLaunchConfig): Promise<void> {
		handlers.onEvent({type: 'engine_status', stage: 'resolving_classpath', message: 'Resolving Scala runtime classpath'});
		let launch: {command: string; args: string[]; cwd: string};
		try {
			launch = await engineLaunch(sessionConfig);
		} catch (error) {
			handlers.onError(error instanceof Error ? error.message : String(error));
			return;
		}
		if (this.stopped) {
			return;
		}
		const {command, args, cwd} = launch;
		handlers.onEvent({type: 'engine_status', stage: 'starting_jvm', message: `${command} ${args.slice(0, 3).join(' ')}`});
		const child = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd,
			env: process.env,
			detached: process.platform !== 'win32'
		});

		this.child = child;
		const projectCwd = process.cwd();
		const decodeUtf8 = utf8Stream();
		const decodeStderr = utf8Stream();

		child.stdout.on('data', chunk => {
			this.stdoutBuffer = parseNdjsonChunk(this.stdoutBuffer, decodeUtf8(chunk), line => {
				if (!line.startsWith('{')) {
					return;
				}
				try {
					const parsed = bridgeEventSchema.parse(JSON.parse(line));
					recordBridge('event', parsed);
					if (simulateUnixSessionBoot()) {
						const forwarded = this.onUnixBridgeEvent(parsed, projectCwd);
						if (forwarded) handlers.onEvent(forwarded);
					} else {
						handlers.onEvent(parsed);
					}
				} catch {
					reportInvalidEngineLine(line, {
						onTerminal: message => handlers.onError(message),
						onLog: message => handlers.onError(message)
					});
				}
			});
		});

		child.stderr.on('data', chunk => {
			const message = decodeStderr(chunk).trim();
			if (message.length > 0 && !isBuildNoise(message)) {
				handlers.onError(message);
			}
		});

		child.on('exit', (code, signal) => {
			this.child = undefined;
			handlers.onExit(code, signal);
		});

		child.on('error', error => {
			handlers.onError(error.message);
		});

		child.stdin.on('error', error => {
			handlers.onError(`Engine input is closed: ${error.message}`);
		});
	}

	send(command: BridgeCommand): boolean {
		if (this.host) {
			recordBridge('command', command);
			return this.host.send(command);
		}
		if (!this.child || this.child.killed || this.child.stdin.destroyed || !this.child.stdin.writable) {
			this.handlers?.onError('Engine is not ready for input yet.');
			return false;
		}

		try {
			recordBridge('command', command);
			return this.child.stdin.write(`${JSON.stringify(command)}\n`);
		} catch (error) {
			this.handlers?.onError(`Engine input failed: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	}

	stop(detachCommand?: BridgeCommand): void {
		this.stopped = true;
		if (this.host) {
			if (detachCommand) {
				this.send(detachCommand);
			}
			this.host.stop();
			this.host = undefined;
			return;
		}
		const child = this.child;
		if (!child) {
			return;
		}

		if (detachCommand) {
			this.send(detachCommand);
		}
		child.stdin.end();
		child.stdout.destroy();
		child.stderr.destroy();
		killProcessTree(child, 'SIGTERM');
		setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				killProcessTree(child, 'SIGKILL');
			}
		}, 1500);
		this.child = undefined;
	}
}

function recordBridge(direction: 'event' | 'command', payload: BridgeEvent | BridgeCommand): void {
	const target = process.env.FAST_E2E_RECORD_EVENTS;
	if (!target) return;
	try {
		mkdirSync(path.dirname(target), {recursive: true});
		appendFileSync(target, `${JSON.stringify({direction, payload})}\n`);
	} catch {
		// Recording must never affect the CLI under test.
	}
}

function killProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
	try {
		if (process.platform !== 'win32' && child.pid !== undefined) {
			process.kill(-child.pid, signal);
		} else {
			child.kill(signal);
		}
	} catch {
		try {
			child.kill(signal);
		} catch {
			// best effort
		}
	}
}

function isBuildNoise(message: string): boolean {
	return message
		.split(/\r?\n/)
		.every(line => {
			const trimmed = line.trim();
			return trimmed.length === 0 ||
				trimmed.startsWith('[info]') ||
				trimmed.startsWith('[warn]') ||
				trimmed.startsWith('SLF4J(');
		});
}
