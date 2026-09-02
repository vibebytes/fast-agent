import {randomUUID} from 'node:crypto';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	engineCommandLine,
	ensureDaemon,
	isPidAlive,
	type EnsureDaemonDeps,
	type EnsureDaemonResult
} from './ensureDaemon.js';
import {
	shouldReplaceDaemon,
	shouldStopDaemonOnQuit,
	waitWhile
} from './engineIdentity.js';
import {isStdioTransport} from './paths.js';
import {connectUnix, type UnixConnection} from './unixConnection.js';
import {connectWs, type RemoteBridgeConnectionOptions, type WsConnection} from './wsConnection.js';

type HelloOk = Extract<BridgeEvent, {type: 'HelloOk'}>;

export type BridgeHostHandlers = {
	onEvent: (event: BridgeEvent) => void;
	onError: (message: string) => void;
	onLog?: (message: string) => void;
	onClose?: () => void;
};

export type BridgeHostConnectOptions = {
	clientKind: 'fast-ide' | 'fast-ink' | string;
	clientId?: string;
	cwd?: string;
	clientVersion?: string;
	protocolVersion?: number;
	/** Heartbeat interval; default 15s. Set 0 to disable. */
	heartbeatMs?: number;
	env?: NodeJS.ProcessEnv;
	ensureDeps?: EnsureDaemonDeps;
	remote?: Omit<RemoteBridgeConnectionOptions, 'url'> & {url: string};
	/** Packed `.fast-engine-id`; default `$FAST_WANT_ENGINE_ID`. */
	wantEngineId?: string;
	commandLine?: (pid: number) => string | undefined;
	isPidAlive?: (pid: number) => boolean;
	killPid?: (pid: number, signal: NodeJS.Signals) => void;
};

const LOCAL_HELLO_TIMEOUT_MS = 10_000;

type HostConn = Pick<UnixConnection, 'send' | 'close'> | Pick<WsConnection, 'send' | 'close'>;

/**
 * High-level Bridge client: unix ensureDaemon or remote connectWs → Hello → ClientHeartbeat.
 * For stdio escape hatch (`FAST_BRIDGE_TRANSPORT=stdio`), callers should keep
 * their existing child-process path — this class is unix/ws only.
 */
export type BridgeHostDeps = {
	connectWs?: typeof connectWs;
	ensureDaemon?: typeof ensureDaemon;
	connectUnix?: typeof connectUnix;
};

export class BridgeHost {
	private conn?: HostConn;
	private unix?: UnixConnection;
	private handlers?: BridgeHostHandlers;
	private clientId = '';
	private heartbeatTimer?: ReturnType<typeof setInterval>;
	private ensureResult?: EnsureDaemonResult;
	private lastHello?: HelloOk;
	private lastCmd?: string;
	private wantId?: string;
	private remote = false;
	private replaced = false;
	private swapping = false;
	private closed = false;
	private connecting = false;
	private pidAlive: (pid: number) => boolean = isPidAlive;
	private readonly connectWsImpl: typeof connectWs;
	private readonly ensureDaemonImpl: typeof ensureDaemon;
	private readonly connectUnixImpl: typeof connectUnix;

	constructor(deps: BridgeHostDeps = {}) {
		this.connectWsImpl = deps.connectWs ?? connectWs;
		this.ensureDaemonImpl = deps.ensureDaemon ?? ensureDaemon;
		this.connectUnixImpl = deps.connectUnix ?? connectUnix;
	}

	get socketPath(): string | undefined {
		return this.ensureResult?.socketPath ?? this.unix?.socketPath;
	}

	get spawned(): boolean {
		return this.ensureResult?.spawned ?? false;
	}

	get daemonPid(): number | undefined {
		return this.lastHello?.daemonPid;
	}

	get engineId(): string | undefined {
		return this.lastHello?.engineId;
	}

	get id(): string {
		return this.clientId;
	}

