import test from 'node:test';
import assert from 'node:assert/strict';
import {UI_BOUNDARIES, ALLOWED_BRIDGE_COMMANDS} from '../boundaries/uiBoundaries.js';

test('UI boundaries document is stable', () => {
	assert.equal(UI_BOUNDARIES.mustNotExecuteTools, true);
	assert.ok(ALLOWED_BRIDGE_COMMANDS.includes('DecideApproval'));
	assert.equal((ALLOWED_BRIDGE_COMMANDS as readonly string[]).includes('approve'), false);
});

test('allowlist is exactly the AgentAttachProtocol command surface', () => {
	assert.deepEqual([...ALLOWED_BRIDGE_COMMANDS].sort(), [
		'Ack',
		'AnswerQuestion',
		'AttachSession',
		'CancelRun',
		'CancelSession',
		'CreateSession',
		'DecideApproval',
		'DetachSession',
		'GetWorkspaceMeta',
		'Heartbeat',
		'SetProjectDisplayName',
		'SetSessionSummary',
		'SetSessionTitle',
		'SubmitUserMessage',
		'UpdateSessionStatus',
		'command'
	]);
});

test('legacy bridge commands are fully retired from the allowlist', () => {
	const allowed = ALLOWED_BRIDGE_COMMANDS as readonly string[];
	for (const legacy of ['user_message', 'provide_human_input', 'cancel', 'approve', 'shutdown']) {
		assert.equal(allowed.includes(legacy), false, `legacy command ${legacy} must not be sendable`);
	}
});
