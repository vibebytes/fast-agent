import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {bridgePaths, isStdioTransport} from './paths.js';

test('bridgePaths defaults under ~/.fast/run', () => {
	const p = bridgePaths({HOME: '/tmp/home-x'});
	assert.equal(p.runDir, path.join('/tmp/home-x', '.fast', 'run'));
	assert.equal(p.socketPath, path.join(p.runDir, 'bridge.sock'));
	assert.equal(p.pidFile, path.join(p.runDir, 'bridge.pid'));
	assert.equal(p.tokenFile, path.join(p.runDir, 'bridge.token'));
	assert.equal(p.logDir, path.join('/tmp/home-x', '.fast', 'logs'));
});

test('bridgePaths honors FAST_RUN_DIR and FAST_BRIDGE_SOCK', () => {
	const p = bridgePaths({
		HOME: '/tmp/home-x',
		FAST_RUN_DIR: '/var/fast/run',
		FAST_BRIDGE_SOCK: '/tmp/custom.sock'
	});
	assert.equal(p.runDir, '/var/fast/run');
	assert.equal(p.socketPath, '/tmp/custom.sock');
	assert.equal(p.pidFile, path.join('/var/fast/run', 'bridge.pid'));
});

test('isStdioTransport detects escape hatch', () => {
	assert.equal(isStdioTransport({}), false);
	assert.equal(isStdioTransport({FAST_BRIDGE_TRANSPORT: 'unix'}), false);
	assert.equal(isStdioTransport({FAST_BRIDGE_TRANSPORT: 'stdio'}), true);
	assert.equal(isStdioTransport({FAST_BRIDGE_TRANSPORT: 'STDIO'}), true);
	assert.equal(isStdioTransport({FAST_ENGINE_TRANSPORT: 'stdio'}), true);
});
