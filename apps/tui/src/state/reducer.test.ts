import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {initialState} from './model.js';
import {reducer} from './reducer.js';
import {turnsToTimeline} from './timeline/turnAdapter.js';
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
} from '../test-utils/transcriptAssert.js';

test('reducer appends user and streaming assistant messages', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'hi '}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'there'}});

	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'hello');
	assert.equal(assistantText(state), 'hi there');
});

test('reducer captures llm_request snapshots', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'llm_request',
		turnId: 'turn_1',
		turn: 1,
		messages: [
			{role: 'system', content: 'you are an agent'},
			{role: 'user', content: 'hello'}
		]
	}});

	assert.equal(state.llmRequests.length, 1);
	assert.equal(state.llmRequests[0]?.messages.length, 2);
	assert.equal(state.llmRequests[0]?.turn, 1);
});

test('toggle_debug flips visibility and clears url when hidden', () => {
	let state = reducer(initialState, {type: 'toggle_debug'});
	assert.equal(state.debugVisible, true);
	state = reducer(state, {type: 'set_debug_url', url: 'http://127.0.0.1:1234/'});
	assert.equal(state.debugUrl, 'http://127.0.0.1:1234/');
	state = reducer(state, {type: 'toggle_debug', visible: false});
	assert.equal(state.debugVisible, false);
	assert.equal(state.debugUrl, undefined);
});

test('reducer records interleaved segments in arrival order', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'build it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_1', text: 'planning'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_2', tool: 'shell', args: {command: 'cat x'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'done'}});

	const segs = segments(state);
	assert.deepEqual(segs.map(segment => segment.kind), ['thinking', 'tools', 'assistant']);
	const toolsSegment = segs.find(segment => segment.kind === 'tools');
	assert.equal(toolsSegment?.kind === 'tools' ? toolsSegment.toolIds.length : 0, 2);
});

// NB: clarify's system message now lands on `localTurns` (never on the Bridge
// transcript entry's segments — `EntrySegment` has no 'system' kind), so the
// old "assistant text then system message in the same turn" ordering test no
// longer applies; see the clarify-specific tests below instead.

test('reducer cycles thinking display mode', () => {
	let state = reducer(initialState, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'full');
	state = reducer(state, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'off');
	state = reducer(state, {type: 'cycle_thinking_display'});
	assert.equal(state.thinkingDisplay, 'compact');
});

test('reducer toggles file expansion via global toolsExpanded', () => {
	// Bridge file_read is a tool on the transcript entry now; there is no
	// per-file `expanded` flag — Ctrl+O / toggle_file flips `toolsExpanded`.
	let state = reducer(initialState, {type: 'submit_user', text: 'read file', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'file_read', turnId: 'turn_1', path: 'snake.py', language: 'python', content: 'print(1)'}
	});
	state = reducer(state, {type: 'toggle_file'});

	assert.equal(state.toolsExpanded, true);
	assert.equal(tools(state)[0]?.tool, 'file_read');
});

test('reducer toggles tool detail expansion via toolsExpanded', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run tool', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'tool_started',
			turnId: 'turn_1',
			id: 'tool_1',
			tool: 'shell',
			args: {command: 'echo hi'}
		}
	});
	state = reducer(state, {type: 'toggle_tool_detail'});
	assert.equal(state.toolsExpanded, true);

	// 再次调用应该全部折叠
	state = reducer(state, {type: 'toggle_tool_detail'});
	assert.equal(state.toolsExpanded, false);
});

test('reducer records ready metadata and clears UI state', () => {
	let state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'ready', model: 'default', modelDisplay: 'default -> deepseek-reasoner', maxTurns: 12, standalone: true, cwd: '/tmp/agent', mode: 'bridge'}
	});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'clear'});

	assert.equal(state.ready, true);
	assert.equal(state.model, 'default');
	assert.equal(state.modelDisplay, 'default -> deepseek-reasoner');
	assert.equal(state.maxTurns, 12);
	assert.equal(state.cwd, '/tmp/agent');
	assert.equal(state.transcript.entries.length, 0);
});

test('reducer tracks queued inputs', () => {
	let state = reducer(initialState, {type: 'enqueue_input', input: {id: 'first', text: 'first', state: 'queued'}});
	state = reducer(state, {type: 'enqueue_input', input: {id: 'second', text: 'second', state: 'queued'}});
	state = reducer(state, {type: 'dequeue_input', id: 'first'});

	assert.equal(state.queue.length, 1);
	assert.deepEqual(state.queue.map(input => input.text), ['second']);
});

test('reducer retains mentions on queued inputs', () => {
	const mentions = [{kind: 'skill', locator: 'plan', ref: '@skill/plan', displayName: 'Plan'}];
	const state = reducer(initialState, {
		type: 'enqueue_input',
		input: {id: 'q1', text: 'use @skill/plan', state: 'queued', mentions}
	});
	assert.deepEqual(state.queue[0]?.mentions, mentions);
});

test('reducer folds clarify event into zero-option User Question', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'clarify', runId: 'run_1', turnId: 'turn_1', id: 'clarify_1', question: '需要补充什么？'}
	});

	assert.equal(state.status, 'question');
	assert.equal(state.inputMode, 'clarify');
	const questions = questionsFromState(state);
	assert.equal(questions.length, 1);
	assert.equal(questions[0]?.question, '需要补充什么？');
	assert.deepEqual(questions[0]?.options, []);
	assert.equal(state.errors.length, 0);
	assert.equal(localSystemMessages(state).at(-1)?.role, 'system');
	assert.equal(localSystemMessages(state).at(-1)?.text, '需要补充什么？');
});

test('reducer uses final answer when no stream delta exists', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: 'final'}});

	assert.equal(assistantText(state), 'final');
});

