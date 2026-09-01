import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../../state/model.js';
import {turnsToTimeline, splitTimeline} from './turnAdapter.js';
import {reducer} from '../../state/reducer.js';
import {FIXTURE_TURN_FLOW, applyEventSequence} from '../../fixtures/bridgeEvents.js';

test('turnsToTimeline converts user and assistant messages', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = applyEventSequence(state, reducer, FIXTURE_TURN_FLOW);
	const timeline = turnsToTimeline(state);
	assert.ok(timeline.items.some(item => item.kind === 'user_message'));
	assert.ok(timeline.items.some(item => item.kind === 'tool_group'));
	assert.ok(timeline.items.some(item => item.kind === 'assistant_message'));
});

test('a running turn renders exactly one Thinking indicator at every stage', () => {
	const runningThinkingCount = (s: typeof initialState): number =>
		turnsToTimeline(s).items.filter(item => item.kind === 'thinking_message' && item.running === true).length;

	// Stage 1: accepted, no deltas yet (the historical double-Thinking case).
	let state = reducer(initialState, {type: 'submit_user', text: '运行贪吃蛇游戏', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'thinking_started', turnId: 'turn_1', turn: 1, maxTurns: 50}});
	assert.equal(runningThinkingCount(state), 1);

	// Stage 2: reasoning streaming.
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_1', text: '先想想'}});
	assert.equal(runningThinkingCount(state), 1);

	// Stage 3: assistant text streaming after thinking.
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: '好的。'}});
	assert.ok(runningThinkingCount(state) <= 1);

	// Stage 4: a tool is running.
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	assert.ok(runningThinkingCount(state) <= 1);

	// Finished: no running indicator at all.
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});
	assert.equal(runningThinkingCount(state), 0);
});

test('closed assistant segments settle; only the live tail stays pending', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'let me check files'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: 'final answer here'}});

	const timeline = turnsToTimeline(state);
	const assistants = timeline.items.filter(item => item.kind === 'assistant_message');
	assert.equal(assistants.length, 2);
	// First assistant segment closed when the tool segment arrived → settled.
	assert.notEqual(assistants[0]?.pending, true);
	// Second segment is the live streaming tail → pending.
	assert.equal(assistants[1]?.pending, true);
	assert.equal(assistants[1]?.kind === 'assistant_message' ? assistants[1].streaming : undefined, true);
});

test('completed thinking collapses in compact mode but expands in full mode', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_1', text: 'thinking hard'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: 'done'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	const compactThinking = turnsToTimeline(state).items.find(item => item.kind === 'thinking_message');
	assert.equal(compactThinking?.kind === 'thinking_message' ? compactThinking.collapsed : undefined, true);

	const full = turnsToTimeline({...state, thinkingDisplay: 'full'}).items.find(item => item.kind === 'thinking_message');
	assert.equal(full?.kind === 'thinking_message' ? full.collapsed : undefined, false);

	const off = turnsToTimeline({...state, thinkingDisplay: 'off'}).items.find(item => item.kind === 'thinking_message');
	assert.equal(off, undefined);
});

test('thinkingDisplay modes still apply to Thoughts restored from session_restored steps', () => {
	const restored = reducer(initialState, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{
			turnId: 'restored_0',
			userText: 'research',
			assistantText: 'done',
			thinking: 'first\nsecond',
			steps: [
				{reasoning: 'first', tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}]},
				{reasoning: 'second', text: 'done'}
			]
		}]
	}});

	const compact = turnsToTimeline({...restored, thinkingDisplay: 'compact'})
		.items.filter(item => item.kind === 'thinking_message');
	assert.equal(compact.length, 2);
	assert.ok(compact.every(item => item.kind === 'thinking_message' && item.collapsed === true));

	const full = turnsToTimeline({...restored, thinkingDisplay: 'full'})
		.items.filter(item => item.kind === 'thinking_message');
	assert.equal(full.length, 2);
	assert.ok(full.every(item => item.kind === 'thinking_message' && item.collapsed === false));

	const off = turnsToTimeline({...restored, thinkingDisplay: 'off'})
		.items.filter(item => item.kind === 'thinking_message');
	assert.equal(off.length, 0);
});

