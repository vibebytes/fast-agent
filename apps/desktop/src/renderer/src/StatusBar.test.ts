import assert from 'node:assert/strict';
import test from 'node:test';
import type {EdgesList} from '@fast-ide/session-view';
import {statusBarServer} from './StatusBar.js';

const caps = {
	canOpenLocalFolder: true,
	canCreateLocalProject: true,
	canOpenRemoteFolder: false
};

const remote = {id: 'edge-1', name: 'office', ip: '10.0.0.2', port: 1979};

function list(partial: Partial<EdgesList>): EdgesList {
	return {
		activeId: 'local',
		pendingEdgeId: null,
		servers: [remote],
		capabilities: caps,
		...partial
	};
}

test('statusBarServer is empty until edges load', () => {
	assert.equal(statusBarServer(null, 'This machine'), null);
	assert.equal(statusBarServer(undefined, 'This machine'), null);
});

test('statusBarServer shows this machine on the local edge', () => {
	const shown = statusBarServer(list({activeId: 'local'}), 'This machine');
	assert.deepEqual(shown, {
		name: 'This machine',
		title: 'This machine',
		connecting: false
	});
});

test('statusBarServer shows the committed remote name and address', () => {
	const shown = statusBarServer(list({activeId: 'edge-1'}), 'This machine');
	assert.deepEqual(shown, {
		name: 'office',
		title: 'office (10.0.0.2:1979)',
		connecting: false
	});
});

test('statusBarServer shows the candidate while a switch is pending', () => {
	const shown = statusBarServer(
		list({activeId: 'local', pendingEdgeId: 'edge-1'}),
		'This machine'
	);
	assert.deepEqual(shown, {
		name: 'office',
		title: 'office (10.0.0.2:1979)',
		connecting: true
	});
});

test('statusBarServer pending back to this machine', () => {
	const shown = statusBarServer(
		list({activeId: 'edge-1', pendingEdgeId: 'local'}),
		'This machine'
	);
	assert.deepEqual(shown, {
		name: 'This machine',
		title: 'This machine',
		connecting: true
	});
});