test('reducer ignores a full-answer AssistantDelta that re-emits already streamed text', () => {
	// Engine bug: native mode streams Content as AssistantDelta, then onFinalAnswer
	// used to emit the whole answer again as AssistantDelta before FinalAnswer —
	// which doubled the text and splitStableChunks painted two identical ✦ blocks.
	const answer = `当前工作目录：\n\n\`\`\`\n${join(homedir(), 'path')}\n\`\`\``;
	let state = reducer(initialState, {type: 'submit_user', text: 'pwd', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: answer}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(assistantText(state), answer);
	assert.equal(
		(assistantText(state).match(/当前工作目录/g) ?? []).length,
		1,
		'full answer must not be concatenated twice'
	);
	const assistants = turnsToTimeline(state).items.filter(item => item.kind === 'assistant_message');
	assert.equal(
		assistants.filter(item => item.text.includes('当前工作目录')).length,
		1,
		`expected one lead-in assistant block, got: ${JSON.stringify(assistants.map(a => a.text))}`
	);
});

test('AssistantMessage-seeded final_answer after deltas stays one assistant block', () => {
	const answer = '审查结论：计划可落地。';
	let state = reducer(initialState, {type: 'submit_user', text: 'review', clientMessageId: 'client_1'});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'assistant_delta', turnId: 'turn_1', text: answer}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'final_answer', turnId: 'turn_1', text: answer}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'turn_finished', turnId: 'turn_1', success: true}
	});
	assert.equal(assistantText(state), answer);
	const assistants = turnsToTimeline(state).items.filter(item => item.kind === 'assistant_message');
	assert.equal(assistants.filter(item => item.text.includes('审查结论')).length, 1);
});

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

test('input_rejected already-running keeps peer turn live without error banner', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'turn_started',
			turnId: 'ide_turn',
			clientMessageId: 'ide_turn',
			text: '/skill'
		}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'input_rejected',
			clientMessageId: 'ink_bounce',
			reason: 'A turn is already running'
		}
	});
	assert.equal(state.running, true);
	assert.equal(state.errors.length, 0);
	assert.equal(lastAssistant(state)?.status, 'streaming');
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

test('reducer tracks structured questions', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'create app', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'question_requested',
			runId: 'run_1',
			turnId: 'turn_1',
			id: 'question_1',
			title: 'Location',
			question: 'Where?',
			options: [{id: 'here', label: 'Here'}],
			allowCustom: true
		}
	});

	assert.equal(state.inputMode, 'question');
	let questions = questionsFromState(state);
	assert.equal(questions.length, 1);
	assert.equal(questions[0]?.runId, 'run_1');
	assert.equal(questions[0]?.options[0]?.id, 'here');

	state = reducer(state, {type: 'engine_event', event: {type: 'question_answered', id: 'question_1'}});
	questions = questionsFromState(state);
	assert.equal(questions.length, 0);
});

test('local cancel blocks late deltas from mutating cancelled turn', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'late'}});

	assert.equal(lastAssistant(state)?.status, 'cancelled');
	assert.equal(assistantText(state), '');
	assert.equal(state.orphanEvents.at(-1), 'turn_1');
});

test('turn_cancelled after local cancel restores normal input mode', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});

	// Cancel Settlement: Composer unlocks on turn_cancelled, not run_cancelled.
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_cancelled', reason: 'cancelled by user'}});

	assert.equal(state.running, false);
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(state.inputMode, 'normal');
	assert.equal(lastAssistant(state)?.status, 'cancelled');
});

test('force_cancel_settlement unlocks when turn_cancelled never arrives', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'local_cancel'});
	assert.equal(state.transcript.awaitingCancelSettlement, true);
	assert.equal(state.running, true);

	state = reducer(state, {type: 'force_cancel_settlement', reason: 'client settlement timeout'});
	assert.equal(state.transcript.awaitingCancelSettlement, false);
	assert.equal(state.running, false);
	assert.equal(state.lastTurnTerminal, 'cancelled');
	assert.equal(state.queuePaused, true);
	assert.equal(state.inputMode, 'normal');
});

test('force_cancel_settlement is a no-op when not awaiting settlement', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	const next = reducer(state, {type: 'force_cancel_settlement'});
	assert.equal(next, state);
});

test('reducer restores session history from session_restored event', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'fix bug',
			assistantText: 'done',
			thinking: 'planning',
			tools: [{id: 'tool_1', tool: 'shell', args: {command: 'ls'}, status: 'success', summary: 'ok'}],
			tokensUsed: 10
		}]
	}});

	assert.equal(state.sessionId, 'sess-1');
	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'fix bug');
	assert.equal(thinking(state), 'planning');
	assert.equal(tools(state)[0]?.tool, 'shell');
	assert.equal(state.running, false);
	// Legacy crush shape still builds chronological segments
	assert.deepEqual(
		segments(state).map(s => s.kind),
		['thinking', 'tools', 'assistant']
	);
});

test('reducer restores chronological segments from session_restored steps', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'research',
			assistantText: 'done',
			thinking: 'first\nsecond',
			tools: [
				{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'},
				{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}
			],
			steps: [
				{
					reasoning: 'first',
					tools: [{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}],
					text: 'looking'
				},
				{
					reasoning: 'second',
					tools: [{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
					text: 'done'
				}
			]
		}]
	}});

	assert.equal(bridgeTurnCount(state), 1);
	const segs = segments(state);
	assert.deepEqual(
		segs.map(s => s.kind),
		['thinking', 'tools', 'assistant', 'thinking', 'tools', 'assistant']
	);
	const thinkingSegs = segs.filter(s => s.kind === 'thinking');
	assert.equal(thinkingSegs[0] && thinkingSegs[0].kind === 'thinking' ? thinkingSegs[0].text : '', 'first');
	assert.equal(thinkingSegs[1] && thinkingSegs[1].kind === 'thinking' ? thinkingSegs[1].text : '', 'second');
});

test('reducer restores preamble before tools when textBeforeTools is set', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'look',
			assistantText: '我先列目录',
			tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
			steps: [{
				text: '我先列目录',
				textBeforeTools: true,
				tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}]
			}]
		}]
	}});

	assert.deepEqual(
		segments(state).map(s => s.kind),
		['assistant', 'tools']
	);
	assert.equal(assistantText(state), '我先列目录');
});

