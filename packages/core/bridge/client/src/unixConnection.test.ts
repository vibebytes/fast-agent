import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {connectUnix} from './unixConnection.js';

const ack = (seq: number) =>
	JSON.stringify({type: 'Ack', sessionId: 's', clientId: 'c', lastEventSeq: seq});

test('connectUnix delivers framed Ack events', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-conn-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const events: number[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: event => {
				if (event.type === 'Ack') events.push(event.lastEventSeq);
			},
			onError: () => {},
			onClose: () => {}
		});
		const peer = await peerP;
		peer.write(`${ack(1)}\n${ack(2)}\n`);
		await new Promise(r => setTimeout(r, 40));
		assert.deepEqual(events, [1, 2]);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix delivers every line even when onEvent spins', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-spin-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const events: number[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: event => {
				if (event.type === 'Ack') events.push(event.lastEventSeq);
				if (events.length === 1) {
					const t = Date.now();
					while (Date.now() - t < 30) {
						/* Hub/zod used to run here and pause kernel reads */
					}
				}
			},
			onError: () => {},
			onClose: () => {}
		});
		const peer = await peerP;
		const lines = Array.from({length: 40}, (_, i) => ack(i));
		peer.write(`${lines.join('\n')}\n`);
		await new Promise(r => setTimeout(r, 80));
		assert.equal(events.length, 40);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix reassembles CJK split across socket reads', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-cjk-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const texts: string[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: event => {
				if (event.type === 'assistant_delta') texts.push(event.text);
			},
			onError: () => {},
			onClose: () => {}
		});
		const peer = await peerP;
		const line = `${JSON.stringify({type: 'assistant_delta', text: '最严重的是'})}\n`;
		const bytes = Buffer.from(line);
		const idx = bytes.indexOf(Buffer.from('重'));
		peer.write(bytes.subarray(0, idx + 2));
		await new Promise(r => setTimeout(r, 20));
		peer.write(bytes.subarray(idx + 2));
		await new Promise(r => setTimeout(r, 40));
		assert.deepEqual(texts, ['最严重的是']);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});