	async connect(options: BridgeHostConnectOptions, handlers: BridgeHostHandlers): Promise<void> {
		const env = options.env ?? process.env;
		if (isStdioTransport(env)) {
			throw new Error('BridgeHost is unix-only; use stdio spawn path when FAST_BRIDGE_TRANSPORT=stdio');
		}
		if (this.conn || this.connecting) {
			throw new Error('Already connected');
		}
		this.closed = false;
		this.connecting = true;
		this.replaced = false;
		this.pidAlive = options.isPidAlive ?? isPidAlive;
		this.wantId = options.wantEngineId ?? env.FAST_WANT_ENGINE_ID;
		this.handlers = handlers;
		this.clientId = options.clientId ?? `${options.clientKind}-${randomUUID()}`;
		const remote = options.remote;
		this.remote = Boolean(remote);
		const started = Date.now();
		const remoteBudget = remote?.timeoutMs ?? 8_000;

		const helloWaiters: Array<(event: BridgeEvent) => void> = [];
		const wire = {
			onEvent: (event: BridgeEvent) => {
				for (const w of helloWaiters) w(event);
				handlers.onEvent(event);
			},
			onError: (message: string) => handlers.onError(message),
			onLog: (message: string) => handlers.onLog?.(message),
			onClose: () => {
				if (this.swapping) return;
				this.clearHeartbeat();
				this.conn = undefined;
				this.unix = undefined;
				handlers.onClose?.();
			}
		};

		try {
			if (remote) {
				this.conn = await this.connectWsImpl(remote.url, wire, {
					caPem: remote.caPem,
					fingerprint: remote.fingerprint,
					insecureSkipVerify: remote.insecureSkipVerify,
					signal: remote.signal,
					timeoutMs: Math.max(1, remoteBudget - (Date.now() - started))
				});
			} else {
				const ensured = await this.ensureDaemonImpl({
					...options.ensureDeps,
					env,
					wantEngineId: options.wantEngineId ?? env.FAST_WANT_ENGINE_ID
				});
				this.ensureResult = ensured;
				const unix = await this.connectUnixImpl(ensured.socketPath, wire, {timeoutMs: 8_000});
				this.unix = unix;
				this.conn = unix;
			}

			if (this.closed) {
				this.conn.close();
				this.conn = undefined;
				this.unix = undefined;
				throw Object.assign(new Error('aborted'), {name: 'AbortError'});
			}

			const helloMs = remote
				? Math.max(1, remoteBudget - (Date.now() - started))
				: LOCAL_HELLO_TIMEOUT_MS;
			const helloOk = await new Promise<BridgeEvent>((resolve, reject) => {
				const timer = setTimeout(() => {
					cleanup();
					reject(new Error('Hello timed out waiting for HelloOk'));
				}, helloMs);
				const onAbort = () => {
					cleanup();
					reject(Object.assign(new Error('aborted'), {name: 'AbortError'}));
				};
				if (remote?.signal) {
					if (remote.signal.aborted) {
						onAbort();
						return;
					}
					remote.signal.addEventListener('abort', onAbort, {once: true});
				}
				const onEvent = (event: BridgeEvent) => {
					if (event.type === 'HelloOk') {
						cleanup();
						resolve(event);
					} else if (event.type === 'HelloReject') {
						cleanup();
						reject(
							new Error(`HelloReject: ${event.code}${event.message ? ` — ${event.message}` : ''}`)
						);
					}
				};
				const cleanup = () => {
					clearTimeout(timer);
					remote?.signal?.removeEventListener('abort', onAbort);
					const idx = helloWaiters.indexOf(onEvent);
					if (idx >= 0) helloWaiters.splice(idx, 1);
				};
				helloWaiters.push(onEvent);
				const hello: BridgeCommand = {
					type: 'Hello',
					protocolVersion: options.protocolVersion ?? 1,
					clientId: this.clientId,
					clientKind: options.clientKind,
					clientVersion: options.clientVersion,
					pid: process.pid,
					authToken: remote?.authToken?.trim() ?? this.ensureResult?.token
				};
				if (!remote && options.cwd) hello.cwd = options.cwd;
				const sent = this.send(hello);
				if (!sent) {
					cleanup();
					reject(new Error('Failed to send Hello'));
				}
			});
			this.rememberHello(helloOk, options);
			if (!remote) {
				await this.replaceIfMismatch(options, env, handlers, wire, helloWaiters);
			}
		} catch (e) {
			this.dropConn();
			throw e;
		} finally {
			this.connecting = false;
		}

		if (this.closed) {
			this.stop();
			return;
		}

		const heartbeatMs = options.heartbeatMs ?? 15_000;
		if (heartbeatMs > 0) {
			this.heartbeatTimer = setInterval(() => {
				this.send({
					type: 'ClientHeartbeat',
					clientId: this.clientId,
					atMillis: Date.now()
				});
			}, heartbeatMs);
			this.heartbeatTimer.unref?.();
		}
	}

	send(command: BridgeCommand): boolean {
		if (!this.conn) {
			this.handlers?.onError('Not connected.');
			return false;
		}
		return this.conn.send(command);
	}

	stop(reason = 'client_exit'): void {
		this.closed = true;
		this.clearHeartbeat();
		const conn = this.conn;
		if (!conn) return;
		try {
			if (this.clientId) {
				conn.send({type: 'Goodbye', clientId: this.clientId, reason});
			}
		} catch {
			// best effort
		}
		conn.close();
		this.conn = undefined;
		this.unix = undefined;
		this.handlers = undefined;
	}

