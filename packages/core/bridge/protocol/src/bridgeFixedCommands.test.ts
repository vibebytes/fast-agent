import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIDGE_FIXED_COMMAND_NAMES, isBridgeFixedCommand} from './bridgeFixedCommands.js';

/** Must match Scala `BridgeFixedCommandsSpec.ExpectedSorted`. */
const EXPECTED_SORTED = [
	'agents',
	'clear',
	'confirm-goal',
	'confirmgoal',
	'context',
	'copy',
	'ctx',
	'debug',
	'delete-session',
	'exit-plan',
	'exit_plan',
	'history',
	'mode',
	'model',
	'new',
	'nodes',
	'reset',
	'restore',
	'resume',
	'rule',
	'sandbox',
	'sessions',
	'skills',
	'tasks',
	'title',
	'usage'
];

test('CONTRACT: BRIDGE_FIXED_COMMAND_NAMES matches Engine BridgeFixedCommands', () => {
	assert.deepEqual([...BRIDGE_FIXED_COMMAND_NAMES].sort(), EXPECTED_SORTED);
});

test('isBridgeFixedCommand is case-insensitive', () => {
	assert.equal(isBridgeFixedCommand('Skills'), true);
	assert.equal(isBridgeFixedCommand('explain-code'), false);
	assert.equal(isBridgeFixedCommand('mode'), true);
	assert.equal(isBridgeFixedCommand('agent'), false);
});
