/** protocol.test — checkout. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeCommandSchema round-trips workspace FS host commands', () => {
	const cases = [
		{type: 'ListWorkspaceDir', requestId: 'r1', workspaceId: 'abcdef123456'},
		{
			type: 'ListWorkspaceDir',
			requestId: 'r2',
			workspaceId: 'abcdef123456',
			relativePath: 'src'
		},
		{
			type: 'GetWorkspaceFile',
			requestId: 'r3',
			workspaceId: 'abcdef123456',
			relativePath: 'README.md'
		},
		{
			type: 'SaveWorkspaceFile',
			requestId: 'r4',
			workspaceId: 'abcdef123456',
			relativePath: 'a.ts',
			content: 'export {}',
			mtime: 1_700_000_000_000,
			bytes: 11
		},
		{type: 'GitWorkspaceStatus', requestId: 'r5', workspaceId: 'abcdef123456'},
		{type: 'ListHostDir', requestId: 'r6'},
		{type: 'ListHostDir', requestId: 'r7', path: '/home/kai'},
		{type: 'CreateHostDir', requestId: 'r8', parent: '/home/kai', name: 'code'}
	] as const;
	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('command_result accepts fs payload and requestId', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GetWorkspaceFile',
		message: '12 bytes',
		status: 'success',
		pathHash: 'abcdef123456',
		requestId: 'req-1',
		fs: {relativePath: 'a.ts', content: 'hi', mtime: 1, bytes: 2}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.requestId, 'req-1');
		assert.equal(parsed.fs?.relativePath, 'a.ts');
	}
});

test('command_result git payload is optional and parses', () => {
	const withGit = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'GitWorkspaceStatus',
		message: 'ok',
		status: 'success',
		requestId: 'r1',
		pathHash: 'abcdef123456',
		git: {
			available: true,
			branch: 'main',
			dirty: true,
			files: [{path: 'a.txt', kind: 'modified'}]
		}
	});
	assert.equal(withGit.type, 'command_result');
	if (withGit.type === 'command_result') {
		assert.equal(withGit.git?.available, true);
		assert.equal(withGit.git?.branch, 'main');
		assert.equal(withGit.git?.files?.[0]?.kind, 'modified');
	}
	const without = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'ListWorkspaceDir',
		message: 'ok',
		status: 'success',
		requestId: 'r2'
	});
	assert.equal(without.type, 'command_result');
	if (without.type === 'command_result') {
		assert.equal(without.git, undefined);
	}
});

test('workspace_file_changed event parses', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'workspace_file_changed',
		pathHash: 'abcdef123456',
		relativePath: 'a.ts',
		mtime: 42,
		origin: 'client',
		connectionId: 'conn-1'
	});
	assert.equal(parsed.type, 'workspace_file_changed');
});
