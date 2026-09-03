import {createHash, timingSafeEqual} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import {networkInterfaces} from 'node:os';
import {WebSocket, WebSocketServer} from 'ws';
import {
	bridgeCommandSchema,
	type BridgeCommand,
	type BridgeEvent
} from '@fastllm/bridge-protocol';

export type MobileBridgeServerOptions = {
	port: number;
	token: string;
	/** Sink into the daemon connection (WorkspaceHub bridge). */
	send: (command: BridgeCommand) => boolean;
	log?: (message: string) => void;
};

const HELLO_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const BRIDGE_PATH = '/bridge';
const PROTOCOL_VERSION = 1;

/** Events that make no sense to relay to a phone (handshake / daemon lifecycle). */
const NON_RELAYABLE = new Set(['HelloOk', 'HelloReject', 'daemon_shutting_down']);

/** Host-wide results: must reach the phone before it can Attach the new session. */
const HOST_RESULT_NAMES = new Set(['CreateSession', 'NewSession']);

type ConnState = {
	ws: WebSocket;
	authed: boolean;
	clientId: string;
	sessions: Set<string>;
	helloTimer: NodeJS.Timeout;
};

function tokenDigest(token: string): Buffer {
	return createHash('sha256').update(token, 'utf8').digest();
}

function tokensMatch(a: string, b: string): boolean {
	return timingSafeEqual(tokenDigest(a), tokenDigest(b));
}

function hasSessionId(event: BridgeEvent): event is BridgeEvent & {sessionId: string} {
	return 'sessionId' in event && typeof event.sessionId === 'string';
}

/** First non-internal IPv4 address (LAN), falling back to loopback. */
export function lanAddress(): string {
	for (const addrs of Object.values(networkInterfaces())) {
		for (const addr of addrs ?? []) {
			if (addr.family === 'IPv4' && !addr.internal) return addr.address;
		}
	}
	return '127.0.0.1';
}

/**
 * LAN WebSocket server (ws://host:port/bridge) that lets the mobile app speak
 * BridgeCommand/BridgeEvent through the desktop's daemon connection. One Hello
 * handshake per socket with token check; events are routed to sockets that
 * attached the event's session.
 */
export class MobileBridgeServer {
	private readonly options: MobileBridgeServerOptions;
	private server?: Server;
	private wss?: WebSocketServer;
	private conns = new Set<ConnState>();
	private tokenHash = tokenDigest('');
	private started = false;
	private boundPort?: number;

	constructor(options: MobileBridgeServerOptions) {
		this.options = options;
	}

	setToken(token: string): void {
		this.options.token = token;
	}

