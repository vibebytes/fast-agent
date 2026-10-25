import assert from 'node:assert/strict';
import test from 'node:test';
import {canAcceptReady, nextPhase} from './surfacePhase';

test('url 决定 waiting / handshaking', () => {
	assert.equal(nextPhase('waiting', {kind: 'url', hasUrl: true}), 'handshaking');
	assert.equal(nextPhase('ready', {kind: 'url', hasUrl: false}), 'waiting');
});

test('surface.ready 按能力校验分流 ready / rejected', () => {
	assert.equal(nextPhase('handshaking', {kind: 'page.ready', accepted: true}), 'ready');
	assert.equal(nextPhase('handshaking', {kind: 'page.ready', accepted: false}), 'rejected');
});

test('timeout 只在 handshaking 生效，不覆盖已就绪', () => {
	assert.equal(nextPhase('handshaking', {kind: 'timeout'}), 'timeout');
	assert.equal(nextPhase('ready', {kind: 'timeout'}), 'ready');
	assert.equal(nextPhase('waiting', {kind: 'timeout'}), 'waiting');
});

test('retry 回到 handshaking', () => {
	assert.equal(nextPhase('timeout', {kind: 'retry'}), 'handshaking');
	assert.equal(nextPhase('rejected', {kind: 'retry'}), 'handshaking');
});

test('超时后迟到的 surface.ready 仍可救回', () => {
	assert.equal(canAcceptReady('handshaking'), true);
	assert.equal(canAcceptReady('timeout'), true);
	assert.equal(canAcceptReady('ready'), false);
	assert.equal(canAcceptReady('rejected'), false);
});
