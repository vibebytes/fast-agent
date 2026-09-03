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

test('connectUnix counts invalid JSON into stats and dead letters', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-dead-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const logs: string[] = [];
	const deadLetters: Array<{line: string; count: number}> = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: () => {},
			onError: () => {},
			onLog: m => logs.push(m),
			onDeadLetter: info => deadLetters.push(info),
			onClose: () => {}
		});
		const peer = await peerP;
		peer.write('{"broken json\n{"type":"made_up_event"}\n');
		await new Promise(r => setTimeout(r, 40));
		const stats = conn.stats();
		assert.equal(stats.parseFailures, 2);
		assert.deepEqual(stats.deadLetters, ['{"broken json', '{"type":"made_up_event"}']);
		assert.deepEqual(
			deadLetters,
			[
				{line: '{"broken json', count: 1},
				{line: '{"type":"made_up_event"}', count: 2}
			]
		);
		assert.equal(logs.length, 2);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix escalates terminal-event parse failures to onError', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-term-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const errors: string[] = [];
	const logs: string[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: m => logs.push(m),
			onClose: () => {}
		});
		const peer = await peerP;
		// turn_finished with a schema-breaking payload: JSON.parse ok, zod fails.
		peer.write('{"type":"turn_finished","success":"not-a-boolean"\n');
		await new Promise(r => setTimeout(r, 40));
		assert.equal(errors.length, 1);
		assert.equal(errors[0], 'terminal event parse failure: turn_finished');
		assert.equal(logs.length, 0);
		assert.equal(conn.stats().parseFailures, 1);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix keeps non-terminal parse failures on onLog only', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-nonterm-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const errors: string[] = [];
	const logs: string[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: m => logs.push(m),
			onClose: () => {}
		});
		const peer = await peerP;
		peer.write('{"type":"assistant_delta","text":42}\n');
		await new Promise(r => setTimeout(r, 40));
		assert.equal(errors.length, 0);
		assert.equal(logs.length, 1);
		assert.match(logs[0]!, /^Invalid engine event:/);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix consecutive parse failures escalate to protocol mismatch', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-mismatch-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const errors: string[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: () => {},
			onClose: () => {}
		});
		const peer = await peerP;
		peer.write('{"type":"assistant_delta","text":1}\n{"type":"assistant_delta","text":2}\n{"type":"assistant_delta","text":3}\n');
		await new Promise(r => setTimeout(r, 40));
		assert.equal(errors.length, 1);
		assert.match(errors[0]!, /^protocol mismatch:/);
		assert.equal(conn.stats().parseFailures, 3);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix successful parse resets consecutive mismatch streak', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-reset-'));
	const socketPath = path.join(dir, 'b.sock');
	const server = net.createServer();
	const peerP = new Promise<net.Socket>(resolve => server.once('connection', resolve));
	await new Promise<void>((resolve, reject) => {
		server.listen(socketPath, resolve);
		server.once('error', reject);
	});
	const errors: string[] = [];
	try {
		const conn = await connectUnix(socketPath, {
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: () => {},
			onClose: () => {}
		});
		const peer = await peerP;
		peer.write(
			`{"type":"assistant_delta","text":1}\n${ack(1)}\n{"type":"assistant_delta","text":2}\n{"type":"assistant_delta","text":3}\n`
		);
		await new Promise(r => setTimeout(r, 40));
		assert.equal(errors.length, 0);
		assert.equal(conn.stats().parseFailures, 3);
		conn.close();
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
});

test('connectUnix timeoutMs rejects when the socket never accepts', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'unix-timeout-'));
	const socketPath = path.join(dir, 'missing.sock');
	await assert.rejects(
		connectUnix(socketPath, {onEvent: () => {}, onError: () => {}, onClose: () => {}}, {timeoutMs: 80}),
		err => err instanceof Error && /timed out|ENOENT|ECONNREFUSED|connect/i.test(err.message)
	);
});