test('reducer stores sessions_list payload', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'sessions_list',
		sessions: [{
			id: 'sess-1',
			title: 'Auth work',
			summary: 'OAuth fixes',
			lastModified: '2026-06-09T08:00:00Z',
			messageCount: 6,
			cwd: '/tmp/project',
			isCurrent: true
		}]
	}});

	assert.equal(state.sessions.length, 1);
	assert.equal(state.sessions[0]?.title, 'Auth work');
});

test('race: local cancel + clear ignores late assistant/tool events', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'long running', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'partial'}});

	state = reducer(state, {type: 'local_cancel'});
	state = reducer(state, {type: 'clear'});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'late'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_output', turnId: 'turn_1', id: 'tool_late', tool: 'shell', stream: 'stdout', text: 'late tool output'}
	});

	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.orphanEvents.at(-1), 'turn_1');
	assert.equal(state.errors.length, 0);
});

test('race: clear and help toggle stay stable under late turn_finished', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'toggle_help'});
	state = reducer(state, {type: 'clear'});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(state.helpVisible, false);
	assert.equal(state.transcript.entries.length, 0, 'late turn_finished must not resurrect a cleared turn');
});

test('submit_user immediately enters running/thinking state before any engine event', () => {
	// Guards the "thinking 过程没有了" regression: the optimistic local turn must
	// flip the UI into a running state the instant the user submits, even if the
	// engine is slow to ack (or stalls entirely on the backend route).
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});

	assert.equal(state.running, true);
	assert.equal(state.inputMode, 'running');
	assert.equal(bridgeTurnCount(state), 1);
	assert.equal(userText(state), 'hello');
	assert.equal(entryStatus(lastUser(state)), 'pending');
});

test('optimistic bridge sequence (input_accepted -> turn_started -> thinking_started) keeps a single running turn with thinking progress', () => {
	// Mirrors the exact optimistic events the Scala bridge now emits synchronously
	// in handleUserMessage, before the sharded SessionEntity.Route reply arrives.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_started', turnId: 'turn_1', clientMessageId: 'client_1', text: 'go'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'thinking_started', turnId: 'turn_1', turn: 1, maxTurns: 50}});

	assert.equal(state.running, true);
	assert.equal(state.status, 'thinking 1/50');
	assert.equal(bridgeTurnCount(state), 1, 'optimistic local turn must reconcile with the engine turn id, not duplicate');
	assert.equal(lastAssistant(state)?.turnId, 'turn_1');
	assert.equal(entryStatus(lastAssistant(state)), 'running');
});

test('input_rejected stops running and marks the originating turn failed', () => {
	// The bridge rejects concurrent submissions ("A turn is already running"); the
	// UI must leave the running state instead of spinning a phantom thinking block.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_rejected', clientMessageId: 'client_1', reason: 'A turn is already running'}});

	assert.equal(state.running, false);
	assert.equal(state.status, 'rejected');
	assert.equal(entryStatus(lastAssistant(state)), 'failed');
	assert.equal(state.errors.at(-1), 'A turn is already running');
});

test('run lifecycle events drive status and surface failures', () => {
	let done = reducer(initialState, {type: 'engine_event', event: {type: 'run_done', runId: 'run_1', success: true, summary: 'ok'}});
	assert.equal(done.status, 'run done');

	let failed = reducer(initialState, {type: 'engine_event', event: {type: 'run_failed', runId: 'run_1', error: 'boom'}});
	assert.equal(failed.status, 'run failed');
	assert.equal(failed.errors.at(-1), 'boom');
	assert.deepEqual(failed.lastFailure, {runId: 'run_1', acceptedTurns: null});

	const failedWithFault = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'run_failed', runId: 'run_2', error: 'boom', fault: {kind: 'engine_error', remedy: 'retry the run', acceptedTurns: 2}}
	});
	assert.deepEqual(failedWithFault.lastFailure, {runId: 'run_2', acceptedTurns: 2});

	// A later successful run clears the stale failure so /continue cannot target it.
	const recovered = reducer(failedWithFault, {type: 'engine_event', event: {type: 'run_done', runId: 'run_3', success: true, summary: 'ok'}});
	assert.equal(recovered.lastFailure, null);

	let cancelled = reducer(initialState, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run_1', reason: 'user stop'}});
	assert.equal(cancelled.status, 'run cancelled: user stop');
});

test('run lifecycle events clear approvals and questions for that run', () => {
	let state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'approval_requested', id: 'app_1', runId: 'run_1', tool: 'shell', description: 'test', risk: 'high', context: 'test'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'question_requested', id: 'q_1', runId: 'run_1', question: 'test', options: [], allowCustom: true}
	});
	assert.equal(approvalsFromState(state).length, 1);
	assert.equal(questionsFromState(state).length, 1);
	assert.equal(state.inputMode, 'question');

	// run_done should clear them
	let stateDone = reducer(state, {type: 'engine_event', event: {type: 'run_done', runId: 'run_1', success: true, summary: 'ok'}});
	assert.equal(approvalsFromState(stateDone).length, 0);
	assert.equal(questionsFromState(stateDone).length, 0);
	assert.equal(stateDone.inputMode, 'normal');

	// run_failed should clear them
	let stateFailed = reducer(state, {type: 'engine_event', event: {type: 'run_failed', runId: 'run_1', error: 'boom'}});
	assert.equal(approvalsFromState(stateFailed).length, 0);
	assert.equal(questionsFromState(stateFailed).length, 0);
	assert.equal(stateFailed.inputMode, 'normal');

	// run_failed with structured fault surfaces kind + remedy in the system row
	const stateFault = reducer(state, {
		type: 'engine_event',
		event: {type: 'run_failed', runId: 'run_1', error: 'boom', fault: {kind: 'engine_error', remedy: 'retry the run'}}
	});
	const faultRow = stateFault.localTurns
		.flatMap(t => t.systemMessages)
		.find(m => m.id.startsWith('run_failed_'));
	assert.ok(faultRow?.text.includes('运行失败：engine_error（retry the run）'));
	assert.equal(faultRow?.detail, 'boom');

	// run_cancelled should clear them
	let stateCancelled = reducer(state, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run_1', reason: 'user stop'}});
	assert.equal(approvalsFromState(stateCancelled).length, 0);
	assert.equal(questionsFromState(stateCancelled).length, 0);
	assert.equal(stateCancelled.inputMode, 'normal');
});

