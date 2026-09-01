import test from 'node:test';
import assert from 'node:assert/strict';
import {
	assertSkillCommandPinned,
	commandPinsSession,
	isSkillSlashBridgeCommand
} from './skillSlashContract.js';
import type {BridgeCommand} from '@fastllm/bridge-protocol';

test('CONTRACT: command without sessionId is rejected (silent-UI regression)', () => {
	const bare: BridgeCommand = {type: 'command', name: 'explain-code', args: 'x'};
	assert.equal(commandPinsSession(bare), false);
	assert.throws(
		() => assertSkillCommandPinned(bare),
		/missing sessionId|silent UI/
	);
});

test('CONTRACT: command with sessionId is accepted', () => {
	const pinned: BridgeCommand = {
		type: 'command',
		name: 'explain-code',
		args: 'x',
		sessionId: 'sess-task'
	};
	assert.equal(isSkillSlashBridgeCommand(pinned), true);
	assert.equal(commandPinsSession(pinned), true);
	assert.doesNotThrow(() => assertSkillCommandPinned(pinned, 'sess-task'));
});

test('CONTRACT: empty/whitespace sessionId is not a pin', () => {
	assert.equal(
		commandPinsSession({type: 'command', name: 'skills', args: '', sessionId: '   '}),
		false
	);
});
