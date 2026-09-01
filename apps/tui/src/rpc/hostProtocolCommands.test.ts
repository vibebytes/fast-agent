import test from 'node:test';
import assert from 'node:assert/strict';
import {isHostProtocolCommandResult, isSilentCommandResult} from './hostProtocolCommands.js';

test('PascalCase Bridge ops are host protocol / silent', () => {
	assert.equal(isHostProtocolCommandResult('EnsureProject'), true);
	assert.equal(isSilentCommandResult('BindSessionWorkspace'), true);
	assert.equal(isSilentCommandResult('CreateSession'), true);
	assert.equal(isSilentCommandResult('DecideApproval'), true);
});

test('user slash command_result names stay in the transcript stream', () => {
	assert.equal(isSilentCommandResult('skills'), false);
	assert.equal(isSilentCommandResult('sessions'), false);
	assert.equal(isSilentCommandResult('model'), false);
	assert.equal(isSilentCommandResult(undefined), false);
});

test('Goal gate outcomes stay visible; CancelRun stays log-only', () => {
	assert.equal(isSilentCommandResult('CancelRun'), true);
	assert.equal(isSilentCommandResult('ConfirmGoal'), false);
	assert.equal(isSilentCommandResult('CancelGoal'), false);
	assert.equal(isSilentCommandResult('SteerGoal'), false);
	assert.equal(isSilentCommandResult('EscalateResume'), false);
});
