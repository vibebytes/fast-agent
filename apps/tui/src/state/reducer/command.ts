/** reducer.test — applyEvent command_result. Loaded by reducer.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromeAwaitingSettlement} from '@fast-ide/session-view';
import {initialState} from '../model.js';
import {reducer} from '../reducer.js';
import {cancelledRunState} from './kit.js';
import {turnsToTimeline} from '../timeline/turnAdapter.js';
import {
	userEntries,
	assistantEntries,
	lastAssistant,
	lastUser,
	entryStatus,
	bridgeTurnCount,
	assistantText,
	userText,
	thinking,
	tools,
	segments,
	localSystemMessages,
	lastLocalTurn,
	approvalsFromState,
	questionsFromState
} from '../../test-utils/transcriptAssert.js';

test('reducer records command metadata from engine', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {
			type: 'commands_available',
			commands: [{name: 'model', description: 'Show model', usage: '/model', available: true}]
		}
	});

	assert.equal(state.commands.length, 1);
	assert.equal(state.commands[0]?.name, 'model');
});

test('reducer records command result as structured system message', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/model', clientMessageId: 'command_turn_1'});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'model', message: 'Current model: default', status: 'success'}
	});
	const turn = lastLocalTurn(state);
	const message = turn?.systemMessages[0];

	assert.equal(turn?.userText, '/model');
	assert.equal(message?.kind, 'command_result');
	assert.equal(message?.commandName, 'model');
	assert.equal(message?.commandStatus, 'success');
	assert.equal(message?.text, 'Current model: default');
});

test('next submit collapses prior multi-line command_result menus', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/sessions', clientMessageId: 'sessions_1'});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'sessions',
			message: 'Sessions (2)\n───\n  abc\n  def',
			status: 'success'
		}
	});
	assert.equal(lastLocalTurn(state)?.systemMessages[0]?.collapsed, undefined);

	state = reducer(state, {type: 'submit_command', text: '/help', clientMessageId: 'help_1'});
	const sessionsMsg = state.localTurns.find(t => t.userText === '/sessions')?.systemMessages[0];
	assert.equal(sessionsMsg?.collapsed, true, 'multi-line menu folds after next command');

	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'help', message: 'Commands', status: 'success'}
	});
	assert.equal(lastLocalTurn(state)?.systemMessages[0]?.collapsed, undefined, 'new card stays open');
});

test('collapse_command_menus folds open menus without adding a turn', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/sessions', clientMessageId: 'sessions_2'});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'sessions',
			message: 'Sessions (1)\n───\n  abc',
			status: 'success'
		}
	});
	state = reducer(state, {type: 'collapse_command_menus'});
	assert.equal(state.localTurns.length, 1);
	assert.equal(state.localTurns[0]?.systemMessages[0]?.collapsed, true);
});

test('peer turn_started folds open multi-line command menus', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/sessions', clientMessageId: 'sessions_peer'});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'sessions',
			message: 'Sessions (1)\n───\n  abc',
			status: 'success'
		}
	});
	assert.equal(state.localTurns[0]?.systemMessages[0]?.collapsed, undefined);

	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'turn_started',
			turnId: 'ide_turn',
			clientMessageId: 'ide_turn',
			text: 'Use the skill pptx'
		}
	});
	assert.equal(state.running, true);
	assert.equal(state.localTurns[0]?.systemMessages[0]?.collapsed, true, 'IDE peer turn folds open menus');
});

test('host protocol command_result (EnsureProject) never becomes a transcript card', () => {
	let state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'EnsureProject', message: 'reused', status: 'accepted'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'BindSessionWorkspace', message: 'c0269c7aea94', status: 'accepted'}
	});
	assert.equal(state.localTurns.length, 0);
	assert.ok(state.debugEvents.some(e => e.includes('EnsureProject')));
	assert.ok(state.debugEvents.some(e => e.includes('BindSessionWorkspace')));
});

test('skills command_result renders a chronological local card', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/skills', clientMessageId: 'skills_card'});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'skills', message: 'Skills (1)\n───\n  pptx', status: 'success'}
	});
	assert.equal(state.localTurns.length, 1);
	assert.equal(state.localTurns[0]?.systemMessages[0]?.commandName, 'skills');
	assert.equal(typeof state.localTurns[0]?.streamSeq, 'number');
});

test('reducer never renders DecideApproval command_result as a transcript card', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'DecideApproval', message: 'status=Running', status: 'decided'}
	});

	assert.equal(state.localTurns.length, 0, 'ACK routed to approval state machine, not localTurns');
});

test('reducer swallows SubmitUserMessage steered ACK without a transcript card', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'SubmitUserMessage',
			message: 's:c2',
			status: 'steered',
			sessionId: 's'
		}
	});

	assert.equal(state.localTurns.length, 0);
	assert.equal(state.status, 'steered');
	assert.notEqual(state.inputMode, 'queued');
});

test('reducer swallows SubmitUserMessage queued ACK without a transcript card', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'SubmitUserMessage',
			message: 'followUpId=019fb96c-ddcc-73f4-b2f0-5d6ea15e8ccf',
			status: 'queued',
			sessionId: '019fb8f8-cd2e-7b28-a49e-0cab91e4e3b2'
		}
	});

	assert.equal(state.localTurns.length, 0);
	assert.equal(state.status, 'queued');
	assert.equal(state.inputMode, 'queued');
});

test('reducer treats route statuses as success segment (not failed)', () => {
	const routeStatuses = ['decided', 'answered', 'accepted', 'triggered', 'resumed'] as const;
	for (const status of routeStatuses) {
		let state = reducer(initialState, {type: 'submit_command', text: `/test-${status}`, clientMessageId: `cmd_${status}`});
		state = reducer(state, {
			type: 'engine_event',
			event: {type: 'command_result', name: 'test-command', message: `result: ${status}`, status}
		});
		const turnSegments = lastLocalTurn(state)?.segments ?? [];
		const systemSegment = turnSegments.find(s => s.kind === 'system');
		assert.ok(systemSegment, `system segment should exist for status: ${status}`);
	}
});

test('reducer treats error command_result as failed segment', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/broken', clientMessageId: 'cmd_err'});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'command_result', name: 'broken', message: 'crash', status: 'error'}
	});

	const turnSegments = lastLocalTurn(state)?.segments ?? [];
	const systemSegment = turnSegments.find(s => s.kind === 'system');
	assert.ok(systemSegment, 'system segment should exist for error status');
});

test('reducer updates model from engine command event', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'model_changed', model: 'gpt-4o', modelDisplay: 'gpt-4o -> openai/gpt-4o'}
	});

	assert.equal(state.model, 'gpt-4o');
	assert.equal(state.modelDisplay, 'gpt-4o -> openai/gpt-4o');
	assert.equal(state.status, 'model gpt-4o -> openai/gpt-4o');
});

test('mode ack command_result updates agentMode for the footer badge', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'command_result', name: 'yolo', message: 'Mode -> yolo'}});
	assert.equal(state.agentMode, 'yolo');

	state = reducer(state, {type: 'engine_event', event: {type: 'command_result', name: 'exit-plan', message: 'Mode -> normal'}});
	assert.equal(state.agentMode, 'normal');

	// A failed mode change must not flip the badge.
	state = reducer(state, {type: 'engine_event', event: {type: 'command_result', name: 'yolo', message: 'Mode -> yolo', status: 'error'}});
	assert.equal(state.agentMode, 'normal');
});

test('identical consecutive command_result cards are dropped', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'sessions', message: 'No sessions found.', status: 'success'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'sessions', message: 'No sessions found.', status: 'success'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'sessions', message: 'No sessions found.', status: 'success'
	}});

	let cards = localSystemMessages(state).filter(message => message.kind === 'command_result');
	assert.equal(cards.length, 1, 'duplicates collapsed into the first card');

	// A different message is NOT a duplicate and must still append.
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'sessions', message: '1 active session', status: 'success'
	}});
	cards = localSystemMessages(state).filter(message => message.kind === 'command_result');
	assert.equal(cards.length, 2);
});

// --- Agent call (subagent) events ---

test('repeated CancelRun host ACKs never spawn transcript cards', () => {
	let state = cancelledRunState();
	const cancelCard = {type: 'command_result', name: 'CancelRun', message: 'status=Cancelled', status: 'cancelled'} as const;

	state = reducer(state, {type: 'engine_event', event: cancelCard});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: 'contents.'}});
	state = reducer(state, {type: 'engine_event', event: cancelCard});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: 'input).'}});
	state = reducer(state, {type: 'engine_event', event: cancelCard});

	const cards = localSystemMessages(state).filter(message => message.kind === 'command_result');
	assert.equal(cards.length, 0, 'CancelRun is host protocol — log-only, no transcript cards');
	assert.ok(state.debugEvents.some(e => e.includes('CancelRun')));
});

test('host command_result mid-run does not settle the running turn', () => {
	// A CancelRun ACK arrives while the turn is still streaming; it must not
	// flip the turn to success or the later run_cancelled loses cancel state.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'command_result', name: 'CancelRun', message: 'status=Cancelled', status: 'cancelled'}});

	assert.equal(entryStatus(lastAssistant(state)), 'running', 'running turn must survive a host protocol ACK');
	assert.equal(state.localTurns.length, 0, 'CancelRun must not append a local card');

	state = reducer(state, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run-1', reason: 'user stop'}});
	assert.equal(lastAssistant(state)?.status, 'cancelled');
});
