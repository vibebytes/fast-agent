import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyGoalPush,
	awaitingConfirmPlan,
	goalCardFromPush,
	goalConfirmStarted,
	goalFlowSeed,
	goalKeepsBusy,
	goalPushClobbersConfirm,
	paintAwaitingConfirm,
	patchedGoalCard,
	startedGoalCardFromConfirm
} from './goalCard.js';
import {applyBridgeEvent} from './transcriptProjection.js';
import {
	chromePostRun,
	chromeRunId,
	IDLE_RUN_CHROME,
	SETTLED_RUN_CHROME,
	type RunChrome
} from './runChrome.js';
import type {GoalCardView} from './wire.js';
import type {TranscriptEntry, TranscriptState} from './transcriptProjection.js';

const card = (over: Partial<GoalCardView> = {}): GoalCardView => ({
	goalId: 'g1',
	phase: 'awaiting_confirm',
	status: 'awaiting_input',
	...over
});

const entry = (over: Partial<TranscriptEntry> & {id: string; role: 'user' | 'assistant'}): TranscriptEntry => ({
	text: '',
	status: 'done',
	...over
});

const state = (entries: TranscriptEntry[], chrome = IDLE_RUN_CHROME): TranscriptState => ({
	entries,
	approvals: [],
	questions: [],
	questionBatches: [],
	subagents: [],
	chrome
});

test('goalKeepsBusy truth table', () => {
	assert.equal(goalKeepsBusy(undefined), false);
	assert.equal(goalKeepsBusy(null), false);
	assert.equal(goalKeepsBusy(card({phase: 'awaiting_confirm'})), false);
	assert.equal(goalKeepsBusy(card({phase: 'finished', status: 'passed'})), false);
	assert.equal(goalKeepsBusy(card({phase: 'started'})), true);
	assert.equal(goalKeepsBusy(card({phase: 'paused'})), true);
	assert.equal(goalKeepsBusy(card({phase: 'escalated', escalateKind: 'infra'})), false);
	assert.equal(goalKeepsBusy(card({phase: 'escalated', escalateKind: 'decision'})), true);
});

test('awaitingConfirmPlan renders goal prose with confirm ask', () => {
	const text = awaitingConfirmPlan(
		card({
			name: '重构 goalCard',
			statement: '把 Goal 卡片呈现逻辑抽成深模块',
			acceptance: 'tsc 通过\ntest 通过',
			membersJson: JSON.stringify([{name: '重构手'}, {name: '质检'}])
		})
	);
	assert.ok(text.includes('目标：重构 goalCard'));
	assert.ok(text.includes('说明：把 Goal 卡片呈现逻辑抽成深模块'));
	assert.ok(text.includes('验收：tsc 通过'));
	assert.ok(text.includes('成员：重构手、质检'));
	assert.ok(text.includes('请确认是否开始执行（回复「开始」或「确认」即可）。'));
	const deduped = awaitingConfirmPlan(card({name: '同名', statement: '同名'}));
	assert.ok(deduped.includes('目标：同名'));
	assert.ok(!deduped.includes('说明：同名'));
});

