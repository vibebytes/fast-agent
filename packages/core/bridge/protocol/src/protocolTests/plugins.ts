/** protocol.test — plugins. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('command_result accepts McpConfigImport write-plane mcp ack (no name/op/state)', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'McpConfigImport',
		message: 'accepted',
		status: 'accepted',
		mcp: {
			ok: true,
			applied: true,
			restartRequired: false,
			actions: {blender: 'imported'},
			servers: ['blender']
		}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'accepted');
		assert.equal(parsed.mcp?.ok, true);
	}
	const listed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'McpConfigImport',
		message: '1 mcp servers',
		status: 'accepted',
		mcpServers: [{name: 'blender', command: 'uvx', args: ['mcp-for-blender'], enabled: true}]
	});
	assert.equal(listed.type, 'command_result');
	if (listed.type === 'command_result') {
		assert.equal(listed.mcpServers?.[0]?.name, 'blender');
	}
});

test('command_result ListMcpServers accepts admin stringly counts and env JSON', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'ListMcpServers',
		message: '1 mcp servers',
		status: 'accepted',
		mcpServers: [{
			name: 'blender',
			command: 'uvx',
			args: '["mcp-for-blender"]',
			env: '{"BLENDER_PORT":"9876"}',
			enabled: true,
			state: 'running',
			pid: '13074',
			restarts: '0',
			discoveredToolCount: '8'
		}]
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.mcpServers?.[0]?.name, 'blender');
		assert.equal(parsed.mcpServers?.[0]?.pid, 13074);
		assert.equal(parsed.mcpServers?.[0]?.restarts, 0);
		assert.equal(parsed.mcpServers?.[0]?.discoveredToolCount, 8);
		assert.equal(parsed.mcpServers?.[0]?.env, '{"BLENDER_PORT":"9876"}');
	}
});