test('completed assistant messages render in full (history is never consolidated)', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'final_answer', turnId: 'turn_1', text: 'x'.repeat(180)}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});

	const timeline = turnsToTimeline(state);
	const assistant = timeline.items.find(item => item.kind === 'assistant_message');
	assert.notEqual(assistant?.compact, true);
	assert.notEqual(assistant?.pending, true);
	assert.equal(assistant?.kind === 'assistant_message' ? assistant.text : undefined, 'x'.repeat(180));
});

test('settled sequence is append-only across a full streaming flow', () => {
	const settledIds = (s: typeof initialState): string[] =>
		turnsToTimeline(s).items.filter(item => item.pending !== true).map(item => item.id);

	const steps: Array<(s: typeof initialState) => typeof initialState> = [
		s => reducer(s, {type: 'submit_user', text: '你好，帮我跑测试', clientMessageId: 'client_1'}),
		s => reducer(s, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'turn_1', text: '先看看目录结构'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: '第一段分析。\n\n第二段'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: '继续输出中文内容。\n\n第三段'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'npm test'}}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'tool_output', turnId: 'turn_1', id: 'tool_1', tool: 'shell', stream: 'stdout', text: 'ok'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'shell', success: true, fields: {exit: '0'}}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: '测试通过。'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}}),
		s => reducer(s, {type: 'submit_user', text: '继续', clientMessageId: 'client_2'}),
		s => reducer(s, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_2', turnId: 'turn_2'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_2', text: '好的。'}}),
		s => reducer(s, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_2', success: true}})
	];

	let state = initialState;
	let previous: string[] = [];
	for (const [stepIndex, step] of steps.entries()) {
		state = step(state);
		const current = settledIds(state);
		assert.ok(
			current.length >= previous.length,
			`step ${stepIndex}: settled shrank ${previous.length} -> ${current.length}`
		);
		for (const [index, id] of previous.entries()) {
			assert.equal(current[index], id, `step ${stepIndex}: settled[${index}] changed ${id} -> ${current[index]}`);
		}
		previous = current;
	}

	// After everything finishes, all turn content is settled.
	const finalPending = turnsToTimeline(state).items.filter(item => item.pending === true);
	assert.equal(finalPending.length, 0);
});

test('active tool groups remain collapsed until explicitly expanded', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'read_file', args: {path: 'package.json'}}});

	const timeline = turnsToTimeline(state);
	const tools = timeline.items.find(item => item.kind === 'tool_group');
	assert.equal(tools?.kind === 'tool_group' ? tools.expanded : undefined, false);
});

test('double input_accepted does NOT break settled ID append-only invariant', () => {
	const settledIds = (s: typeof initialState): string[] =>
		turnsToTimeline(s).items.filter(item => item.pending !== true).map(item => item.id);

	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_abc'});
	assert.deepEqual(settledIds(state), [], 'nothing settled while pending');

	// Optimistic accept: turnId still equals clientMessageId — no remap yet, stays pending.
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_abc', turnId: 'client_abc'}});
	assert.deepEqual(settledIds(state), [], 'optimistic accept alone does not settle — turnId not yet remapped');

	// Async accept: turnId = server UUID → entry turnId remaps away from clientMessageId, settling it.
	// Entry `id` stays stable (still derived from the client id) even though turnId changed.
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_abc', turnId: '019f-server-uuid'}});
	const afterSecondAccept = settledIds(state);
	assert.ok(afterSecondAccept.some(id => id.includes('client_abc')), 'user message settled with its stable client-derived id');

	// Continue streaming — subsequent events use server UUID but settled IDs remain stable
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: '019f-server-uuid', text: 'thinking'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: '019f-server-uuid', text: 'first chunk\n\nsecond chunk'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: '019f-server-uuid', id: 'tool_1', tool: 'shell', args: {command: 'ls'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: '019f-server-uuid', id: 'tool_1', tool: 'shell', success: true, fields: {}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: '019f-server-uuid', success: true}});

	const finalSettled = settledIds(state);
	for (const [index, id] of afterSecondAccept.entries()) {
		assert.equal(finalSettled[index], id, `original settled[${index}] must be preserved`);
	}
	assert.ok(finalSettled.length > afterSecondAccept.length, 'new items appended after streaming');
});

