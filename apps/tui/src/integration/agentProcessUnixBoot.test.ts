/**
 * Non-PTY e2e: AgentProcess + mock-engine unix continue bootstrap.
 * Covers the early workspace_meta race that left cli-ink stuck in queue>
 * without sessionId (PTY e2eBootQueue is skipped when node-pty is unavailable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canFlushQueuedInput} from '@fast-ide/session-view';
import {AgentProcess} from '../rpc/AgentProcess.js';
import type {BridgeEvent} from '../rpc/protocol.js';
import {initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';

const mockEngine = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'scripts',
	'mock-engine.mjs'
);

const envKeys = [
	'FAST_BRIDGE_TRANSPORT',
	'FAST_ENGINE_COMMAND',
	'FAST_ENGINE_ARGS',
	'FAST_SIMULATE_UNIX_SESSION_BOOT',
	'FAST_MOCK_UNIX_BOOTSTRAP',
	'FAST_MOCK_UNIX_EARLY_META',
	'FAST_MOCK_UNIX_CREATE_DELAY_MS'
] as const;

function withEnv(patch: Record<string, string>, run: () => Promise<void>): Promise<void> {
	const prev = new Map<string, string | undefined>();
	for (const key of envKeys) {
		prev.set(key, process.env[key]);
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(patch)) {
		process.env[key] = value;
	}
	return run().finally(() => {
		for (const key of envKeys) {
			const value = prev.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

function sessionReady(state: UiState): boolean {
	return (
		state.ready &&
		Boolean(state.sessionId) &&
		state.inputMode !== 'exited' &&
		state.inputMode !== 'starting'
	);
}

async function waitFor(
	predicate: () => boolean,
	label: string,
	timeoutMs = 15_000
): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timeout waiting for ${label}`);
		}
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

async function bootUntilAttached(patch: Record<string, string>): Promise<{
	events: BridgeEvent[];
	state: UiState;
	agent: AgentProcess;
}> {
	const events: BridgeEvent[] = [];
	let state = initialState;
	const agent = new AgentProcess();
	const errors: string[] = [];

	await withEnv(
		{
			FAST_BRIDGE_TRANSPORT: 'stdio',
			FAST_ENGINE_COMMAND: process.execPath,
			FAST_ENGINE_ARGS: mockEngine,
			FAST_SIMULATE_UNIX_SESSION_BOOT: '1',
			FAST_MOCK_UNIX_BOOTSTRAP: '1',
			...patch
		},
		async () => {
			agent.start(
				{
					onEvent: event => {
						events.push(event);
						state = reducer(state, {type: 'engine_event', event});
					},
					onError: message => {
						errors.push(message);
					},
					onExit: () => undefined
				},
				{mode: 'continue'}
			);

			await waitFor(
				() => events.some(e => e.type === 'Attached'),
				`Attached (events=${events.map(e => e.type).join(',')}; errors=${errors.join('|')})`
			);
		}
	);

	return {events, state, agent};
}

test('e2e AgentProcess: early workspace_meta race still Attaches (no permanent queue)', async () => {
	const {events, state, agent} = await bootUntilAttached({
		FAST_MOCK_UNIX_EARLY_META: '1',
		FAST_MOCK_UNIX_CREATE_DELAY_MS: '120'
	});
	try {
		const ready = events.find(e => e.type === 'ready');
		assert.ok(ready && ready.type === 'ready');
		assert.equal(ready.sessionId, undefined, 'unix boot must strip host sessionId');

		assert.equal(state.sessionId, 'mock-sess-boot');
		assert.equal(sessionReady(state), true);

		const queued = reducer(state, {
			type: 'enqueue_input',
			input: {id: 'q1', text: '你是谁', state: 'queued'}
		});
		assert.equal(
			canFlushQueuedInput({
				sessionReady: sessionReady(queued),
				running: queued.running,
				queuePaused: queued.queuePaused,
				queueLength: queued.queue.length,
				lastTurnTerminal: queued.lastTurnTerminal
			}),
			true,
			'after Attach, boot queue must be flushable'
		);
	} finally {
		agent.stop();
	}
});

test('e2e AgentProcess: missing meta triggers GetWorkspaceMeta then Attach', async () => {
	const {events, state, agent} = await bootUntilAttached({
		FAST_MOCK_UNIX_CREATE_DELAY_MS: '50'
	});
	try {
		assert.ok(events.some(e => e.type === 'Attached'));
		assert.equal(state.sessionId, 'mock-sess-boot');
		assert.equal(sessionReady(state), true);
	} finally {
		agent.stop();
	}
});
