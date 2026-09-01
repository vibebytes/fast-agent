import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {spawn} from 'node:child_process';
import {DEBUG_PAGE_HTML} from './page.js';

export type DebugMessage = {role: string; content: string};
export type DebugResponse = {reasoning: string; content: string};
export type DebugRequest = {id: string; turn: number; at: string; messages: DebugMessage[]; response?: DebugResponse};
export type DebugSnapshot = {requests: DebugRequest[]; model?: string; updatedAt: string};

/**
 * Minimal local web server for the `/debug` view. Serves a single static page and streams
 * the message list sent to the LLM over Server-Sent Events (no extra dependencies).
 */
export class DebugServer {
	private server?: http.Server;
	private readonly clients = new Set<http.ServerResponse>();
	private latest: DebugSnapshot = {requests: [], updatedAt: new Date().toISOString()};
	private url?: string;

	async start(): Promise<string> {
		if (this.url) return this.url;
		const server = http.createServer((req, res) => this.handle(req, res));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => resolve());
		});
		const address = server.address() as AddressInfo;
		this.url = `http://127.0.0.1:${address.port}/`;
		return this.url;
	}

	getUrl(): string | undefined {
		return this.url;
	}

	publish(snapshot: Omit<DebugSnapshot, 'updatedAt'>): void {
		this.latest = {...snapshot, updatedAt: new Date().toISOString()};
		const payload = `event: snapshot\ndata: ${JSON.stringify(this.latest)}\n\n`;
		for (const client of this.clients) {
			try {
				client.write(payload);
			} catch {
				this.clients.delete(client);
			}
		}
	}

	stop(): void {
		for (const client of this.clients) {
			try {
				client.end();
			} catch {
				// ignore
			}
		}
		this.clients.clear();
		this.server?.close();
		this.server = undefined;
		this.url = undefined;
	}

	private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
		const path = (req.url ?? '/').split('?')[0];
		if (path === '/events') {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			});
			res.write('retry: 2000\n\n');
			res.write(`event: snapshot\ndata: ${JSON.stringify(this.latest)}\n\n`);
			this.clients.add(res);
			req.on('close', () => this.clients.delete(res));
			return;
		}
		if (path === '/healthz') {
			res.writeHead(200, {'Content-Type': 'text/plain'});
			res.end('ok');
			return;
		}
		res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
		res.end(DEBUG_PAGE_HTML);
	}
}

/** Best-effort open the URL in the user's default browser. Never throws. */
export function openBrowser(url: string): void {
	try {
		if (process.platform === 'darwin') {
			spawn('open', [url], {stdio: 'ignore', detached: true}).unref();
		} else if (process.platform === 'win32') {
			spawn('cmd', ['/c', 'start', '', url], {stdio: 'ignore', detached: true}).unref();
		} else {
			spawn('xdg-open', [url], {stdio: 'ignore', detached: true}).unref();
		}
	} catch {
		// ignore — the URL is still shown in the CLI for manual opening
	}
}
