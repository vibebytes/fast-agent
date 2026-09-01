import test from 'node:test';
import assert from 'node:assert/strict';
import {quickActionAvailability, routeSlashCommand} from './router.js';
import {initialState, type UiState} from '../state/model.js';

const failedState = {
	...initialState,
	transcript: {
		...initialState.transcript,
		entries: [
			{id: 'a0', role: 'assistant' as const, text: 'ok', status: 'done' as const, turnId: 't0'},
			{
				id: 'assistant-cm1',
				role: 'assistant' as const,
				text: 'boom',
				status: 'error' as const,
				turnId: 'run-9'
			}
		]
	},
	lastFailure: {runId: 'run-9', acceptedTurns: 2}
} as unknown as UiState;

test('quickActionAvailability is idle-only and mirrors rerun/continue gates', () => {
	assert.deepEqual(quickActionAvailability(initialState), {
		retryRunId: null,
		continueReady: false
	});
	assert.deepEqual(quickActionAvailability(failedState), {
		retryRunId: 'run-9',
		continueReady: true
	});
	const busy = {...failedState, running: true};
	assert.deepEqual(quickActionAvailability(busy), {retryRunId: null, continueReady: false});
	const firstTurnOnly = {...failedState, lastFailure: {runId: 'run-9', acceptedTurns: 0}};
	assert.equal(quickActionAvailability(firstTurnOnly).continueReady, false);
});

test('quickActionAvailability grays out when a later terminal supersedes the failure', () => {
	const recovered = {
		...failedState,
		transcript: {
			...failedState.transcript,
			entries: [
				...(failedState.transcript.entries as Array<Record<string, unknown>>),
				{id: 'u2', role: 'user', text: 'again', status: 'done', turnId: 't3'},
				{id: 'assistant-cm2', role: 'assistant', text: 'fine', status: 'done', turnId: 'run-10'}
			]
		}
	} as unknown as UiState;
	assert.deepEqual(quickActionAvailability(recovered), {retryRunId: null, continueReady: false});
});

test('routeSlashCommand handles quit aliases', () => {
	assert.equal(routeSlashCommand('/exit', initialState)?.kind, 'quit');
	assert.equal(routeSlashCommand('/quit', initialState)?.kind, 'quit');
});

test('routeSlashCommand retries last user message locally', () => {
	const state = {
		...initialState,
		transcript: {
			...initialState.transcript,
			entries: [
				{id: 'u1', role: 'user' as const, text: 'hello world', status: 'done' as const, turnId: 't1'},
				{id: 'a1', role: 'assistant' as const, text: 'hi', status: 'done' as const, turnId: 't1'}
			]
		}
	};
	const routed = routeSlashCommand('/retry', state);
	assert.equal(routed?.kind, 'retry');
	if (routed?.kind === 'retry') {
		assert.equal(routed.lastUserText, 'hello world');
	}
});

test('routeSlashCommand rerun targets the engine run id and supports the r alias', () => {
	for (const input of ['/rerun', '/r']) {
		const routed = routeSlashCommand(input, failedState);
		assert.equal(routed?.kind, 'rerun', input);
		if (routed?.kind === 'rerun') assert.equal(routed.runId, 'run-9');
	}
	assert.equal(routeSlashCommand('/rerun', initialState)?.kind, 'ui');
	// Without an observed run_failed there is no valid engine target.
	const unobserved = {...failedState, lastFailure: null} as unknown as UiState;
	const blocked = routeSlashCommand('/rerun', unobserved);
	assert.equal(blocked?.kind, 'blocked');
});