test('protocol anomaly: out-of-order tool output before tool_started does not crash state', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_output', turnId: 'turn_1', id: 'tool_1', tool: 'shell', stream: 'stdout', text: 'out-of-order'}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'echo hello'}}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {exit: '0'}}
	});

	assert.equal(tools(state).length, 1);
	assert.equal(tools(state)[0]?.status, 'success');
	assert.equal(tools(state)[0]?.output, '', 'output that preceded tool_started is lost, not resurrected');
});

// ── Approval flow ─────────────────────────────────────────────────

test('approval_requested sets inputMode to approval and adds to approvals', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'approval_1', tool: 'shell', description: 'Run rm', risk: 'Shell', context: 'rm -rf node_modules'}
	});

	assert.equal(state.inputMode, 'approval');
	const approvals = approvalsFromState(state);
	assert.equal(approvals.length, 1);
	assert.equal(approvals[0]?.tool, 'shell');
	assert.equal(approvals[0]?.risk, 'Shell');
	assert.equal(approvals[0]?.context, 'rm -rf node_modules');
});

test('approval_resolved removes approval and restores inputMode', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run it', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'approval_1', tool: 'shell', description: 'Run rm', risk: 'Shell', context: 'rm -rf'}
	});
	assert.equal(state.inputMode, 'approval');

	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', turnId: 'turn_1', id: 'approval_1', approved: true}});
	assert.equal(approvalsFromState(state).length, 0);
	assert.equal(state.inputMode, 'running');
});

test('stacked approvals: second approval after first resolved', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'run', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'a1', tool: 'shell', description: 'cmd1', risk: 'Shell', context: 'ls'}
	});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', turnId: 'turn_1', id: 'a1', approved: true}});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'approval_requested', runId: 'run_1', turnId: 'turn_1', id: 'a2', tool: 'shell', description: 'cmd2', risk: 'Destructive', context: 'rm -rf'}
	});

	const approvals = approvalsFromState(state);
	assert.equal(approvals.length, 1);
	assert.equal(approvals[0]?.id, 'a2');
	assert.equal(state.inputMode, 'approval');
});

// ── Error / exit ──────────────────────────────────────────────────

test('mode ack command_result updates agentMode for the footer badge', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'command_result', name: 'yolo', message: 'Mode -> yolo'}});
	assert.equal(state.agentMode, 'yolo');

	state = reducer(state, {type: 'engine_event', event: {type: 'command_result', name: 'exit-plan', message: 'Mode -> normal'}});
	assert.equal(state.agentMode, 'normal');

	// A failed mode change must not flip the badge.
	state = reducer(state, {type: 'engine_event', event: {type: 'command_result', name: 'yolo', message: 'Mode -> yolo', status: 'error'}});
	assert.equal(state.agentMode, 'normal');
});

test('engine_exit sets inputMode to exited', () => {
	const state = reducer(initialState, {type: 'engine_exit', code: 1, signal: null});
	assert.equal(state.inputMode, 'exited');
	assert.equal(state.running, false);
	assert.match(state.status, /engine exited/);
});

test('engine_exit with signal', () => {
	const state = reducer(initialState, {type: 'engine_exit', code: null, signal: 'SIGTERM'});
	assert.equal(state.inputMode, 'exited');
	assert.match(state.status, /SIGTERM/);
});

test('error event appends to state.errors', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'error', message: 'first error'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'error', message: 'second error'}});

	assert.equal(state.errors.length, 2);
	assert.equal(state.errors[0], 'first error');
	assert.equal(state.errors[1], 'second error');
	assert.equal(state.status, 'error');
});

test('budget_exhausted event updates status', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'budget_exhausted', turnId: 'turn_1', turns: 12, tokens: 50000}
	});
	assert.match(state.status, /budget exhausted/);
	assert.match(state.status, /12/);
	assert.match(state.status, /50000/);
});

test('context_compressed event updates status', () => {
	const state = reducer(initialState, {
		type: 'engine_event',
		event: {type: 'context_compressed', turnId: 'turn_1', ratio: 0.65}
	});
	assert.match(state.status, /context compressed 65%/);
});

// ── Multi-turn ────────────────────────────────────────────────────

test('multi-turn: second turn after first completes', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});

	state = reducer(state, {type: 'submit_user', text: 'first', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'answer1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(state.running, false);
	assert.equal(bridgeTurnCount(state), 1);

	state = reducer(state, {type: 'submit_user', text: 'second', clientMessageId: 'client_2'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_2', turnId: 'turn_2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_2', text: 'answer2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_2', success: true}});

	assert.equal(bridgeTurnCount(state), 2);
	assert.equal(assistantText(state, 0), 'answer1');
	assert.equal(assistantText(state, 1), 'answer2');
	assert.equal(state.running, false);
});

// ── Undo ──────────────────────────────────────────────────────────

test('undo_last_exchange removes last turn', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'hi'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(bridgeTurnCount(state), 1);
	state = reducer(state, {type: 'undo_last_exchange'});
	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.status, 'undo');
});

// ── Heartbeat / Ack ───────────────────────────────────────────────

test('Heartbeat event updates status only', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {type: 'Heartbeat', sessionId: 'sess-1', atMillis: 123}});
	assert.equal(state.status, 'heartbeat');
	assert.equal(state.transcript.entries.length, 0);
});

test('Ack event updates status only', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {type: 'Ack', sessionId: 'sess-1', clientId: 'cli', lastEventSeq: 42}});
	assert.equal(state.status, 'ack 42');
	assert.equal(state.transcript.entries.length, 0);
});

// ── Agent / task lifecycle ────────────────────────────────────────

test('agent_final_answer sets assistantText when no stream delta exists', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'build', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'agent_final_answer', turnId: 'turn_1', text: 'agent done'}});

	assert.equal(assistantText(state), 'agent done');
});

