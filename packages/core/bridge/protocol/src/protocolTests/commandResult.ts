/** protocol.test — commandResult. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeEventSchema accepts command_result with all route statuses from SessionEntity', () => {
	const routeStatuses = ['decided', 'answered', 'accepted', 'rejected', 'cancelled', 'paused', 'resumed', 'triggered'] as const;
	for (const status of routeStatuses) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name: 'DecideApproval',
			message: `status=${status}`,
			status
		});
		assert.equal(parsed.type, 'command_result');
		if (parsed.type === 'command_result') {
			assert.equal(parsed.status, status);
		}
	}
});

test('bridgeEventSchema accepts command_result with classic statuses', () => {
	for (const status of ['success', 'unavailable', 'error'] as const) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name: 'model',
			message: 'Current model: default',
			status
		});
		assert.equal(parsed.type, 'command_result');
	}
});

test('bridgeEventSchema accepts command_result without status (optional)', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'help',
		message: '/help — Show help'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, undefined);
	}
});

test('bridgeEventSchema rejects command_result with unknown status', () => {
	assert.throws(() => bridgeEventSchema.parse({
		type: 'command_result',
		name: 'test',
		message: 'test',
		status: 'bogus_status'
	}));
});

test('bridgeEventSchema accepts DecideApproval command_result as emitted by Scala bridge', () => {
	const event = {
		type: 'command_result',
		name: 'DecideApproval',
		message: 'status=Running',
		status: 'decided'
	};
	const parsed = bridgeEventSchema.parse(event);
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.name, 'DecideApproval');
		assert.equal(parsed.status, 'decided');
		assert.equal(parsed.message, 'status=Running');
	}
});

test('bridgeEventSchema accepts AnswerQuestion command_result with answered status', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'AnswerQuestion',
		message: 'status=Completed',
		status: 'answered'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'answered');
	}
});

test('bridgeEventSchema accepts CancelRun/SetMode command_result with their respective statuses', () => {
	const cases = [
		{name: 'CancelRun', status: 'cancelled'},
		{name: 'SetMode', status: 'accepted'},
		{name: 'SetMode', status: 'rejected'},
		{name: 'PauseRun', status: 'paused'},
		{name: 'ResumeRun', status: 'resumed'},
		{name: 'TriggerAgent', status: 'triggered'}
	] as const;

	for (const {name, status} of cases) {
		const parsed = bridgeEventSchema.parse({
			type: 'command_result',
			name,
			message: `${name} result`,
			status
		});
		assert.equal(parsed.type, 'command_result');
	}
});

test('bridgeEventSchema accepts SubmitUserMessage command_result with queued status', () => {
	// Engine queues follow-ups while a turn is already running (CommandLoop).
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SubmitUserMessage',
		message: 'followUpId=019fb96c-ddcc-73f4-b2f0-5d6ea15e8ccf',
		status: 'queued',
		sessionId: '019fb8f8-cd2e-7b28-a49e-0cab91e4e3b2'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'queued');
	}
});

test('bridgeEventSchema accepts SubmitUserMessage command_result with steered status', () => {
	// DSH busy insert (session.prompt mode=steer). Exact payload Fast IDE rejected as Invalid engine event.
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SubmitUserMessage',
		message: '01a00207-efca-731e-be97-c35dd063ba9b:bdc90e91-e72b-4e01-ba66-0cb3d9ccf1e9',
		status: 'steered',
		sessionId: '01a00207-efca-731e-be97-c35dd063ba9b'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.status, 'steered');
	}
});

test('command_result accepts Meta projectId and pathHash stamps', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'CreateProject',
		message: 'created p1',
		status: 'accepted',
		projectId: 'p1',
		workspaceId: 'meta-ws-1',
		pathHash: 'abcdef'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.projectId, 'p1');
		assert.equal(parsed.workspaceId, 'meta-ws-1');
		assert.equal(parsed.pathHash, 'abcdef');
	}
});

test('EngineCall command and command_result keep engine error.code', () => {
	const cmd = bridgeCommandSchema.parse({
		type: 'EngineCall',
		method: 'session.models',
		payload: {sessionId: 's1'},
		sessionId: 's1',
		requestId: 'r1',
		engineKind: 'dsh'
	});
	assert.equal(cmd.type, 'EngineCall');
	if (cmd.type === 'EngineCall') {
		assert.equal(cmd.method, 'session.models');
		assert.equal(cmd.sessionId, 's1');
		assert.equal(cmd.engineKind, 'dsh');
	}
	const err = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'EngineCall',
		message: 'MISSING_CREDENTIAL',
		status: 'error',
		method: 'session.prompt',
		error: {code: 'MISSING_CREDENTIAL', message: 'no key', details: {ref: 'deepseek-official'}}
	});
	assert.equal(err.type, 'command_result');
	if (err.type === 'command_result') {
		assert.equal(err.method, 'session.prompt');
		assert.equal(err.error?.code, 'MISSING_CREDENTIAL');
		assert.equal((err.error as {details?: {ref?: string}} | undefined)?.details?.ref, 'deepseek-official');
	}
});

test('command_result accepts structured title for SetSessionTitle', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'SetSessionTitle',
		message: 'Title -> "Fix auth login"',
		status: 'success',
		sessionId: 's1',
		title: 'Fix auth login'
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.title, 'Fix auth login');
		assert.equal(parsed.sessionId, 's1');
	}
});