test('routeSlashCommand continue requires a failed run with accepted turns', () => {
	assert.equal(routeSlashCommand('/continue', initialState)?.kind, 'blocked');

	const failedFirstTurn = {
		...initialState,
		transcript: {
			...initialState.transcript,
			entries: [
				{
					id: 'assistant-cm1',
					role: 'assistant' as const,
					text: 'boom',
					status: 'error' as const,
					turnId: 'run-1'
				}
			]
		},
		lastFailure: {runId: 'run-1', acceptedTurns: 0}
	} as unknown as UiState;
	const blocked = routeSlashCommand('/continue', failedFirstTurn);
	assert.equal(blocked?.kind, 'blocked');
	if (blocked?.kind === 'blocked') assert.match(blocked.reason, /rerun/);

	const continued = {
		...failedFirstTurn,
		lastFailure: {runId: 'run-1', acceptedTurns: 2}
	} as unknown as UiState;
	assert.equal(routeSlashCommand('/continue', continued)?.kind, 'continue');

	const staleFailure = {
		...continued,
		lastFailure: {runId: 'other', acceptedTurns: 2}
	} as unknown as UiState;
	assert.equal(routeSlashCommand('/continue', staleFailure)?.kind, 'blocked');
});

test('routeSlashCommand routes undo as hybrid', () => {
	const routed = routeSlashCommand('/undo', initialState);
	assert.equal(routed?.kind, 'hybrid');
	if (routed?.kind === 'hybrid') {
		assert.equal(routed.name, 'undo');
		assert.equal(routed.uiUndo, true);
	}
});

test('routeSlashCommand routes clear as hybrid with ui clear', () => {
	const routed = routeSlashCommand('/clear', initialState);
	assert.equal(routed?.kind, 'hybrid');
	if (routed?.kind === 'hybrid') {
		assert.equal(routed.name, 'clear');
		assert.equal(routed.uiClear, true);
	}
});

test('routeSlashCommand routes help as ui-only', () => {
	const routed = routeSlashCommand('/help', initialState);
	assert.equal(routed?.kind, 'ui');
	if (routed?.kind === 'ui') {
		assert.equal(routed.spec.name, 'help');
	}
});

test('routeSlashCommand toggles debug panel based on current visibility', () => {
	const off = routeSlashCommand('/debug', initialState);
	assert.equal(off?.kind, 'hybrid');
	if (off?.kind === 'hybrid') {
		assert.equal(off.name, 'debug');
		assert.equal(off.args, 'on');
		assert.equal(off.uiDebug, true);
	}

	const on = routeSlashCommand('/debug', {...initialState, debugVisible: true});
	assert.equal(on?.kind === 'hybrid' ? on.args : '', 'off');
});

test('routeSlashCommand routes engine commands', () => {
	const routed = routeSlashCommand('/model gpt-4', initialState);
	assert.equal(routed?.kind, 'engine');
	if (routed?.kind === 'engine') {
		assert.equal(routed.name, 'model');
		assert.equal(routed.args, 'gpt-4');
	}
});

test('routeSlashCommand forwards catalog skills as skillCandidate for SkillSlash', () => {
	const state = {
		...initialState,
		commands: [{name: 'explain-code', description: 'Explain', usage: '/explain-code', available: true}]
	};
	const routed = routeSlashCommand('/explain-code', state);
	assert.equal(routed?.kind, 'skillCandidate');
	if (routed?.kind === 'skillCandidate') {
		assert.equal(routed.name, 'explain-code');
		assert.equal(routed.args, '');
	}
});

test('routeSlashCommand treats unknown /xxx as ordinary message (undefined)', () => {
	assert.equal(routeSlashCommand('/not-a-real-skill', initialState), undefined);
});

test('routeSlashCommand routes cancel run command with args', () => {
	const routed = routeSlashCommand('/cancel run-123', initialState);
	assert.equal(routed?.kind, 'engine');
	if (routed?.kind === 'engine') {
		assert.equal(routed.name, 'cancel');
		assert.equal(routed.args, 'run-123');
	}
});

test('routeSlashCommand opens session browser for bare /resume', () => {
	const routed = routeSlashCommand('/resume', initialState);
	assert.equal(routed?.kind, 'hybrid');
	if (routed?.kind === 'hybrid') {
		assert.equal(routed.name, 'resume');
		assert.equal(routed.uiSessionBrowser, true);
	}
});

test('routeSlashCommand routes /resume with session id to hybrid engine command', () => {
	const routed = routeSlashCommand('/resume abc123', initialState);
	assert.equal(routed?.kind, 'hybrid');
	if (routed?.kind === 'hybrid') {
		assert.equal(routed.name, 'resume');
		assert.equal(routed.args, 'abc123');
	}
});