test('paintAwaitingConfirm guards and paints', () => {
	const planTurn = state([
		entry({id: 'u1', role: 'user', text: '帮我定个重构计划'}),
		entry({id: 'a1', role: 'assistant', text: '计划如下……', goalId: 'g1'})
	]);
	assert.equal(paintAwaitingConfirm(planTurn), planTurn);
	assert.equal(
		paintAwaitingConfirm(planTurn, card({phase: 'started'})),
		planTurn
	);
	const dedicated = state([
		entry({id: 'u1', role: 'user', text: '帮我定个重构计划'}),
		entry({id: 'a1', role: 'assistant', text: '我来执行，请确认是否开始执行（回复「开始」或「确认」即可）。'})
	]);
	assert.equal(paintAwaitingConfirm(dedicated, card()), dedicated);
	const toolTail = state([
		entry({id: 'u1', role: 'user', text: '帮我定个重构计划'}),
		entry({
			id: 'a1',
			role: 'assistant',
			text: '工具已跑完',
			tools: [{id: 't1', tool: 'shell', status: 'success'}]
		})
	]);
	const painted = paintAwaitingConfirm(toolTail, card());
	assert.equal(painted.entries.length, 3);
	assert.equal(painted.entries[2].id, 'assistant-awaiting-g1');
	assert.ok(painted.entries[2].text.includes('请确认是否开始执行'));
	const streaming = state(
		[...planTurn.entries, entry({id: 'a2', role: 'assistant', text: '', status: 'streaming'})],
		IDLE_RUN_CHROME
	);
	assert.equal(paintAwaitingConfirm(streaming, card()), streaming);
	const streamingPostRun = state(
		[...toolTail.entries, entry({id: 'a2', role: 'assistant', text: '', status: 'streaming'})],
		SETTLED_RUN_CHROME
	);
	const paintedPostRun = paintAwaitingConfirm(streamingPostRun, card());
	assert.equal(paintedPostRun.entries.length, 3);
	assert.equal(paintedPostRun.entries[2].id, 'a2');
	assert.ok(paintedPostRun.entries[2].text.includes('请确认是否开始执行'));
});

test('goalFlowSeed seeds workflow members and fallback', () => {
	const seeded = goalFlowSeed(
		card({
			phase: 'started',
			status: 'running',
			name: 'Goal',
			workflowJson: JSON.stringify({
				nodes: [
					{id: 'impl', use: '重构手'},
					{id: 'verify', use: '质检'},
					{id: 'summary', use: '总结'}
				]
			}),
			progressJson: JSON.stringify({completed_steps: ['impl']}),
			currentStepIds: ['verify']
		})
	);
	assert.equal(seeded.goalId, 'g1');
	assert.deepEqual(
		seeded.members.map(m => [m.name, m.status]),
		[
			['重构手', 'success'],
			['质检', 'running']
		]
	);
	const fallback = goalFlowSeed(card({phase: 'escalated', escalateKind: 'decision', status: 'escalated'}));
	assert.deepEqual(fallback.members, [{runId: 'seed-g1', name: 'Goal', status: 'error'}]);
	const finished = goalFlowSeed(card({phase: 'finished', status: 'failed'}));
	assert.deepEqual(finished.members, [{runId: 'seed-g1', name: 'Goal', status: 'error'}]);
});

test('goalCardFromPush builds card and narrows escalateKind', () => {
	const c = goalCardFromPush({
		goalId: 'g2',
		phase: 'escalated',
		status: 'escalated',
		escalateKind: 'weird',
		reason: 'blocked',
		name: 'T',
		statement: 's'
	});
	assert.equal(c.escalateKind, undefined);
	assert.equal(c.reason, 'blocked');
	const infra = goalCardFromPush({
		goalId: 'g2',
		phase: 'escalated',
		status: 'escalated',
		escalateKind: 'infra'
	});
	assert.equal(infra.escalateKind, 'infra');
});

test('goalPushClobbersConfirm only for a different goal leaving confirm', () => {
	const confirm = card({goalId: 'g1'});
	assert.equal(goalPushClobbersConfirm(confirm, {goalId: 'g1', phase: 'started', status: 'x'}), false);
	assert.equal(goalPushClobbersConfirm(confirm, {goalId: 'g2', phase: 'started', status: 'x'}), true);
	assert.equal(goalPushClobbersConfirm(confirm, {goalId: 'g2', phase: 'awaiting_confirm', status: 'x'}), false);
	assert.equal(goalPushClobbersConfirm(undefined, {goalId: 'g2', phase: 'started', status: 'x'}), false);
});

