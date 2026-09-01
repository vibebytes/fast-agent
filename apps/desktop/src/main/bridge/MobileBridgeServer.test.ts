import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {MobileBridgeServer} from './MobileBridgeServer.js';

type Client = {
	ws: WebSocket;
	next: () => Promise<BridgeEvent>;
	send: (command: unknown) => void;
	closed: () => Promise<void>;
};

function openClient(port: number): Promise<Client> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`);
		const pending: BridgeEvent[] = [];
		let waiting: ((value: BridgeEvent) => void) | null = null;
		ws.on('message', data => {
			const event = JSON.parse(String(data)) as BridgeEvent;
			if (waiting) {
				const resolveNext = waiting;
				waiting = null;
				resolveNext(event);
			} else {
				pending.push(event);
			}
		});
		ws.on('open', () =>
			resolve({
				ws,
				next: () =>
					new Promise<BridgeEvent>(resolve => {
						const queued = pending.shift();
						if (queued) {
							resolve(queued);
							return;
						}
						waiting = resolve;
					}),
				send: command => ws.send(JSON.stringify(command)),
				closed: () => new Promise<void>(resolve => ws.once('close', () => resolve()))
			})
		);
		ws.on('error', reject);
	});
}

function hello(token: string) {
	return {
		type: 'Hello',
		protocolVersion: 1,
		clientId: 'm1',
		clientKind: 'fast-mobile',
		authToken: token
	};
}

async function startServer(token: string, sent: BridgeCommand[]) {
	const server = new MobileBridgeServer({
		port: 0,
		token,
		send: command => {
			sent.push(command);
			return true;
		}
	});
	const port = await server.start();
	return {server, port};
}

test('rejects wrong token and closes the socket', async () => {
	const sent: BridgeCommand[] = [];
	const {server, port} = await startServer('secret-token', sent);
	try {
		const client = await openClient(port);
		client.send(hello('wrong'));
		const event = await client.next();
		assert.equal(event.type, 'HelloReject');
		if (event.type === 'HelloReject') assert.equal(event.code, 'UNAUTHORIZED');
		await client.closed();
		assert.deepEqual(sent, []);
	} finally {
		server.stop();
	}
});

test('hello ok, attach routing, and command forwarding', async () => {
	const sent: BridgeCommand[] = [];
	const {server, port} = await startServer('secret-token', sent);
	try {
		const client = await openClient(port);
		client.send(hello('secret-token'));
		const helloEvent = await client.next();
		assert.equal(helloEvent.type, 'HelloOk');

		client.send({
			type: 'AttachSession',
			sessionId: 's1',
			lastEventSeq: 0,
			clientId: 'm1'
		});
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.deepEqual(sent, [
			{type: 'AttachSession', sessionId: 's1', lastEventSeq: 0, clientId: 'm1'}
		]);

		server.handleEvent({type: 'assistant_delta', sessionId: 's1', text: 'hi'});
		const delta = await client.next();
		assert.equal(delta.type, 'assistant_delta');

		server.handleEvent({type: 'assistant_delta', sessionId: 's2', text: 'other'});
		server.handleEvent({type: 'sessions_list', sessions: []});
		const broadcast = await client.next();
		assert.equal(broadcast.type, 'sessions_list');

		server.handleEvent({
			type: 'command_result',
			name: 'CreateSession',
			message: 'ok',
			status: 'accepted',
			sessionId: 's-new',
			taskId: 't-1'
		});
		const created = await client.next();
		assert.equal(created.type, 'command_result');
		if (created.type === 'command_result') {
			assert.equal(created.name, 'CreateSession');
			assert.equal(created.sessionId, 's-new');
		}

		client.send({type: 'DetachSession', sessionId: 's1', clientId: 'm1'});
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.equal(sent.length, 2);
	} finally {
		server.stop();
	}
});

test('non-hello first command is rejected', async () => {
	const sent: BridgeCommand[] = [];
	const {server, port} = await startServer('t', sent);
	try {
		const client = await openClient(port);
		client.send({type: 'ClientHeartbeat', clientId: 'm1'});
		const event = await client.next();
		assert.equal(event.type, 'HelloReject');
		assert.deepEqual(sent, []);
	} finally {
		server.stop();
	}
});

test('invalid JSON yields an error event and keeps the connection', async () => {
	const sent: BridgeCommand[] = [];
	const {server, port} = await startServer('t', sent);
	try {
		const client = await openClient(port);
		client.ws.send('not-json');
		const event = await client.next();
		assert.equal(event.type, 'error');
		client.send(hello('t'));
		assert.equal((await client.next()).type, 'HelloOk');
	} finally {
		server.stop();
	}
});

test('pairingInfo exposes LAN ws url and token', async () => {
	const sent: BridgeCommand[] = [];
	const {server, port} = await startServer('secret-token', sent);
	try {
		const info = server.pairingInfo();
		assert.equal(info.available, true);
		assert.equal(info.port, port);
		assert.equal(info.token, 'secret-token');
		assert.equal(info.serverUrl, `ws://${info.host}:${port}/bridge`);
		assert.ok(info.host);
	} finally {
		server.stop();
	}
});
