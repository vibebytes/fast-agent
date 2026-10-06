import assert from 'node:assert/strict';
import test from 'node:test';
import {clusterReach} from './clusterReach.js';

const card = {
	endpoints: ['wss://127.0.0.1:1982/bridge'],
	fingerprint: 'sha256:abc',
	mainSessionId: 'sess-b'
};

test('a missing wss endpoint or a failed inspect is unreachable', () => {
	assert.equal(clusterReach({endpoints: ['unix:///tmp/b.sock'], fingerprint: 'sha256:abc', mainSessionId: 's'}, null).message, '不可连接');
	assert.equal(clusterReach(card, null).message, '不可连接');
});

test('a certificate that does not match the card is refused before Hello', () => {
	assert.equal(clusterReach(card, 'sha256:other').message, '指纹不符');
	assert.equal(clusterReach({...card, fingerprint: ''}, 'sha256:abc').message, '指纹不符');
});

test('a reachable card without a main session can connect but has nothing to open', () => {
	const reach = clusterReach({...card, mainSessionId: undefined}, 'sha256:abc');
	assert.equal(reach.reach, 'no-main');
	assert.equal(reach.message, '没有主会话');
});

test('a matching certificate with a main session is open', () => {
	assert.equal(clusterReach(card, 'sha256:abc').reach, 'open');
});

test('self does not need a remote certificate', () => {
	assert.equal(clusterReach({self: true, mainSessionId: 'sess-a'}, null).reach, 'open');
	assert.equal(clusterReach({self: true}, null).message, '没有主会话');
});
