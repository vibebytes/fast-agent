import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeCommandSchema} from '@fastllm/bridge-protocol';
import {isMcpServerOp, mcpAdminMethods, mcpControlResult, mcpServerOps, mcpServerRow} from './mcp.js';

test('mcp admin method names match Extension admin shape', () => {
	assert.deepEqual(mcpAdminMethods, [
		'listMcpServers',
		'mcpServerControl',
		'mcpServerPut',
		'mcpServerEnabled',
		'mcpServerDelete',
		'mcpConfigImport',
		'mcpConfigReload'
	]);
});

test('control ops match engine McpOp', () => {
	assert.deepEqual(mcpServerOps, ['start', 'stop', 'restart', 'reset-circuit', 'status']);
	assert.equal(isMcpServerOp('restart'), true);
	assert.equal(isMcpServerOp('reset-circuit'), true);
	assert.equal(isMcpServerOp('Stop'), false);
	assert.equal(isMcpServerOp(''), false);
});

test('mcpServerRow normalizes null optional fields to undefined', () => {
	const row = mcpServerRow({
		name: 'docs',
		transport: 'stdio',
		command: 'node',
		args: ['server.js'],
		env: {A: '1'},
		enabled: true,
		restartRequired: false,
		state: 'running',
		pid: 4242,
		restarts: 1,
		lastError: null,
		stderrTail: null,
		connectionStatus: null,
		discoveredToolCount: null
	});
	assert.equal(row.pid, 4242);
	assert.equal(row.restarts, 1);
	assert.equal('lastError' in row, false);
	assert.equal('stderrTail' in row, false);
	assert.equal('connectionStatus' in row, false);
	assert.equal('discoveredToolCount' in row, false);
	assert.equal(row.enabled, true);
});

test('mcpServerRow keeps process failures visible', () => {
	const row = mcpServerRow({
		name: 'docs',
		state: 'exited',
		restarts: 3,
		lastError: 'spawn failed',
		stderrTail: 'EACCES',
		connectionStatus: 'error',
		discoveredToolCount: 0,
		restartRequired: true
	});
	assert.equal(row.lastError, 'spawn failed');
	assert.equal(row.stderrTail, 'EACCES');
	assert.equal(row.connectionStatus, 'error');
	assert.equal(row.discoveredToolCount, 0);
	assert.equal(row.restartRequired, true);
});

test('mcpControlResult keeps restartRequired only when true', () => {
	const yes = mcpControlResult({ok: true, name: 'docs', op: 'restart', state: 'running', restartRequired: true});
	assert.equal(yes.restartRequired, true);
	const no = mcpControlResult({ok: true, name: 'docs', op: 'stop', state: 'running'});
	assert.equal('restartRequired' in no, false);
});

test('Mcp* commands parse on the bridge protocol union', () => {
	const cases = [
		{type: 'ListMcpServers'},
		{type: 'McpServerControl', name: 'docs', op: 'restart'},
		{type: 'McpServerPut', name: 'docs', config: {command: 'node', args: ['x.js']}},
		{type: 'McpServerEnabled', name: 'docs', enabled: false},
		{type: 'McpServerDelete', name: 'docs'},
		{type: 'McpConfigImport', payload: {mcpServers: {docs: {command: 'node'}}}},
		{type: 'McpConfigReload'}
	];
	for (const c of cases) {
		assert.equal(bridgeCommandSchema.safeParse(c).success, true, c.type);
	}
	assert.equal(bridgeCommandSchema.safeParse({type: 'McpServerControl', name: 'docs', op: 'bogus'}).success, false);
});
