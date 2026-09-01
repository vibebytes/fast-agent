import net from 'node:net';
import {parseNdjsonChunk, utf8Stream, bridgeEventSchema, type BridgeCommand, type BridgeEvent} from '@fastllm/bridge-protocol';

export type UnixConnectionHandlers = {
	onEvent: (event: BridgeEvent) => void;
	onError: (message: string) => void;
	/** Non-fatal parse / log lines. Missing handler skips the line. */
	onLog?: (message: string) => void;
	onClose: () => void;
};

export type UnixConnection = {
	socketPath: string;
	send: (command: BridgeCommand) => boolean;
	close: () => void;
};

/** Connect to a unix domain socket and frame bidirectional NDJSON. */
export function connectUnix(
	socketPath: string,
	handlers: UnixConnectionHandlers
): Promise<UnixConnection> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({path: socketPath});
		const decodeUtf8 = utf8Stream();
		let buffer = '';
		let settled = false;
		let closed = false;
		const pending: string[] = [];
		let flushScheduled = false;

		const fail = (err: Error) => {
			if (settled) {
				handlers.onError(err.message);
				return;
			}
			settled = true;
			reject(err);
		};

		const dispatchLine = (line: string) => {
			if (!line.startsWith('{')) return;
			try {
				handlers.onEvent(bridgeEventSchema.parse(JSON.parse(line)));
			} catch {
				handlers.onLog?.(`Invalid engine event: ${line}`);
			}
		};

		/** Drain framed lines on a later tick so a slow onEvent cannot pause kernel reads. */
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

		socket.once('connect', () => {
			settled = true;
			resolve({
				socketPath,
				send(command) {
					if (closed || socket.destroyed || !socket.writable) {
						handlers.onError('Socket is not ready for input yet.');
						return false;
					}
					try {
						return socket.write(`${JSON.stringify(command)}\n`);
					} catch (error) {
						handlers.onError(error instanceof Error ? error.message : String(error));
						return false;
					}
				},
				close() {
					if (closed) return;
					closed = true;
					socket.end();
					socket.destroy();
				}
			});
		});

		socket.on('data', chunk => {
			buffer = parseNdjsonChunk(buffer, decodeUtf8(chunk), queueLine);
		});

		socket.on('error', err => fail(err instanceof Error ? err : new Error(String(err))));
		socket.on('close', () => {
			if (closed) return;
			if (pending.length > 0) flushPending();
			closed = true;
			handlers.onClose();
		});
	});
}

/** Probe whether a unix socket accepts connections (does not keep the connection). */
export function tryConnectUnix(socketPath: string, timeoutMs = 500): Promise<boolean> {
	return new Promise(resolve => {
		const socket = net.createConnection({path: socketPath});
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		socket.once('connect', () => {
			clearTimeout(timer);
			finish(true);
		});
		socket.once('error', () => {
			clearTimeout(timer);
			finish(false);
		});
	});
}
