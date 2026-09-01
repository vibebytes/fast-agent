/**
 * Non-PTY coverage for unix boot queue: input before sessionId must enqueue,
 * then become flushable once Attached arrives (mirrors AppContainer effect).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {canFlushQueuedInput} from '@fast-ide/session-view';
import {initialState, type UiState} from './model.js';
import {reducer} from './reducer.js';
import {emptyUnixBootstrap, stepUnixBootstrap} from '../rpc/unixSessionBootstrap.js';

function sessionReady(state: UiState): boolean {
	return (
		state.ready &&
		Boolean(state.sessionId) &&
		state.inputMode !== 'exited' &&
		state.inputMode !== 'starting'
	);
}

test('boot queue: Attached makes canFlushQueuedInput true without prior turn', () => {
	let state = initialState;
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'ready',
			protocolVersion: 2,
			engineEpoch: 'e',
			capabilities: [],
			model: 'm',
			maxTurns: 50,
			standalone: true,
			cwd: '/tmp'
			// no sessionId — unix strip
		}
	});
	assert.equal(sessionReady(state), false);

	state = reducer(state, {
		type: 'enqueue_input',
		input: {id: 'q1', text: '你是谁', state: 'queued'}
	});
	assert.equal(state.queue.length, 1);
	assert.equal(
		canFlushQueuedInput({
			sessionReady: sessionReady(state),
			running: state.running,
			queuePaused: state.queuePaused,
			queueLength: state.queue.length,
			lastTurnTerminal: state.lastTurnTerminal
		}),
		false
	);

	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'Attached', sessionId: 'sess-boot', clientId: 'ink-1', lastEventSeq: 0}
	});
	assert.equal(state.sessionId, 'sess-boot');
	assert.equal(sessionReady(state), true);
	assert.equal(
		canFlushQueuedInput({
			sessionReady: sessionReady(state),
			running: state.running,
			queuePaused: state.queuePaused,
			queueLength: state.queue.length,
			lastTurnTerminal: state.lastTurnTerminal
		}),
		true,
		'boot buffer must flush once Attached without waiting for turn_finished'
	);
});

test('unix continue race: early meta + EnsureProject yields Attach before any user input', () => {
	const opts = {
		cwd: '/tmp/project',
		clientId: 'ink-1',
		sessionConfig: {mode: 'continue' as const},
		displayName: 'project'
	};
	let boot = emptyUnixBootstrap();
	boot = stepUnixBootstrap(boot, {
		type: 'ready',
		protocolVersion: 2,
		sessionId: 'host-boot'
	}, opts).bootstrap;

	boot = stepUnixBootstrap(
		boot,
		{
			type: 'workspace_meta',
			tenantId: 'default',
			appId: 'default',
			projects: [
				{
					id: 'p1',
					projectType: 'coding',
					displayName: 'nano',
					status: 'active',
					isDefault: false
				}
			],
			sessionsByProjectId: {p1: []}
		},
		opts
	).bootstrap;

	const ensured = stepUnixBootstrap(
		boot,
		{
			type: 'command_result',
			name: 'EnsureProject',
			status: 'accepted',
			message: 'ok',
			projectId: 'p1'
		},
		opts
	);
	assert.ok(
		ensured.sends.some(c => c.type === 'CreateSession' && c.projectId === 'p1'),
		'empty early meta must CreateSession, not hang'
	);
});