test('patchedGoalCard overrides present fields, keeps previous for nullish, merges id lists', () => {
	const prev = card({currentStepIds: ['a'], activeRunIds: ['r1'], resultSummary: 'old'});
	const next = patchedGoalCard(prev, {
		id: 'g1',
		status: 'running',
		resultSummary: null,
		currentStepId: ['b']
	});
	assert.equal(next.status, 'running');
	assert.equal(next.resultSummary, 'old');
	assert.deepEqual(next.currentStepIds, ['b']);
	assert.deepEqual(next.activeRunIds, ['r1']);
	assert.equal(next.statement, undefined);
});

test('goalConfirmStarted accepts server running or echoed tag', () => {
	assert.equal(goalConfirmStarted({id: 'g', status: 'running'}, ''), true);
	assert.equal(goalConfirmStarted(undefined, 'confirmed+started: ok'), true);
	assert.equal(goalConfirmStarted(undefined, 'confirmed'), false);
});

test('startedGoalCardFromConfirm requires a goalId and merges g/prev', () => {
	assert.equal(startedGoalCardFromConfirm(undefined, undefined), undefined);
	const built = startedGoalCardFromConfirm(
		card({goalId: 'g1', statement: 'plan', currentStepIds: ['a']}),
		{id: 'g1', status: 'running', currentStepIds: ['b']}
	);
	assert.deepEqual(built && [built.goalId, built.phase, built.status, built.currentStepIds], [
		'g1',
		'started',
		'running',
		['b']
	]);
	assert.equal(built?.statement, 'plan');
});

const sealedRun = (runId: string): RunChrome => ({phase: 'sealedRun', runId, fromServer: true});

test('applyGoalPush lifts postRun on started/paused/escalated so Goal content is not dropped', () => {
	const settled = state(
		[entry({id: 'u1', role: 'user', text: '/goal'}), entry({id: 'a1', role: 'assistant', text: 'plan'})],
		SETTLED_RUN_CHROME
	);
	const started = applyGoalPush(settled, card({phase: 'started', status: 'running'}), 'started');
	assert.equal(chromePostRun(started.chrome), false);
	assert.equal(started.chrome.phase, 'idle');
	assert.equal(started.goalFlow?.goalId, 'g1');

	const afterDelta = applyBridgeEvent(started, {
		type: 'assistant_delta',
		turnId: 'goal-run-1',
		text: '执行中'
	} as never);
	assert.ok(
		afterDelta.entries.some(e => e.text.includes('执行中')),
		'Goal assistant_delta after a settled chat must land, not be dropped as a straggler'
	);

	const paused = applyGoalPush(settled, card({phase: 'paused', status: 'paused'}), 'paused');
	assert.equal(chromePostRun(paused.chrome), false);
	const escalated = applyGoalPush(
		settled,
		card({phase: 'escalated', status: 'escalated', escalateKind: 'decision'}),
		'escalated'
	);
	assert.equal(chromePostRun(escalated.chrome), false);
});

test('applyGoalPush keeps settled chrome on confirm/finished and preserves a sealed run id when lifting', () => {
	const settled = state(
		[entry({id: 'u1', role: 'user', text: '/goal'}), entry({id: 'a1', role: 'assistant', text: ''})],
		SETTLED_RUN_CHROME
	);
	const confirm = applyGoalPush(settled, card(), 'awaiting_confirm');
	assert.equal(confirm.chrome, SETTLED_RUN_CHROME);
	assert.ok(confirm.entries.some(e => e.text.includes('请确认是否开始执行')));

	const finished = applyGoalPush(settled, card({phase: 'finished', status: 'passed'}), 'finished');
	assert.equal(finished.chrome, SETTLED_RUN_CHROME);
	assert.equal(chromePostRun(finished.chrome), true);

	const live = applyGoalPush(
		state([entry({id: 'a1', role: 'assistant', text: 'done', status: 'done'})], sealedRun('chat-1')),
		card({phase: 'started', status: 'running'}),
		'started'
	);
	assert.equal(chromePostRun(live.chrome), false);
	assert.equal(chromeRunId(live.chrome), 'chat-1');
});
