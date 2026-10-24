import assert from 'node:assert/strict';
import test from 'node:test';
import {appCardState} from './card.js';

test('a live server with a read page is open', () => {
	assert.deepEqual(appCardState({read: 'ok', live: true, server: 'blender'}), {kind: 'open'});
});

test('a failed read becomes a blocked card carrying the notice', () => {
	assert.deepEqual(appCardState({read: 'failed', notice: ' CSP blocked ', live: true, server: 'blender'}), {
		kind: 'blocked',
		notice: 'CSP blocked'
	});
});

test('an empty notice still names the server that failed', () => {
	assert.deepEqual(appCardState({read: 'failed', notice: '  ', live: true, server: 'blender'}), {
		kind: 'blocked',
		notice: 'blender could not be opened'
	});
});

test('a server that left the catalog is offline even when the read failed', () => {
	assert.deepEqual(appCardState({read: 'failed', notice: 'boom', live: false, server: 'blender'}), {
		kind: 'offline',
		server: 'blender'
	});
});

test('a catalog that has not answered yet never blocks a live tab', () => {
	assert.deepEqual(appCardState({read: 'pending', live: null, server: 'blender'}), {kind: 'open'});
});
