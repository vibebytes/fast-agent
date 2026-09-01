import {X509Certificate} from 'node:crypto';
import type {PeerCertificate} from 'node:tls';
import {WebSocket} from 'ws';
import {bridgeEventSchema, type BridgeCommand, type BridgeEvent} from '@fastllm/bridge-protocol';
import {fingerprintOf, normalizeFingerprint} from './tlsPin.js';
import type {UnixConnectionHandlers} from './unixConnection.js';

export type WsConnectionHandlers = UnixConnectionHandlers;

export type RemoteBridgeTls = {
	caPem?: string;
	fingerprint?: string;
	insecureSkipVerify?: boolean;
};

export type RemoteBridgeConnectionOptions = {
	url: string;
	authToken?: string;
	caPem?: string;
	fingerprint?: string;
	insecureSkipVerify?: boolean;
	signal?: AbortSignal;
	timeoutMs?: number;
};

export type ConnectWsOptions = RemoteBridgeTls & {
	signal?: AbortSignal;
	timeoutMs?: number;
};

export type WsConnection = {
	url: string;
	send: (command: BridgeCommand) => boolean;
	close: () => void;
};

export type WsSocketLike = {
	readyState: number;
	send: (data: string) => void;
	close: () => void;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type WsFactory = (url: string, opts: Record<string, unknown>) => WsSocketLike;

const OPEN = 1;

export function tlsClientOptions(opts?: RemoteBridgeTls): {
	rejectUnauthorized: boolean;
	ca?: Buffer;
	checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
} {
	const pin = opts?.fingerprint?.trim();
	if (pin) {
		let expected: string;
		try {
			expected = normalizeFingerprint(pin);
		} catch {
			return {
				rejectUnauthorized: false,
				checkServerIdentity: () => new Error('Invalid certificate fingerprint')
			};
		}
		return {
			rejectUnauthorized: false,
			checkServerIdentity: (_host, peer) => {
				if (!peer.raw) return new Error('Missing peer certificate');
				if (fingerprintOf(peer.raw) !== expected) {
					return new Error('Certificate fingerprint does not match');
				}
				return undefined;
			}
		};
	}
	const pem = opts?.caPem?.trim();
	if (pem) {
		// A pasted server cert is usually a self-signed leaf, not a CA. OpenSSL
		// still emits DEPTH_ZERO_SELF_SIGNED_CERT when rejectUnauthorized is true.
		return {
			rejectUnauthorized: false,
			ca: Buffer.from(pem),
			checkServerIdentity: (_host, peer) => {
				let pinned: X509Certificate;
				try {
					pinned = new X509Certificate(pem);
				} catch {
					return new Error('Invalid CA PEM');
				}
				if (!peer.raw) return new Error('Missing peer certificate');
				if (new X509Certificate(peer.raw).fingerprint256 === pinned.fingerprint256) {
					return undefined;
				}
				return new Error('Certificate does not match the saved CA');
			}
		};
	}
	if (opts?.insecureSkipVerify) {
		return {
			rejectUnauthorized: false,
			checkServerIdentity: () => undefined
		};
	}
	return {rejectUnauthorized: true};
}

function defaultFactory(url: string, opts: Record<string, unknown>): WsSocketLike {
	return new WebSocket(url, [], opts) as unknown as WsSocketLike;
}

/** Connect to `ws://` / `wss://…/bridge` and frame bidirectional NDJSON text frames. */
export function connectWs(
	url: string,
	handlers: WsConnectionHandlers,
	opts: ConnectWsOptions = {},
	factory: WsFactory = defaultFactory
): Promise<WsConnection> {
	return new Promise((resolve, reject) => {
		let socket: WsSocketLike;
		const timeoutMs = opts.timeoutMs ?? 8_000;
		const tls = tlsClientOptions(opts);
		try {
			socket = factory(url, {
				handshakeTimeout: timeoutMs,
				...tls
			});
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		let settled = false;
		let closed = false;
		const pending: string[] = [];
		let flushScheduled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const fail = (err: Error) => {
			if (settled) {
				handlers.onError(err.message);
				return;
			}
			settled = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			reject(err);
			try {
				socket.close();
			} catch {
				// best effort
			}
		};

		const onAbort = () => fail(Object.assign(new Error('aborted'), {name: 'AbortError'}));

		timer = setTimeout(() => fail(new Error('WebSocket connect timed out')), timeoutMs);
		if (opts.signal) {
			if (opts.signal.aborted) {
				onAbort();
				return;
			}
			opts.signal.addEventListener('abort', onAbort, {once: true});
		}

		const dispatchLine = (line: string) => {
			if (!line.startsWith('{')) return;
			try {
				handlers.onEvent(bridgeEventSchema.parse(JSON.parse(line)));
			} catch {
				handlers.onLog?.(`Invalid engine event: ${line}`);
			}
		};

		const flushPending = () => {
			flushScheduled = false;
			const batch = pending.splice(0, pending.length);
			for (const line of batch) {
				if (closed) break;
				dispatchLine(line);
			}
			if (pending.length > 0 && !closed) {
				flushScheduled = true;
				setImmediate(flushPending);
			}
		};

		const queueLine = (line: string) => {
			pending.push(line);
			if (flushScheduled) return;
			flushScheduled = true;
			setImmediate(flushPending);
		};

		socket.on('open', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			resolve({
				url,
				send(command) {
					if (closed || socket.readyState !== OPEN) {
						handlers.onError('Socket is not ready for input yet.');
						return false;
					}
					try {
						socket.send(JSON.stringify(command));
						return true;
					} catch (error) {
						handlers.onError(error instanceof Error ? error.message : String(error));
						return false;
					}
				},
				close() {
					if (closed) return;
					closed = true;
					opts.signal?.removeEventListener('abort', onAbort);
					socket.close();
				}
			});
		});

		socket.on('message', (data: unknown) => {
			const text =
				typeof data === 'string'
					? data
					: data instanceof Buffer
						? data.toString('utf8')
						: data instanceof ArrayBuffer
							? new TextDecoder().decode(data)
							: '';
			for (const line of text.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed.length > 0) queueLine(trimmed);
			}
		});

		socket.on('error', (err: unknown) => {
			const message = err instanceof Error ? err.message : 'WebSocket error';
			fail(new Error(message));
		});
		socket.on('close', () => {
			if (closed) return;
			if (pending.length > 0) flushPending();
			closed = true;
			if (!settled) {
				fail(new Error('WebSocket closed before open'));
				return;
			}
			handlers.onClose();
		});
	});
}