test('task_done and task_failed drive status', () => {
	let done = reducer(initialState, {type: 'engine_event', event: {type: 'task_done', taskId: 'task_1', success: true, summary: 'ok'}});
	assert.equal(done.status, 'task done');

	let failed = reducer(initialState, {type: 'engine_event', event: {type: 'task_failed', taskId: 'task_1', error: 'boom'}});
	assert.equal(failed.status, 'task failed');
	assert.equal(failed.errors.at(-1), 'boom');
});

// ── Footer config ─────────────────────────────────────────────────

test('toggle_footer_item toggles individual footer items', () => {
	let state = reducer(initialState, {type: 'toggle_footer_item', id: 'model'});
	assert.equal(state.footerConfig.model, false);

	state = reducer(state, {type: 'toggle_footer_item', id: 'model'});
	assert.equal(state.footerConfig.model, true);
});

test('set_footer_config replaces entire config', () => {
	const config = {...initialState.footerConfig, model: false, cwd: false};
	const state = reducer(initialState, {type: 'set_footer_config', config});
	assert.equal(state.footerConfig.model, false);
	assert.equal(state.footerConfig.cwd, false);
	assert.equal(state.footerConfig.tokens, true);
});

// NB: the old "double input_accepted rewrites turn.id / serverTurnId" suite
// tested a `localTurns`-style Turn shape that no longer exists for Bridge
// content. The same remap invariants (entry id stays stable; deltas route via
// the server turnId) are now covered directly against TranscriptState in
// session-view's transcriptProjection.test.ts, against the timeline's
// append-only invariant in turnAdapter.test.ts ("double input_accepted does
// NOT break settled ID append-only invariant"), and against CancelRun
// targeting in runId.test.ts.

// ── Mid-run re-attach / session_restored races ────────────────────

test('session_restored mid-run keeps the in-flight turn', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: '继续构建', clientMessageId: 'client_live'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_live', turnId: 'turn_live'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_live', text: '思考中'}});

	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}]
	}});

	assert.equal(bridgeTurnCount(state), 2, 'restored history + live turn');
	assert.equal(assistantEntries(state)[0]?.turnId, 'restored_0');
	assert.equal(assistantEntries(state)[1]?.turnId, 'turn_live');
	assert.equal(assistantEntries(state)[1]?.status, 'streaming');
	assert.equal(state.running, true, 'run stays in flight across restore');
});

test('stray stream after restore never mutates a completed restored turn (dropped as orphan)', () => {
	// session-view drops homeless stream events when no entry is streaming —
	// unlike the old localTurns model, it never resurrects a "synthetic turn".
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}]
	}});

	// Mid-run re-attach replay: deltas arrive without any turn context.
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '接续'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '思考'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', id: 'tool_x', tool: 'shell', args: {command: 'ls'}}});

	assert.equal(assistantText(state), '旧回答', 'restored turn stays frozen');
	assert.equal(thinking(state), '', 'restored turn gains no thinking');
	assert.equal(tools(state).length, 0, 'restored turn gains no tools');
	assert.equal(bridgeTurnCount(state), 1, 'no ghost turn created for the homeless stream');
	assert.equal(state.orphanEvents.length, 3, 'all three stragglers are recorded as orphans, not resurrected');
});

test('tool_started stamps startedAt for the live elapsed display', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	const before = Date.now();
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'sleep 5'}}});

	const startedAt = tools(state)[0]?.startedAt;
	assert.ok(startedAt !== undefined && startedAt >= before && startedAt <= Date.now());
});

test('turn_finished resolves orphan running tools', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});

	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_2', tool: 'read_file', args: {path: 'a.txt'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {}}});

	assert.equal(tools(state)[0]?.status, 'success');
	assert.equal(tools(state)[1]?.status, 'running');

	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	assert.equal(tools(state)[0]?.status, 'success', 'already-finished tool stays success');
	assert.equal(tools(state)[1]?.status, 'success', 'orphan running tool resolved to success');
	assert.equal(state.running, false);
});

// --- Approval decision state machine ---

function stateWithApproval() {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'approval_requested', id: 'appr_1', runId: 'run_1', turnId: 'turn_1', tool: 'shell',
		description: 'Run command', risk: 'Shell', context: 'rm -rf x'
	}});
	return state;
}

test('approval_decision_sent records the in-flight decision on the approval', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});

	assert.deepEqual(approvalsFromState(state)[0]?.decision, {value: 'y', sentAt: 1000});
});

test('approval_decision_failed marks the decision failed', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'approval_decision_failed', id: 'appr_1', reason: '发送失败'});

	assert.equal(approvalsFromState(state)[0]?.decision?.failed, '发送失败');
});

test('command_result(DecideApproval) ACKs the in-flight decision without a transcript card', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	const localTurnsBefore = state.localTurns.length;
	const messagesBefore = localSystemMessages(state).length;

	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'status=Running;decision=applied', status: 'decided'
	}});

	assert.equal(approvalsFromState(state)[0]?.decision?.acked, true, 'decision acked');
	assert.equal(approvalsFromState(state)[0]?.decision?.failed, undefined, 'applied is not a failure');
	assert.equal(state.localTurns.length, localTurnsBefore, 'no new local turn');
	assert.equal(localSystemMessages(state).length, messagesBefore, 'no transcript card');
});

test('command_result(DecideApproval) with stale decision marks the approval failed', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'status=Failed;decision=stale', status: 'decided'
	}});

	assert.equal(approvalsFromState(state)[0]?.decision?.acked, true);
	assert.match(approvalsFromState(state)[0]?.decision?.failed ?? '', /stale/);
});

test('command_result(DecideApproval) error status carries the message as failure reason', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'DecideApproval', message: 'AskTimeoutException: recipient terminated', status: 'error'
	}});

	assert.match(approvalsFromState(state)[0]?.decision?.failed ?? '', /AskTimeoutException/);
});

