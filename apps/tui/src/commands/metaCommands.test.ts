import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionFromSlash, DEFAULT_PROJECT_ID} from './metaCommands.js';
import {routeSlashCommand} from './router.js';
import {initialState} from '../state/model.js';
import {parseBridgeCommand} from '@fastllm/bridge-protocol';

test('routeSlashCommand /new is hybrid with uiClear', () => {
	const routed = routeSlashCommand('/new My Task', initialState);
	assert.equal(routed?.kind, 'hybrid');
	if (routed?.kind === 'hybrid') {
		assert.equal(routed.name, 'new');
		assert.equal(routed.args, 'My Task');
		assert.equal(routed.uiClear, true);
	}
});

test('createSessionFromSlash maps /new args to CreateSession Meta command', () => {
	const cmd = createSessionFromSlash('My Task');
	assert.equal(cmd.type, 'CreateSession');
	assert.equal(cmd.projectId, DEFAULT_PROJECT_ID);
	assert.equal(cmd.title, 'My Task');
	const parsed = parseBridgeCommand(cmd);
	assert.equal(parsed.type, 'CreateSession');
});

test('createSessionFromSlash omits empty title', () => {
	const cmd = createSessionFromSlash('  ');
	assert.equal(cmd.type, 'CreateSession');
	assert.equal(cmd.title, undefined);
});