	start(): Promise<number> {
		if (this.started) return Promise.resolve(this.boundPort ?? this.options.port);
		this.tokenHash = tokenDigest(this.options.token);
		const server = createServer((_req, res) => {
			res.writeHead(426, {'Upgrade': 'websocket'}).end();
		});
		const wss = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE_BYTES});
		server.on('upgrade', (req, socket, head) => {
			const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
			if (pathname !== BRIDGE_PATH) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, ws => this.accept(ws));
		});
		this.server = server;
		this.wss = wss;
		this.started = true;
		return new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(this.options.port, '0.0.0.0', () => {
				server.removeListener('error', reject);
				const address = server.address();
				const port = typeof address === 'object' && address ? address.port : this.options.port;
				this.boundPort = port;
				this.options.log?.(`mobile bridge listening on 0.0.0.0:${port} (ws ${BRIDGE_PATH})`);
				resolve(port);
			});
		});
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		this.boundPort = undefined;
		for (const conn of this.conns) {
			clearTimeout(conn.helloTimer);
			conn.ws.close(1001, 'server stopping');
		}
		this.conns.clear();
		this.wss?.close();
		this.wss = undefined;
		this.server?.close();
		this.server = undefined;
	}

	/** Pairing export for the desktop settings page (S7.2). */
	pairingInfo(): {available: boolean; host: string; port: number; serverUrl: string; token: string} {
		const host = lanAddress();
		const port = this.boundPort ?? this.options.port;
		return {
			available: this.started && Boolean(this.options.token),
			host,
			port,
			serverUrl: `ws://${host}:${port}${BRIDGE_PATH}`,
			token: this.options.token
		};
	}

	/** Feed every daemon event in; routed to attached sockets. */
	handleEvent(event: BridgeEvent): void {
		if (NON_RELAYABLE.has(event.type)) return;
		const sessionId = hasSessionId(event) ? event.sessionId : undefined;
		const hostWide =
			!sessionId ||
			(event.type === 'command_result' && HOST_RESULT_NAMES.has(event.name));
		for (const conn of this.conns) {
			if (!conn.authed) continue;
			if (!hostWide && sessionId && !conn.sessions.has(sessionId)) continue;
			this.write(conn, event);
		}
	}

	private accept(ws: WebSocket): void {
		const conn: ConnState = {
			ws,
			authed: false,
			clientId: '',
			sessions: new Set<string>(),
			helloTimer: setTimeout(() => {
				this.options.log?.('mobile socket dropped: Hello timeout');
				ws.close(4001, 'Hello timeout');
			}, HELLO_TIMEOUT_MS)
		};
		this.conns.add(conn);
		ws.on('message', data => this.onMessage(conn, String(data)));
		ws.on('close', () => this.drop(conn));
		ws.on('error', () => this.drop(conn));
	}

	private drop(conn: ConnState): void {
		clearTimeout(conn.helloTimer);
		this.conns.delete(conn);
	}

	private onMessage(conn: ConnState, raw: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.write(conn, {type: 'error', message: 'invalid JSON message'});
			return;
		}
		const command = bridgeCommandSchema.safeParse(parsed);
		if (!command.success) {
			this.write(conn, {type: 'error', message: 'unknown command'});
			return;
		}
		if (!conn.authed) {
			this.onPreAuthCommand(conn, command.data);
			return;
		}
		this.route(conn, command.data);
	}

	private onPreAuthCommand(conn: ConnState, command: BridgeCommand): void {
		if (command.type !== 'Hello') {
			this.reject(conn, 'UNAUTHORIZED', 'Hello required');
			return;
		}
		if (command.protocolVersion !== PROTOCOL_VERSION) {
			this.reject(conn, 'VERSION_MISMATCH', `expected protocol ${PROTOCOL_VERSION}`);
			return;
		}
		if (!this.options.token || !tokensMatch(command.authToken ?? '', this.options.token)) {
			this.reject(conn, 'UNAUTHORIZED', 'invalid token');
			return;
		}
		conn.authed = true;
		conn.clientId = command.clientId;
		clearTimeout(conn.helloTimer);
		this.write(conn, {type: 'HelloOk', protocolVersion: PROTOCOL_VERSION, serverTimeMillis: Date.now()});
	}

	private reject(conn: ConnState, code: string, message: string): void {
		this.write(conn, {type: 'HelloReject', code, message});
		conn.ws.close(4003, code);
		this.drop(conn);
	}

	private route(conn: ConnState, command: BridgeCommand): void {
		if (command.type === 'AttachSession') {
			conn.sessions.add(command.sessionId);
		} else if (command.type === 'DetachSession') {
			conn.sessions.delete(command.sessionId);
		} else if (command.type === 'Goodbye') {
			conn.ws.close(1000, 'goodbye');
			this.drop(conn);
			return;
		}
		const sent = this.options.send(command);
		if (!sent) {
			this.write(conn, {type: 'error', message: 'desktop daemon not connected'});
		}
	}

	private write(conn: ConnState, event: BridgeEvent): void {
		if (conn.ws.readyState !== WebSocket.OPEN) return;
		try {
			conn.ws.send(JSON.stringify(event));
		} catch {
			this.drop(conn);
		}
	}
}
