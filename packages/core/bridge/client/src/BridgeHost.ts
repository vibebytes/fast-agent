import {randomUUID} from 'node:crypto';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {ensureDaemon, type EnsureDaemonDeps, type EnsureDaemonResult} from './ensureDaemon.js';
import {isStdioTransport} from './paths.js';
import {connectUnix, type UnixConnection} from './unixConnection.js';
import {connectWs, type RemoteBridgeConnectionOptions, type WsConnection} from './wsConnection.js';

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
};

export class BridgeHost {
	private conn?: HostConn;
	private unix?: UnixConnection;
	private handlers?: BridgeHostHandlers;
	private clientId = '';
	private heartbeatTimer?: ReturnType<typeof setInterval>;
	private ensureResult?: EnsureDaemonResult;
	private closed = false;
	private connecting = false;
	private readonly connectWsImpl: typeof connectWs;
	private readonly ensureDaemonImpl: typeof ensureDaemon;

	constructor(deps: BridgeHostDeps = {}) {
		this.connectWsImpl = deps.connectWs ?? connectWs;
		this.ensureDaemonImpl = deps.ensureDaemon ?? ensureDaemon;
	}

	get socketPath(): string | undefined {
		return this.ensureResult?.socketPath ?? this.unix?.socketPath;
	}

	get spawned(): boolean {
		return this.ensureResult?.spawned ?? false;
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
		this.handlers = handlers;
		this.clientId = options.clientId ?? `${options.clientKind}-${randomUUID()}`;
		const remote = options.remote;
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
				const ensured = await this.ensureDaemonImpl({...options.ensureDeps, env});
				this.ensureResult = ensured;
				const unix = await connectUnix(ensured.socketPath, wire);
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
			await new Promise<BridgeEvent>((resolve, reject) => {
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

	private clearHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}
}