test('approval_expired removes the approval and explains why in the transcript', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_expired', id: 'appr_1', reason: 'engine_restart'}});

	assert.equal(approvalsFromState(state).length, 0, 'expired approval dropped');
	assert.equal(state.inputMode, 'normal');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(notices.some(text => text.includes('审批已失效') && text.includes('引擎已重启')), 'expiry notice with reason');

	// Unknown id changes nothing but the debug log.
	const unchanged = reducer(state, {type: 'engine_event', event: {type: 'approval_expired', id: 'ghost', reason: 'engine_restart'}});
	assert.deepEqual(unchanged.transcript.approvals, state.transcript.approvals);
	assert.equal(unchanged.localTurns, state.localTurns);
});

test('approval_resolved clears the approval including its decision state', () => {
	let state = stateWithApproval();
	state = reducer(state, {type: 'approval_decision_sent', id: 'appr_1', value: 'y', at: 1000});
	state = reducer(state, {type: 'engine_event', event: {type: 'approval_resolved', id: 'appr_1', approved: true}});

	assert.equal(approvalsFromState(state).length, 0);
});

// --- Engine epoch (generation) handling ---

test('ready with a NEW engineEpoch clears pending interactions and explains why', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'approval_requested', id: 'appr_1', runId: 'run_1', turnId: 'turn_1', tool: 'shell', description: 'x', risk: 'Shell', context: 'rm x'
	}});
	state = reducer(state, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'which?'}});
	assert.equal(approvalsFromState(state).length, 1);
	assert.equal(questionsFromState(state).length, 1);

	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-2'}});

	assert.equal(state.engineEpoch, 'epoch-2');
	assert.equal(approvalsFromState(state).length, 0, 'stale approvals dropped');
	assert.equal(questionsFromState(state).length, 0, 'stale User Questions dropped');
	assert.equal(state.inputMode, 'normal');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(notices.some(text => text.includes('引擎已重启')), 'restart notice in transcript');
});

test('ready with the SAME engineEpoch (session switch) adds no restart notice', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'which?'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});

	assert.equal(questionsFromState(state).length, 1, 'same-epoch ready keeps User Questions');
	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(!notices.some(text => text.includes('引擎已重启')), 'no restart notice');
});

test('first ready never reports a restart even with pending state', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'clarify', runId: 'run_1', id: 'clarify_1', turnId: 'turn_1', question: 'early?'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'ready', engineEpoch: 'epoch-1'}});

	const notices = localSystemMessages(state).map(message => message.text);
	assert.ok(!notices.some(text => text.includes('引擎已重启')), 'first epoch observation is not a restart');
	assert.equal(state.engineEpoch, 'epoch-1');
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

test('agent_call_started creates an agent run entry', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'researcher', depth: 0
	}});
	assert.equal(state.agentRuns.length, 1);
	assert.equal(state.agentRuns[0]?.agentId, 'agent-1');
	assert.equal(state.agentRuns[0]?.name, 'researcher');
	assert.equal(state.agentRuns[0]?.status, 'running');
	assert.equal(state.agentRuns[0]?.toolCalls, 0);
});

test('agent_call_finished updates agent run status', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'coder', depth: 1
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: true, tokensUsed: 500, elapsedMs: 1200, toolCalls: 3
	}});
	assert.equal(state.agentRuns.length, 1);
	assert.equal(state.agentRuns[0]?.status, 'success');
	assert.equal(state.agentRuns[0]?.tokensUsed, 500);
	assert.equal(state.agentRuns[0]?.elapsedMs, 1200);
	assert.equal(state.agentRuns[0]?.toolCalls, 3);
});

test('agent_call_finished stores the failure detail so the ✗ row can explain itself', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'agentB_visual', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: false, elapsedMs: 6200, toolCalls: 1, runId: 'run-a',
		detail: 'cancelled: parent run cancelled'
	}});
	assert.equal(state.agentRuns[0]?.status, 'failed');
	assert.equal(state.agentRuns[0]?.detail, 'cancelled: parent run cancelled');
});

test('tool events with agentId track currentTool on agent run', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', turnId: 't1', id: 'tool-1', tool: 'shell', args: {command: 'ls'}, agentId: 'agent-1'
	}});
	// The running row shows WHAT is running, not just the tool name.
	assert.equal(state.agentRuns[0]?.currentTool, 'shell ls');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_finished', turnId: 't1', id: 'tool-1', tool: 'shell', success: true, fields: {}, agentId: 'agent-1'
	}});
	assert.equal(state.agentRuns[0]?.currentTool, undefined);
	assert.equal(state.agentRuns[0]?.toolCalls, 1);
});

// The regression behind the duplicated 风控员 rows: the same agent delegated
// several times shares one agentId, so run rows must be keyed by runId.
test('same agent called twice yields two rows and runId-scoped finish', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: '风控员', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: '风控员', depth: 0, runId: 'run-b'
	}});
	assert.equal(state.agentRuns.length, 2);

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: false, elapsedMs: 4900, toolCalls: 2, runId: 'run-a'
	}});
	assert.equal(state.agentRuns[0]?.status, 'failed');
	assert.equal(state.agentRuns[0]?.elapsedMs, 4900);
	// The second run of the same agent must be untouched.
	assert.equal(state.agentRuns[1]?.status, 'running');
	assert.equal(state.agentRuns[1]?.elapsedMs, undefined);
});

test('replayed agent_call_started for a known runId does not append a duplicate row', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	assert.equal(state.agentRuns.length, 1);
});

test('tool events with agentRunId only touch that run', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'worker', depth: 0, runId: 'run-b'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_finished', turnId: 't1', id: 'tool-1', tool: 'shell', success: true, fields: {}, agentId: 'agent-1', agentRunId: 'run-b'
	}});
	assert.equal(state.agentRuns[0]?.toolCalls, 0);
	assert.equal(state.agentRuns[1]?.toolCalls, 1);
});

test('events without agentId do not affect agent runs', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', turnId: 't1', id: 'tool-1', tool: 'read_file', args: {path: 'x.ts'}
	}});
	assert.equal(state.agentRuns.length, 0, 'no agent runs created for non-agent tool events');
	assert.equal(tools(state).length, 1, 'tool still added to the transcript entry');
});

