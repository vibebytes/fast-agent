import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, parseNdjsonChunk, type BridgeCommand} from './index.js';

test('package export: bridgeEventSchema parses ready', () => {
	const parsed = bridgeEventSchema.parse({type: 'ready', protocolVersion: 2, cwd: '/tmp'});
	assert.equal(parsed.type, 'ready');
	assert.equal(parsed.protocolVersion, 2);
});

test('package export: parseNdjsonChunk frames lines', () => {
	const lines: string[] = [];
	const rem = parseNdjsonChunk('', '{"type":"Ack","sessionId":"s","clientId":"c","lastEventSeq":1}\n', line => lines.push(line));
	assert.equal(rem, '');
	assert.equal(lines.length, 1);
});

test('package export: BridgeCommand type is usable at compile time', () => {
	const cmd: BridgeCommand = {
		type: 'Heartbeat',
		sessionId: 's',
		clientId: 'c',
		atMillis: 1
	};
	assert.equal(cmd.type, 'Heartbeat');
});
