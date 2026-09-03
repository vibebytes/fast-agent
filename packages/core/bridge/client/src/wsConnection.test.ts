import test from 'node:test';
import assert from 'node:assert/strict';
import type {PeerCertificate} from 'node:tls';
import {connectWs, tlsClientOptions, type WsSocketLike} from './wsConnection.js';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {fingerprintOf} from './tlsPin.js';

class FakeSocket {
	static instances: FakeSocket[] = [];
	url: string;
	opts: Record<string, unknown>;
	readyState = 0;
	sent: string[] = [];
	private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

	constructor(url: string, opts: Record<string, unknown> = {}) {
		this.url = url;
		this.opts = opts;
		FakeSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit('open');
		});
	}

	on(type: string, fn: (...args: unknown[]) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = 3;
		this.emit('close');
	}

	emit(type: string, ...args: unknown[]): void {
		for (const fn of this.listeners.get(type) ?? []) fn(...args);
	}

	pushText(text: string): void {
		this.emit('message', text);
	}
}

function factory(url: string, opts: Record<string, unknown>): WsSocketLike {
	return new FakeSocket(url, opts) as unknown as WsSocketLike;
}

const ack = (seq: number) => JSON.stringify({type: 'Ack', sessionId: 's', clientId: 'c', lastEventSeq: seq});

test('connectWs delivers framed Ack events', async () => {
	FakeSocket.instances = [];
	const events: number[] = [];
	const conn = await connectWs(
		'ws://127.0.0.1:1979/bridge',
		{
			onEvent: (event: BridgeEvent) => {
				if (event.type === 'Ack') events.push(event.lastEventSeq);
			},
			onError: () => {},
			onClose: () => {}
		},
		{},
		factory
	);
	const peer = FakeSocket.instances[0];
	assert.ok(peer);
	peer.pushText(`${ack(1)}\n${ack(2)}`);
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(events, [1, 2]);
	assert.equal(
		conn.send({type: 'Hello', protocolVersion: 1, clientId: 'c1', clientKind: 'fast-ide'}),
		true
	);
	assert.equal(peer.sent.length, 1);
	assert.ok(!peer.sent[0].includes('\n'));
	conn.close();
});

test('connectWs rejects a bad constructor URL', async () => {
	await assert.rejects(() =>
		connectWs(
			'not-a-url',
			{onEvent: () => {}, onError: () => {}, onClose: () => {}},
			{},
			() => {
				throw new Error('Invalid URL');
			}
		)
	);
});

test('connectWs splits one frame with multiple lines', async () => {
	FakeSocket.instances = [];
	const events: number[] = [];
	const conn = await connectWs(
		'ws://127.0.0.1:9/bridge',
		{
			onEvent: event => {
				if (event.type === 'Ack') events.push(event.lastEventSeq);
			},
			onError: () => {},
			onClose: () => {}
		},
		{},
		factory
	);
	FakeSocket.instances[0]?.pushText(`${ack(3)}\n${ack(4)}\n`);
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(events, [3, 4]);
	conn.close();
});

test('connectWs times out when open never fires', async () => {
	await assert.rejects(
		() =>
			connectWs(
				'wss://10.255.255.1:9/bridge',
				{onEvent: () => {}, onError: () => {}, onClose: () => {}},
				{timeoutMs: 30},
				() =>
					({
						readyState: 0,
						send() {},
						close() {},
						on() {}
					}) as WsSocketLike
			),
		/timed out/
	);
});

test('tlsClientOptions prefers caPem over skip-verify', () => {
	const both = tlsClientOptions({
		caPem: '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
		insecureSkipVerify: true
	});
	assert.equal(both.rejectUnauthorized, false);
	assert.ok(both.ca);
	assert.equal(typeof both.checkServerIdentity, 'function');
	assert.equal(tlsClientOptions({insecureSkipVerify: true}).rejectUnauthorized, false);
});

test('tlsClientOptions pins by fingerprint and prefers it over skip-verify', () => {
	const raw = Buffer.from('hello');
	const fp = fingerprintOf(raw);
	const opts = tlsClientOptions({fingerprint: fp, insecureSkipVerify: true});
	assert.equal(opts.rejectUnauthorized, false);
	assert.equal(opts.checkServerIdentity!('h', {raw} as PeerCertificate), undefined);
	const mismatch = opts.checkServerIdentity!('h', {raw: Buffer.from('other')} as PeerCertificate);
	assert.ok(mismatch instanceof Error);
	assert.match(mismatch.message, /fingerprint does not match/);
});

test('connectWs passes skip-verify to the socket factory', async () => {
	FakeSocket.instances = [];
	let seen: Record<string, unknown> | undefined;
	const conn = await connectWs(
		'wss://127.0.0.1:1980/bridge',
		{onEvent: () => {}, onError: () => {}, onClose: () => {}},
		{insecureSkipVerify: true, timeoutMs: 200},
		(url, opts) => {
			seen = opts;
			return factory(url, opts);
		}
	);
	assert.equal(seen?.rejectUnauthorized, false);
	conn.close();
});

test('connectWs upgrades terminal parse failures to onError', async () => {
	FakeSocket.instances = [];
	const errors: string[] = [];
	const logs: string[] = [];
	const conn = await connectWs(
		'ws://127.0.0.1:1979/bridge',
		{
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: m => logs.push(m),
			onClose: () => {}
		},
		{},
		factory
	);
	const peer = FakeSocket.instances[0];
	assert.ok(peer);
	peer.pushText('{"type":"turn_finished","success":"not-a-boolean"}\n');
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(errors, ['terminal event parse failure: turn_finished']);
	assert.deepEqual(logs, []);
	assert.equal(conn.stats().parseFailures, 1);
	conn.close();
});

test('connectWs records dead letters and escalates consecutive parse failures', async () => {
	FakeSocket.instances = [];
	const errors: string[] = [];
	const logs: string[] = [];
	const deadLetters: Array<{line: string; count: number}> = [];
	const conn = await connectWs(
		'ws://127.0.0.1:1979/bridge',
		{
			onEvent: () => {},
			onError: m => errors.push(m),
			onLog: m => logs.push(m),
			onDeadLetter: info => deadLetters.push(info),
			onClose: () => {}
		},
		{},
		factory
	);
	const peer = FakeSocket.instances[0];
	assert.ok(peer);
	peer.pushText('{"broken json\n{"type":"made_up_event"}\n{"type":"assistant_delta","text":1}\n');
	await new Promise(r => setTimeout(r, 20));
	const stats = conn.stats();
	assert.equal(stats.parseFailures, 3);
	assert.deepEqual(stats.deadLetters, [
		'{"broken json',
		'{"type":"made_up_event"}',
		'{"type":"assistant_delta","text":1}'
	]);
	assert.deepEqual(
		deadLetters,
		[
			{line: '{"broken json', count: 1},
			{line: '{"type":"made_up_event"}', count: 2},
			{line: '{"type":"assistant_delta","text":1}', count: 3}
		]
	);
	assert.match(errors[errors.length - 1]!, /^protocol mismatch:/);
	assert.equal(logs.length, 3);
	conn.close();
});