test('run_done clears agentRuns', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 't1'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'worker', depth: 0
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'run_done', runId: 'run-1', success: true, summary: 'done'
	}});
	assert.equal(state.agentRuns.length, 0, 'agent runs cleared after run_done');
});

test('agent_call_finished stores the resultSummary shown under the ✓ row', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'agent-1', success: true, runId: 'run-a',
		resultSummary: '找到 3 处相关实现'
	}});
	assert.equal(state.agentRuns[0]?.resultSummary, '找到 3 处相关实现');
});

// Batch assignment keys the tree grouping + settle-as-a-unit rule.
test('concurrent top-level delegations share a batch; sequential ones do not', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	// run-b starts while run-a is still running → same batch (keyed by run-a).
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'reviewer', depth: 1, runId: 'run-b'
	}});
	assert.equal(state.agentRuns[0]?.batchId, undefined, 'first root keys the batch by its own runId');
	assert.equal(state.agentRuns[1]?.batchId, 'run-a');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a1', success: true, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a2', success: true, runId: 'run-b'
	}});
	// Sequential: everything terminal → the next delegation opens a NEW batch.
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a3', name: 'explorer', depth: 1, runId: 'run-c'
	}});
	assert.equal(state.agentRuns[2]?.batchId, undefined);
});

test('a nested delegation joins its parent run batch via parentRunId', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'sentiment', depth: 2, runId: 'run-nested', parentRunId: 'run-a'
	}});
	assert.equal(state.agentRuns[1]?.parentRunId, 'run-a');
	assert.equal(state.agentRuns[1]?.batchId, 'run-a', 'child inherits the parent batch, not a sibling one');
});

test('re-delegating a failed agent under the same parent is flagged as a retry', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-a'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'a1', success: false, runId: 'run-a', detail: 'boom'
	}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a1', name: 'researcher', depth: 1, runId: 'run-b'
	}});
	assert.equal(state.agentRuns[1]?.isRetry, true);

	// A different agent after the failure is NOT a retry.
	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'a2', name: 'reviewer', depth: 1, runId: 'run-c'
	}});
	assert.equal(state.agentRuns[2]?.isRetry, undefined);
});

test('out-of-order agent_call_finished tolerates unknown agentId', () => {
	let state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_call_finished', agentId: 'ghost', success: false
	}});
	assert.equal(state.agentRuns.length, 0, 'no crash on unknown agentId');
});

test('agent_timeline stores drill-down timeline keyed by agentId', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'agent_timeline',
		agentId: 'a1',
		parentAgentId: 'root',
		name: 'Researcher',
		turns: [{turnId: 't1', userText: 'analyze BTC', assistantText: 'BTC looks bullish'}],
		children: [{agentId: 'c1', name: 'Kline Analyst'}]
	}});
	const timeline = state.agentTimelines['a1'];
	assert.ok(timeline, 'timeline stored under agentId');
	assert.equal(timeline?.name, 'Researcher');
	assert.equal(timeline?.parentAgentId, 'root');
	assert.equal(timeline?.turns.length, 1);
	assert.equal(timeline?.turns[0]?.assistantText, 'BTC looks bullish');
	assert.equal(timeline?.children[0]?.name, 'Kline Analyst');
});

// --- agent view stack tests ---
test('agent_view_push/pop manages view stack', () => {
	let state = {...initialState};
	const entry = {agentId: 'a1', name: 'Researcher', siblings: [{agentId: 'a1', name: 'Researcher'}, {agentId: 'a2', name: 'Writer'}]};
	state = reducer(state, {type: 'agent_view_push', entry});
	assert.equal(state.agentViewStack.entries.length, 1);
	assert.equal(state.agentViewStack.entries[0]?.name, 'Researcher');

	const child = {agentId: 'c1', name: 'Sentiment', siblings: [{agentId: 'c1', name: 'Sentiment'}]};
	state = reducer(state, {type: 'agent_view_push', entry: child});
	assert.equal(state.agentViewStack.entries.length, 2);

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 1);
	assert.equal(state.agentViewStack.entries[0]?.name, 'Researcher');

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 0);

	state = reducer(state, {type: 'agent_view_pop'});
	assert.equal(state.agentViewStack.entries.length, 0, 'pop on empty stack is no-op');
});

// ── Cancel straggler storm (the /CancelRun screenshot regression) ──
//
// After the engine confirms run_cancelled, an in-flight LLM stream (old
// engines, replayed logs) can keep leaking reasoning/assistant/tool events —
// often with no turnId because the bridge already cleared its turn context.
// The UI is the last line of defense: stragglers must never resurface as
// ghost "Thought" turns interleaved with repeated CancelRun cards.

function cancelledRunState() {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'install libreoffice', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-1', text: 'installing…'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run-1', reason: 'cancelled'}});
	return state;
}

test('post-cancel stragglers without turnId never create ghost turns', () => {
	let state = cancelledRunState();
	const entriesBefore = state.transcript.entries.length;

	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: '·:'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', text: 'contents.'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-1-turn-27', text: 'ghost'}});

	assert.equal(state.transcript.entries.length, entriesBefore, 'stragglers must be orphaned, not resurrected as new entries');
	assert.equal(state.orphanEvents.length, 3);
});

test('post-cancel tool_started straggler never creates a ghost turn', () => {
	let state = cancelledRunState();
	const entriesBefore = state.transcript.entries.length;

	state = reducer(state, {type: 'engine_event', event: {
		type: 'tool_started', id: 'tc-ghost', tool: 'shell', args: {command: 'brew install'}
	}});

	assert.equal(state.transcript.entries.length, entriesBefore);
});

