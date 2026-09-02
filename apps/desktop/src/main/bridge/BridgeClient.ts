import {spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {BridgeHost, isStdioTransport, type RemoteBridgeConnectionOptions} from '@fastllm/bridge-client';
import {bridgeEventSchema, parseNdjsonChunk, utf8Stream, type BridgeCommand, type BridgeEvent} from '@fastllm/bridge-protocol';
import {resolveEngineLaunch, type ResolveEngineLaunchOptions} from './engineLaunch.js';

export type BridgeClientHandlers = {
	onEvent: (event: BridgeEvent) => void;
	/** Fatal / actionable failures (spawn, invalid NDJSON, stdin closed). */
	onError: (message: string) => void;
	/** Non-fatal Engine stderr / log lines. */
	onLog?: (message: string) => void;
	onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
};

type SpawnFn = (
	command: string,
	args: string[],
	options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type BridgeClientOptions = {
	spawnImpl?: SpawnFn;
	/** Force transport; default from env / spawnImpl presence. */
	transport?: 'unix' | 'stdio';
};

export type BridgeStartOptions = Pick<
	ResolveEngineLaunchOptions,
	'env' | 'bundledEnginePath' | 'existsSync' | 'sessionMode' | 'resumeSessionId'
> & {
	remote?: RemoteBridgeConnectionOptions;
	clientId?: string;
	wantEngineId?: string;
};

const defaultSpawn: SpawnFn = (command, args, spawnOptions) =>
	spawn(command, args, {...spawnOptions, stdio: ['pipe', 'pipe', 'pipe']}) as ChildProcessWithoutNullStreams;

function useStdio(options: BridgeClientOptions, env: NodeJS.ProcessEnv): boolean {
	if (options.transport === 'stdio') return true;
	if (options.transport === 'unix') return false;
	if (options.spawnImpl) return true;
	return isStdioTransport(env);
}

export class BridgeClient {
	private child?: ChildProcessWithoutNullStreams;
	private host?: BridgeHost;
	private stdoutBuffer = '';
	private handlers?: BridgeClientHandlers;
	private readonly spawnImpl: SpawnFn;
	private readonly options: BridgeClientOptions;
	private generation = 0;
	private clientId = '';

	constructor(options: BridgeClientOptions = {}) {
		this.options = options;
		this.spawnImpl = options.spawnImpl ?? defaultSpawn;
	}

	start(
		workspaceRoot: string,
		handlers: BridgeClientHandlers,
		launchOptions: BridgeStartOptions = {}
	): Promise<void> {
		if (this.child || this.host) {
			const err = new Error('Already connected for this client.');
			handlers.onError(err.message);
			return Promise.reject(err);
		}

		const generation = ++this.generation;
		this.handlers = handlers;
		const env = launchOptions.env
			? {...process.env, ...launchOptions.env}
			: process.env;

		if (useStdio(this.options, env)) {
			this.startStdio(workspaceRoot, handlers, launchOptions, generation, env);
			return Promise.resolve();
		}

		return this.startConnection(workspaceRoot, handlers, generation, env, launchOptions);
	}

	private async startConnection(
		workspaceRoot: string,
		handlers: BridgeClientHandlers,
		generation: number,
		env: NodeJS.ProcessEnv,
		launchOptions: BridgeStartOptions = {}
	): Promise<void> {
		const isCurrent = () => generation === this.generation && this.handlers === handlers;
		handlers.onEvent({
			type: 'engine_status',
			stage: 'connecting',
			message: launchOptions.remote
				? 'Connecting remote Bridge host'
				: 'Connecting Machine-scoped Bridge host'
		});
		const host = new BridgeHost();
		this.host = host;
		this.clientId = launchOptions.clientId ?? `fast-ide-${randomUUID()}`;
		try {
			await host.connect(
				{
					clientKind: 'fast-ide',
					clientId: this.clientId,
					cwd: launchOptions.remote ? undefined : workspaceRoot,
					env,
					remote: launchOptions.remote,
					wantEngineId: launchOptions.wantEngineId ?? env.FAST_WANT_ENGINE_ID
				},
				{
					onEvent: event => {
						if (!isCurrent()) return;
						handlers.onEvent(event);
					},
					onError: message => {
						if (!isCurrent()) return;
						handlers.onError(message);
					},
					onLog: message => {
						if (!isCurrent()) return;
						handlers.onLog?.(message);
					},
					onClose: () => {
						if (this.host === host) {
							this.host = undefined;
						}
						if (!isCurrent()) return;
						handlers.onExit(null, null);
					}
				}
			);
		} catch (error) {
			if (this.host === host) {
				host.stop();
				this.host = undefined;
			}
			if (!isCurrent()) {
				if (error instanceof Error && error.name === 'AbortError') throw error;
				return;
			}
			const aborted = error instanceof Error && error.name === 'AbortError';
			if (!aborted) {
				handlers.onError(error instanceof Error ? error.message : String(error));
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
		if (!isCurrent() && this.host === host) {
			host.stop();
			this.host = undefined;
		}
	}

	private startStdio(
		workspaceRoot: string,
		handlers: BridgeClientHandlers,
		launchOptions: BridgeStartOptions,
		generation: number,
		childEnv: NodeJS.ProcessEnv
	): void {
		let launch;
		try {
			launch = resolveEngineLaunch({
				workspaceRoot,
				env: launchOptions.env ?? process.env,
				bundledEnginePath: launchOptions.bundledEnginePath,
				existsSync: launchOptions.existsSync,
				sessionMode: launchOptions.sessionMode,
				resumeSessionId: launchOptions.resumeSessionId,
				transport: 'stdio'
			});
		} catch (error) {
			handlers.onError(error instanceof Error ? error.message : String(error));
			return;
		}

		handlers.onEvent({
			type: 'engine_status',
			stage: 'starting',
			message: `${launch.command} ${launch.args.join(' ')}`
		});

		const child = this.spawnImpl(launch.command, launch.args, {
			cwd: launch.cwd,
			env: childEnv
		});
		this.child = child;
		this.stdoutBuffer = '';
		const decodeUtf8 = utf8Stream();
		const decodeStderr = utf8Stream();

		const isCurrent = () => generation === this.generation && this.handlers === handlers;

		child.stdout.on('data', chunk => {
			if (!isCurrent()) return;
			this.stdoutBuffer = parseNdjsonChunk(this.stdoutBuffer, decodeUtf8(chunk), line => {
				if (!line.startsWith('{')) {
					return;
				}
				try {
					const parsed = bridgeEventSchema.parse(JSON.parse(line));
					handlers.onEvent(parsed);
				} catch {
					// One bad NDJSON line must not mark the whole engine dead (Attach hydrate, etc.).
					handlers.onLog?.(`Invalid engine event: ${line}`);
				}
			});
		});

		child.stderr.on('data', chunk => {
			if (!isCurrent()) return;
			const message = decodeStderr(chunk).trim();
			if (message.length > 0) {
				handlers.onLog?.(message);
			}
		});

		child.on('exit', (code, signal) => {
			if (this.child === child) {
				this.child = undefined;
			}
			if (!isCurrent()) return;
			handlers.onExit(code, signal);
		});

		child.on('error', error => {
			if (!isCurrent()) return;
			handlers.onError(error.message);
		});
	}

	send(command: BridgeCommand): boolean {
		if (this.host) {
			return this.host.send(command);
		}
		if (!this.child?.stdin?.writable) {
			this.handlers?.onError('Not ready for input yet.');
			return false;
		}
		try {
			return this.child.stdin.write(`${JSON.stringify(command)}\n`);
		} catch (error) {
			this.handlers?.onError(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	async stopLocal(): Promise<void> {
		this.generation += 1;
		this.handlers = undefined;
		if (this.host) {
			await this.host.stopLocal();
			this.host = undefined;
			return;
		}
		this.stop();
	}

	stop(): void {
		this.generation += 1;
		this.handlers = undefined;
		if (this.host) {
			this.host.stop();
			this.host = undefined;
			return;
		}
		const child = this.child;
		if (!child) {
			return;
		}
		try {
			child.stdin.end();
		} catch {
			// best effort
		}
		try {
			child.kill('SIGTERM');
		} catch {
			// best effort
		}
		this.child = undefined;
	}
}
