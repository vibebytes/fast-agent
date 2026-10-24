import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {McpServerRow} from '@fastllm/bridge-client';
import {carriedFields, mergeServerConfig, parseKvLines} from './serverConfigForm.js';
import type {ServerFormState} from './serverConfigForm.js';

const form = (patch: Partial<ServerFormState> = {}): ServerFormState => ({
	transport: 'stdio',
	command: 'uvx blender-mcp',
	args: '',
	env: '',
	url: '',
	autoApprove: true,
	mcpApps: true,
	...patch
});

const row = {
	name: 'blender',
	transport: 'stdio',
	command: 'uvx',
	description: 'Blender viewport',
	timeout: 30000,
	startupTimeout: 60000,
	allowedTools: ['render'],
	blockedTools: ['exec'],
	sandbox: 'workspace',
	auth: {type: 'none'}
} as unknown as McpServerRow;

test('carriedFields keeps the unrendered row fields so a replace-save does not clear them', () => {
	assert.deepEqual(carriedFields(row), {
		description: 'Blender viewport',
		timeout: 30000,
		startupTimeout: 60000,
		allowedTools: ['render'],
		blockedTools: ['exec'],
		sandbox: 'workspace',
		auth: {type: 'none'}
	});
	assert.deepEqual(carriedFields(null), {});
});

test('merge keeps carried keys and sends the rendered app-level switches', () => {
	const config = mergeServerConfig(form({command: ' uvx  blender-mcp '}), carriedFields(row));
	assert.equal(config.transport, 'stdio');
	assert.equal(config.command, 'uvx  blender-mcp');
	assert.deepEqual(config.args, []);
	assert.deepEqual(config.env, {});
	assert.equal(config.autoApprove, true);
	assert.equal(config.mcpApps, true);
	assert.equal(config.description, 'Blender viewport');
	assert.deepEqual(config.allowedTools, ['render']);
});

test('args split on whitespace and env lines parse into a map', () => {
	const config = mergeServerConfig(
		form({command: 'uvx', args: ' blender-mcp  --port 9876 ', env: 'A=1\n\nB = two=2'})
	);
	assert.deepEqual(config.args, ['blender-mcp', '--port', '9876']);
	assert.deepEqual(config.env, {A: '1', B: 'two=2'});
	assert.deepEqual(parseKvLines('NOEQUALS'), {});
});

test('switching to remote drops the stdio endpoint fields and the page switch', () => {
	const config = mergeServerConfig(
		form({transport: 'remote', url: ' https://x.example/mcp ', autoApprove: false}),
		carriedFields(row)
	);
	assert.deepEqual(config, {
		transport: 'remote',
		url: 'https://x.example/mcp',
		autoApprove: false,
		description: 'Blender viewport',
		timeout: 30000,
		startupTimeout: 60000,
		allowedTools: ['render'],
		blockedTools: ['exec'],
		sandbox: 'workspace',
		auth: {type: 'none'}
	});
	assert.equal('mcpApps' in config, false);
	assert.equal('command' in config, false);
	assert.equal('env' in config, false);
});

test('clearing the env box sends an empty map instead of reviving the old one', () => {
	const config = mergeServerConfig(form({command: 'uvx', env: ''}), carriedFields(row));
	assert.deepEqual(config.env, {});
});

test('a new server sends only what the dialog rendered', () => {
	const config = mergeServerConfig(form({command: 'uvx', autoApprove: false, mcpApps: false}));
	assert.deepEqual(config, {
		transport: 'stdio',
		command: 'uvx',
		args: [],
		env: {},
		autoApprove: false,
		mcpApps: false
	});
});
