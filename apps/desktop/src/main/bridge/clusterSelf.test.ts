import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pinLocalSelf, rememberLocalId, rosterId} from './clusterSelf.js';
import {WorkspaceHub} from './WorkspaceHub.js';

test('pinLocalSelf keeps the desktop individual even when the peer marks itself', () => {
	const items = pinLocalSelf(
		[
			{id: 'a', displayName: 'r', self: false},
			{id: 'b', displayName: '小B', self: true}
		],
		'a'
	);
	assert.equal(items.find(row => row.id === 'a')?.self, true);
	assert.equal(items.find(row => row.id === 'b')?.self, false);
});

test('rememberLocalId only learns from a self row', () => {
	assert.equal(rememberLocalId([{id: 'a', self: true}, {id: 'b'}]), 'a');
	assert.equal(rememberLocalId([{id: 'b', self: true}], 'a'), 'b');
	assert.equal(rememberLocalId([{id: 'b'}], 'a'), 'a');
	assert.equal(rosterId({agentId: 'x', id: 'y'}), 'x');
});

test('WorkspaceHub pins 本机 after a peer roster marks itself', async () => {
	const hub = new WorkspaceHub({
		createBridge: () => ({start() {}, send: () => true, stop() {}} as never),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'self-cwd-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'self-home-'))
	});
	hub.rememberClusterRoster([
		{id: 'a', displayName: 'r', self: true, mainSessionId: 'sess-a'},
		{id: 'b', displayName: '小B', self: false, mainSessionId: 'sess-b'}
	]);
	assert.equal(hub.rosterSnapshot().find(row => row.id === 'a')?.self, true);
	hub.bindCommittedEdge('individual:b');
	hub.rememberClusterRoster([
		{id: 'a', displayName: 'r', self: false, mainSessionId: 'sess-a'},
		{id: 'b', displayName: '小B', self: true, mainSessionId: 'sess-b'}
	]);
	const pinned = hub.rosterSnapshot();
	assert.equal(pinned.find(row => row.id === 'a')?.self, true);
	assert.equal(pinned.find(row => row.id === 'b')?.self, false);
	hub.forgetClusterState();
	hub.rememberClusterRoster([
		{id: 'a', self: false},
		{id: 'b', self: true}
	]);
	assert.equal(hub.rosterSnapshot().find(row => row.id === 'a')?.self, true);
});