test('items behind a still-pending item never settle first (structural append-only)', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'go', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	// A tool is still running (pending) while assistant chunks stream after it.
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'shell', args: {command: 'sleep 10'}}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text: '第一段。\n\n第二段。\n\n第三段'}});

	const items = turnsToTimeline(state).items;
	const firstPending = items.findIndex(item => item.pending === true);
	assert.ok(firstPending >= 0);
	for (const item of items.slice(firstPending)) {
		assert.equal(item.pending, true, `item ${item.id} settled behind a pending item`);
	}
});

test('settled sequence stays append-only across restore + stray stream', () => {
	const settledIds = (s: typeof initialState): string[] =>
		turnsToTimeline(s).items.filter(item => item.pending !== true).map(item => item.id);

	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'},
			{turnId: 'restored_1', userText: '再问', assistantText: '再答'}
		]
	}});

	const events: Array<Parameters<typeof reducer>[1]> = [
		{type: 'engine_event', event: {type: 'reasoning_delta', text: '\n'}},
		{type: 'notice', text: '中间插入的系统提示'},
		{type: 'engine_event', event: {type: 'reasoning_delta', text: '正文思考'}},
		{type: 'engine_event', event: {type: 'assistant_delta', text: '答案。\n\n下一段'}},
		{type: 'engine_event', event: {type: 'turn_finished', success: true}}
	];

	let previous = settledIds(state);
	for (const [step, action] of events.entries()) {
		state = reducer(state, action);
		const current = settledIds(state);
		for (const [index, id] of previous.entries()) {
			assert.equal(current[index], id, `step ${step}: settled[${index}] changed ${id} -> ${current[index]}`);
		}
		assert.ok(current.length >= previous.length, `step ${step}: settled shrank`);
		previous = current;
	}
});

test('slash command_result stays before later Bridge turns (chronological merge)', () => {
	let state = reducer(initialState, {type: 'submit_command', text: '/skills', clientMessageId: 'skills_chrono'});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'command_result',
			name: 'skills',
			message: 'Skills (1)\n───\n  pptx',
			status: 'success'
		}
	});
	state = reducer(state, {type: 'collapse_command_menus'});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'turn_started',
			turnId: 'later_turn',
			clientMessageId: 'later_turn',
			text: 'continue grilling'
		}
	});
	state = reducer(state, {
		type: 'engine_event',
		event: {type: 'assistant_delta', turnId: 'later_turn', text: 'Step 1 done'}
	});

	const kinds = turnsToTimeline(state).items.map(item => item.kind);
	const skillsIdx = kinds.indexOf('system_message');
	const assistantIdx = kinds.indexOf('assistant_message');
	assert.ok(skillsIdx >= 0, 'skills card present');
	assert.ok(assistantIdx >= 0, 'assistant present');
	assert.ok(skillsIdx < assistantIdx, 'skills card must precede later Bridge assistant text');
});

test('splitTimeline separates pending items', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});
	state = reducer(state, {
		type: 'engine_event',
		event: {
			type: 'question_requested',
			id: 'q1',
			runId: 'turn_1',
			turnId: 'turn_1',
			question: 'Choose',
			options: [{id: 'a', label: 'A'}]
		}
	});
	const timeline = turnsToTimeline(state);
	const {staticHistory, pendingItems} = splitTimeline(timeline);
	assert.ok(staticHistory.length > 0, 'settled history keeps the finished exchange');
	assert.equal(pendingItems.length, 1, 'the interactive question dialog is the only live item');
	assert.equal(pendingItems[0]?.kind, 'question_message');
});