test('run_cancelled and run_failed clear live agent rows like run_done does', () => {
	let base = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	base = reducer(base, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	base = reducer(base, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	base = reducer(base, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-risk', name: '风控员', depth: 1, runId: 'run-r1'
	}});
	assert.equal(base.agentRuns.length, 1);

	const cancelled = reducer(base, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run-1', reason: 'user stop'}});
	assert.equal(cancelled.agentRuns.length, 0, 'cancelled run must not leave running agent rows behind');

	const failed = reducer(base, {type: 'engine_event', event: {type: 'run_failed', runId: 'run-1', error: 'boom'}});
	assert.equal(failed.agentRuns.length, 0, 'failed run must not leave running agent rows behind');
});

test('post-cancel agent_call_started straggler never adds an agent row', () => {
	let state = cancelledRunState();

	state = reducer(state, {type: 'engine_event', event: {
		type: 'agent_call_started', agentId: 'agent-risk', name: '风控员', depth: 1, runId: 'run-r9'
	}});

	assert.equal(state.agentRuns.length, 0);
});

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

test('straggler guard lifts once the next turn starts', () => {
	let state = cancelledRunState();
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', text: 'straggler'}});

	state = reducer(state, {type: 'submit_user', text: 'again', clientMessageId: 'c2'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c2', turnId: 'run-2'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-2', text: 'fresh thinking'}});

	assert.equal(lastAssistant(state)?.reasoning, 'fresh thinking');
});

test('mid-run re-attach: homeless stream events with no matching entry are dropped, not resurrected', () => {
	// No terminal run event seen in this process, and no entry to attach to:
	// session-view drops the event outright instead of creating a ghost turn.
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-live', text: 'attached mid-run'}});

	assert.equal(state.transcript.entries.length, 0);
	assert.equal(state.orphanEvents.at(-1), 'run-live');
});

// ── Defined-but-not-yet-called agents (Ctrl+G 提示语依据) ──────────

function runWithTool(tool: string, args: Record<string, string>, success = true) {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-1', tool, args}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-1', tool, success, fields: {}}});
	return state;
}

test('define_agent success registers the agent name as defined', () => {
	const state = runWithTool('define_agent', {name: '风控员', tools: '["read_file","grep"]'});
	assert.deepEqual(state.definedAgents, ['风控员']);
});

test('failed define_agent registers nothing', () => {
	const state = runWithTool('define_agent', {name: '风控员'}, false);
	assert.deepEqual(state.definedAgents, []);
});

test('delete_agent removes the name; duplicate defines never double-register', () => {
	let state = runWithTool('define_agent', {name: '风控员'});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-2', tool: 'define_agent', args: {name: '风控员'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-2', tool: 'define_agent', success: true, fields: {}}});
	assert.deepEqual(state.definedAgents, ['风控员']);

	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-3', tool: 'delete_agent', args: {name: '风控员'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-3', tool: 'delete_agent', success: true, fields: {}}});
	assert.deepEqual(state.definedAgents, []);
});

test('defined agents survive run_done so Ctrl+G can explain after the turn', () => {
	let state = runWithTool('define_agent', {name: '风控员'});
	state = reducer(state, {type: 'engine_event', event: {type: 'run_done', runId: 'run-1', success: true, summary: 'ok'}});
	assert.deepEqual(state.definedAgents, ['风控员']);
});

test('agent_view_sibling switches between siblings', () => {
	let state = {...initialState};
	const entry = {agentId: 'a1', name: 'Researcher', siblings: [
		{agentId: 'a1', name: 'Researcher'},
		{agentId: 'a2', name: 'Writer'},
		{agentId: 'a3', name: 'Reviewer'}
	]};
	state = reducer(state, {type: 'agent_view_push', entry});

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a2');
	assert.equal(state.agentViewStack.entries[0]?.name, 'Writer');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a3');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'next'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a1', 'wraps around');

	state = reducer(state, {type: 'agent_view_sibling', direction: 'prev'});
	assert.equal(state.agentViewStack.entries[0]?.agentId, 'a3', 'prev wraps around');
});

test('run_failed localizes known fault kind and remedy with raw detail tail', () => {
	const state = reducer(initialState, {type: 'engine_event', event: {
		type: 'run_failed',
		runId: 'run_1',
		error: 'Rate exceeded',
		fault: {kind: 'availability', remedy: 'retry_same'}
	}});
	const row = state.localTurns.flatMap(t => t.systemMessages).find(m => m.id.startsWith('run_failed_'));
	assert.ok(row?.text.includes('模型暂时不可用'));
	assert.ok(row?.text.includes('以相同设置重试'));
	assert.equal(row?.detail, 'Rate exceeded');
});

function turnWithAnswer(text: string) {
	let state = reducer(initialState, {type: 'submit_user', text: 'hi', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});
	return state;
}

test('rerun_started hides victim assistant rows but keeps user row visible', () => {
	let state = turnWithAnswer('old answer');
	assert.equal(turnsToTimeline(state).items.filter(i => i.kind === 'assistant_message').length, 1);

	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	const items = turnsToTimeline(state).items;
	assert.equal(items.filter(i => i.kind === 'assistant_message').length, 0);
	assert.ok(items.some(i => i.kind === 'user_message'));
});

test('RerunRun rejection renders localized card and retires optimistic hide', () => {
	let state = turnWithAnswer('old answer');
	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'RerunRun', status: 'error', message: 'session_busy: another run is active'
	}});
	const row = state.localTurns.flatMap(t => t.systemMessages).at(-1);
	assert.ok(row?.text.includes('会话正忙'));
	assert.equal(state.rerunPendingRunId, null);
	assert.ok(turnsToTimeline(state).items.some(i => i.kind === 'assistant_message'), 'victim visible again');
});

test('RerunRun acceptance stays silent and keeps pending hide until restore', () => {
	let state = turnWithAnswer('old answer');
	state = reducer(state, {type: 'rerun_started', runId: 'turn_1'});
	const before = state.localTurns.flatMap(t => t.systemMessages).length;
	state = reducer(state, {type: 'engine_event', event: {
		type: 'command_result', name: 'RerunRun', status: 'success', message: 'accepted'
	}});
	assert.equal(state.localTurns.flatMap(t => t.systemMessages).length, before);
	assert.equal(state.rerunPendingRunId, 'turn_1');

	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'turn_2', userText: 'hi', assistantText: 'new answer', supersedes: 'turn_1'}]
	}});
	assert.equal(state.rerunPendingRunId, null);
});
