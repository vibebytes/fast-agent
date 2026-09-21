/** transcriptProjection tests — session_restored / persist after settle. Loaded by transcriptProjection.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	appendProcPreview,
	applyBridgeEvent,
	applyLocalCancel,
	composerGate,
	createTranscriptState,
	formatActivitySummary,
	LIVE_PROC_PREVIEW_MAX,
	nextFireAtFromDetail,
	normalizeToolOutput,
	parseDiffWithLineNumbers,
	parseExitCode,
	resolveToolStatus,
	toTimelineItems
} from '../index.js';
import {runChromeTransition, chromeRunId, chromePostRun, chromeAwaitingSettlement} from '../runChrome.js';

test('session_restored mid-run keeps the in-flight streaming entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'turn_live',
		clientMessageId: 'client_live',
		text: '继续构建'
	});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 'turn_live',
		text: '思考中'
	});
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.ok(state.entries.some(e => e.turnId === 'restored_0'));
	const live = state.entries.find(e => e.turnId === 'turn_live' && e.role === 'assistant');
	assert.equal(live?.status, 'streaming');
	assert.equal(live?.reasoning, '思考中');
});

test('session_restored with live turn in snapshot does not duplicate', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'turn_live',
		clientMessageId: 'client_live',
		text: '继续构建'
	});
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'},
			{turnId: 'turn_live', userText: '继续构建', assistantText: '部分内容已落盘'}
		],
		hasMoreOlder: false,
		totalTurnCount: 2
	});
	const liveUsers = state.entries.filter(e => e.role === 'user' && e.turnId === 'turn_live');
	const liveAssistants = state.entries.filter(e => e.role === 'assistant' && e.turnId === 'turn_live');
	assert.equal(liveUsers.length, 1, 'live user should not duplicate');
	assert.equal(liveAssistants.length, 1, 'live assistant should not duplicate');
	assert.equal(liveAssistants[0]?.status, 'streaming');
	assert.equal(
		liveAssistants[0]?.text,
		'部分内容已落盘',
		'Attach restore must paint persisted prose onto the empty live row (restart-visible today)'
	);
	const all = toTimelineItems(state);
	const assistantItems = all.filter(
		(i): i is Extract<(typeof all)[number], {kind: 'assistant'}> =>
			i.kind === 'assistant' && i.text.trim() !== ''
	);
	assert.ok(
		assistantItems.some(i => i.text.includes('部分内容已落盘')),
		'live timeline must show restored prose without a UI remount'
	);
});

test('prior turn_finished must not drop the next live turn prose', () => {
	// User sent the same prompt twice while the first run was still settling.
	// turn_finished used to arm postRunTerminal unconditionally and swallow the
	// second turn's assistant_delta — live UI showed two user bubbles and no body.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'client-1',
		text: '我们不讨论实施，只讨论哪个方案更好'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-2',
		clientMessageId: 'client-2',
		text: '我们不讨论实施，只讨论哪个方案更好'
	});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		1
	);
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-1', success: true});
	assert.equal(chromePostRun(state.chrome), false, 'a still-streaming turn must keep the content gate open');
	assert.equal(chromeRunId(state.chrome), 'run-2');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-2',
		text: 'Engine → EngineRuntime → EngineSession 更好。'
	});
	const live = state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant');
	assert.equal(live?.text, 'Engine → EngineRuntime → EngineSession 更好。');
	assert.equal(live?.status, 'streaming');
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-2', success: true});
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant')?.status, 'done');
});

test('final_answer after empty settle still paints the body', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: '只讨论方案'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'compare layers'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, '');
	assert.equal(state.entries.find(e => e.role === 'assistant')?.reasoning, 'compare layers');
	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 't1',
		text: '用三层生命周期拆 Engine。'
	});
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.text, '用三层生命周期拆 Engine。');
	assert.equal(assistant?.reasoning, 'compare layers', 'thinking must survive empty-settle seed');
	assert.equal(assistant?.status, 'done', 'filling empty prose must not relight Stop');
	assert.ok(toTimelineItems(state).some(i => i.kind === 'assistant' && i.text.includes('三层生命周期')));
});

test('stray stream after restore never mutates a completed restored entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: 'old', assistantText: 'done text'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	const restored = state.entries.find(e => e.role === 'assistant');
	assert.equal(restored?.text, 'done text');
	const before = restored?.text;
	// Homeless deltas: shared projection drops them (no ghost synthesize).
	state = applyBridgeEvent(state, {type: 'reasoning_delta', text: 'stray'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', text: 'stray a'});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, before);
	assert.equal(state.entries.filter(e => e.role === 'assistant').length, 1);
});

test('cold session_restored settles so attach-replay TurnStarted does not relight Stop', () => {
	let state = createTranscriptState();
	state = {...state, chrome: runChromeTransition(state.chrome, {run: {id: 'stale-run', fromServer: false}, awaiting: true})};
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'review 下这个开发计划',
				assistantText: '## Findings\n总结：计划可落地。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(chromeAwaitingSettlement(state.chrome), false);
	assert.equal(chromePostRun(state.chrome), true, 'settled restore must arm the straggler guard');
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);

	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run-9', text: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'empty persist TurnStarted must not spawn a streaming row after cold restore'
	);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('session_restored keeps background_wake origin on the user entry for wake styling', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'm1',
				userText: 'Background task(s) finished (1). Continue from these results:\n- procId=p exitCode=0',
				assistantText: '已继续处理后台结果',
				origin: 'background_wake'
			},
			{turnId: 'm2', userText: '普通提问', assistantText: '回答'}
		],
		hasMoreOlder: false,
		totalTurnCount: 2
	});
	assert.equal(
		state.entries.find(e => e.turnId === 'm1' && e.role === 'user')?.origin,
		'background_wake'
	);
	assert.equal(state.entries.find(e => e.turnId === 'm2' && e.role === 'user')?.origin, undefined);
});

test('settled restore + persist TurnStarted with user text must not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'restored_0',
				userText: '继续完成啊',
				assistantText: '剩余 3 项 [~] 及原因'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		text: '继续完成啊',
		eventSeq: 80
	});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'persist opener with the restored prompt must not spawn a new streaming row'
	);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('persist TurnStarted with eventSeq must not fill an empty user row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'ok'
	});
	state = {
		...state,
		entries: state.entries.map(e => (e.role === 'user' ? {...e, text: ''} : e))
	};
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 9
	});
	assert.equal(state.entries.find(e => e.role === 'user')?.text, '');
});
test('settled restore + persist input_accepted must not set activeRunId', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: 'hi', assistantText: 'done'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		eventSeq: 81
	});
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('settled restore + persist approval pair must not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: '01a017f0-ed6f-719a-90d4-4b87394f2805',
		turns: [
			{
				turnId: '01a0197b-8976-7f28-98a6-68d7f404d274',
				userText: '设计L0引擎文档',
				assistantText: '文档已写完。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(chromePostRun(state.chrome), true);
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		tool: 'shell',
		description: 'git diff build.sbt',
		eventSeq: 5454
	});
	assert.equal(state.approvals.length, 1, 'pending card still paints so a live wait can resolve');
	assert.equal(chromeRunId(state.chrome), undefined, 'settled restore must not arm Stop from persist approval');
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'approval_resolved',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		approved: true,
		eventSeq: 5455
	});
	assert.equal(state.approvals.length, 0);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
});

test('live approval_requested still arms activeRunId so resolve can resume Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-live',
		clientMessageId: 'client-live',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-live',
		runId: 'run-live',
		tool: 'shell',
		description: 'rm'
	});
	assert.equal(chromeRunId(state.chrome), 'run-live');
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(composerGate(state, true).canCancel, false, 'prompt lock extinguishes Stop');
	state = applyBridgeEvent(state, {
		type: 'approval_resolved',
		id: 'ap-live',
		runId: 'run-live',
		approved: true
	});
	assert.equal(chromeRunId(state.chrome), 'run-live');
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true).canCancel, true);
});

test('user turn_started after settled restore lifts the guard', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'old', userText: 'hi', assistantText: 'hello'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(chromePostRun(state.chrome), true);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-2',
		clientMessageId: 'client-2',
		text: '下一句'
	});
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), 'client-2');
	assert.equal(composerGate(state, true).runState, 'running');
});
test('session_restored restores goal_outcome / goal_step_conclusion chrome from assistantMessageType', () => {
	const state = applyBridgeEvent(createTranscriptState(), {
		type: 'session_restored',
		sessionId: 's1',
		turns: [
			{
				turnId: 'msg-step',
				userText: '',
				assistantText: '验收意见正文',
				assistantMessageType: 'goal_step_conclusion',
				goalId: 'g1',
				goalStepId: 'verify',
				goalAgentName: 'reviewer',
				goalVerdict: 'pass'
			},
			{
				turnId: 'msg-out',
				userText: '',
				assistantText: 'ship it',
				assistantMessageType: 'goal_outcome',
				goalId: 'g1',
				goalStatus: 'passed'
			}
		]
	});
	const step = state.entries.find(e => e.turnId === 'msg-step');
	assert.equal(step?.messageType, 'goal_step_conclusion');
	assert.equal(step?.goalAgentName, 'reviewer');
	assert.equal(step?.goalVerdict, 'pass');
	const out = state.entries.find(e => e.turnId === 'msg-out');
	assert.equal(out?.messageType, 'goal_outcome');
	assert.equal(out?.goalStatus, 'passed');
	const items = toTimelineItems(state);
	assert.ok(items.some(i => i.kind === 'goalStepConclusion'));
	assert.ok(items.some(i => i.kind === 'goalOutcome'));
});

test('goal_step_conclusion and goal_outcome structured turns project after chat seal', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'go'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(chromePostRun(state.chrome), true);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-step-r1-conclusion',
		messageType: 'goal_step_conclusion',
		agentName: 'reviewer',
		verdict: 'pass',
		goalId: 'g1',
		stepId: 'verify'
	});
	assert.equal(chromePostRun(state.chrome), true, 'goal system turn must not clear postRunTerminal');
	assert.equal(chromeRunId(state.chrome), undefined, 'goal system turn must not arm Stop');
	const stepEntry = state.entries.find(e => e.turnId === 'goal-step-r1-conclusion');
	assert.equal(stepEntry?.messageType, 'goal_step_conclusion');
	assert.equal(stepEntry?.goalAgentName, 'reviewer');
	assert.equal(stepEntry?.goalVerdict, 'pass');

	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 'goal-step-r1-conclusion',
		text: '验收意见正文'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 'goal-step-r1-conclusion',
		success: true
	});
	assert.equal(
		state.entries.find(e => e.turnId === 'goal-step-r1-conclusion')?.text,
		'验收意见正文'
	);

	const items = toTimelineItems(state);
	const stepItem = items.find(i => i.kind === 'goalStepConclusion');
	assert.ok(stepItem);
	assert.equal(stepItem?.kind === 'goalStepConclusion' && stepItem.agentName, 'reviewer');
	assert.equal(stepItem?.kind === 'goalStepConclusion' && stepItem.verdict, 'pass');

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-g1-notice',
		messageType: 'goal_outcome',
		goalId: 'g1',
		goalStatus: 'passed'
	});
	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 'goal-g1-notice',
		text: 'Goal passed: ship it'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'goal-g1-notice', success: true});
	const outcome = toTimelineItems(state).find(i => i.kind === 'goalOutcome');
	assert.ok(outcome);
	assert.equal(outcome?.kind === 'goalOutcome' && outcome.goalStatus, 'passed');
	assert.equal(outcome?.kind === 'goalOutcome' && outcome.text, 'Goal passed: ship it');
});
test('settled restore + live new turn with fresh prompt paints and arms run', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-live-new',
		turns: [{turnId: 'restored_0', userText: 'hi', assistantText: 'done'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'tb',
		clientMessageId: 'tb',
		text: 'ask B',
		eventSeq: 1
	});
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), 'tb');
	assert.ok(
		state.entries.some(e => e.role === 'assistant' && e.turnId === 'tb' && e.status === 'streaming'),
		'live new turn on a freshly restored session must paint a streaming row'
	);
});

test('settled cancel + resubmit with different prompt paints new streaming turn', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c1',
		clientMessageId: 'c1',
		text: '继续寻找方法',
		eventSeq: 1
	});
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', reason: 'stop', eventSeq: 2});
	assert.equal(chromePostRun(state.chrome), true);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c2',
		clientMessageId: 'c2',
		text: '继续',
		eventSeq: 3
	});
	assert.equal(chromePostRun(state.chrome), false);
	assert.ok(
		state.entries.some(e => e.role === 'assistant' && e.turnId === 'c2' && e.status === 'streaming'),
		'resubmit after cancel settle must paint a new streaming row'
	);
});