	async stopLocal(opts: {env?: NodeJS.ProcessEnv} = {}): Promise<void> {
		const env = opts.env ?? process.env;
		if (
			!shouldStopDaemonOnQuit({
				remote: this.remote,
				spawned: this.spawned,
				commandLine: this.lastCmd,
				bundledCli: env.FAST_BUNDLED_ENGINE,
				wantId: this.wantId ?? env.FAST_WANT_ENGINE_ID,
				haveId: this.lastHello?.engineId,
				env
			})
		) {
			this.stop('client_exit');
			return;
		}
		const pid = this.lastHello?.daemonPid;
		this.send({type: 'Shutdown', force: false});
		if (pid != null) {
			await waitWhile(() => this.pidAlive(pid), {timeoutMs: 10_000});
		}
		this.stop('client_exit');
	}

	private rememberHello(event: BridgeEvent, options: BridgeHostConnectOptions): void {
		if (event.type !== 'HelloOk') return;
		this.lastHello = event;
		const lineOf = options.commandLine ?? engineCommandLine;
		this.lastCmd = event.daemonPid != null ? lineOf(event.daemonPid) : undefined;
	}

	private async replaceIfMismatch(
		options: BridgeHostConnectOptions,
		env: NodeJS.ProcessEnv,
		handlers: BridgeHostHandlers,
		wire: {
			onEvent: (event: BridgeEvent) => void;
			onError: (message: string) => void;
			onLog?: (message: string) => void;
			onClose: () => void;
		},
		helloWaiters: Array<(event: BridgeEvent) => void>
	): Promise<void> {
		if (this.replaced || this.closed) return;
		const want = options.wantEngineId ?? env.FAST_WANT_ENGINE_ID;
		if (
			!shouldReplaceDaemon({
				wantId: want,
				haveId: this.lastHello?.engineId,
				commandLine: this.lastCmd,
				bundledCli: env.FAST_BUNDLED_ENGINE,
				env
			})
		) {
			return;
		}
		this.replaced = true;
		handlers.onLog?.('engine id mismatch; replacing Bridge host');
		const pid = this.lastHello?.daemonPid;
		const alive = options.isPidAlive ?? isPidAlive;
		const kill = options.killPid ?? ((p, s) => process.kill(p, s));
		this.send({type: 'Shutdown', force: true});
		if (pid != null) {
			await waitWhile(() => alive(pid), {timeoutMs: 10_000});
			if (alive(pid)) {
				try {
					kill(pid, 'SIGTERM');
				} catch {
					// gone
				}
				await waitWhile(() => alive(pid), {timeoutMs: 2_000});
			}
		}
		this.swapping = true;
		try {
			this.conn?.close();
			this.conn = undefined;
			this.unix = undefined;
			const ensured = await this.ensureDaemonImpl({
				...options.ensureDeps,
				env,
				wantEngineId: want
			});
			this.ensureResult = ensured;
			const unix = await this.connectUnixImpl(ensured.socketPath, wire, {timeoutMs: 8_000});
			this.unix = unix;
			this.conn = unix;
			const helloOk = await new Promise<BridgeEvent>((resolve, reject) => {
				const timer = setTimeout(() => {
					cleanup();
					reject(new Error('Hello timed out waiting for HelloOk'));
				}, LOCAL_HELLO_TIMEOUT_MS);
				const onEvent = (event: BridgeEvent) => {
					if (event.type === 'HelloOk') {
						cleanup();
						resolve(event);
					} else if (event.type === 'HelloReject') {
						cleanup();
						reject(
							new Error(`HelloReject: ${event.code}${event.message ? ` — ${event.message}` : ''}`)
						);
					}
				};
				const cleanup = () => {
					clearTimeout(timer);
					const idx = helloWaiters.indexOf(onEvent);
					if (idx >= 0) helloWaiters.splice(idx, 1);
				};
				helloWaiters.push(onEvent);
				const hello: BridgeCommand = {
					type: 'Hello',
					protocolVersion: options.protocolVersion ?? 1,
					clientId: this.clientId,
					clientKind: options.clientKind,
					clientVersion: options.clientVersion,
					pid: process.pid,
					authToken: this.ensureResult?.token
				};
				if (options.cwd) hello.cwd = options.cwd;
				if (!this.send(hello)) {
					cleanup();
					reject(new Error('Failed to send Hello'));
				}
			});
			this.rememberHello(helloOk, options);
		} finally {
			this.swapping = false;
		}
	}

	private dropConn(): void {
		try {
			this.conn?.close();
		} catch {
			// already gone
		}
		this.conn = undefined;
		this.unix = undefined;
	}

	private clearHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}
}
