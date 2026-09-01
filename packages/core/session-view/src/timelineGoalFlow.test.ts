import assert from 'node:assert/strict';
import {test} from 'node:test';
import {goalFlowInsertIndex, placeGoalFlow, type TimelineItem} from './timeline.js';

const flow = (goalId = 'g1'): Extract<TimelineItem, {kind: 'goalFlow'}> => ({
	kind: 'goalFlow',
	id: `goal-flow-${goalId}`,
	goalId,
	phase: 'finished',
	status: 'passed',
	label: 'Goal · passed',
	members: [{name: '分析师', status: 'success'}]
});

const goalTool = (
	id: string,
	status: Extract<TimelineItem, {kind: 'tool'}>['status']
): Extract<TimelineItem, {kind: 'tool'}> => ({
	kind: 'tool',
	id,
	tool: 'goal',
	status,
	title: 'goal',
	command: null,
	output: '',
	exitCode: null,
	summary: null,
	startedAt: 1
});

const stack = (steps: Extract<TimelineItem, {kind: 'processStack'}>['steps']): Extract<
	TimelineItem,
	{kind: 'processStack'}
> => ({
	kind: 'processStack',
	id: 'stack-1',
	steps,
	stepCount: steps.length,
	open: false
});

const stepConclusion = (
	id: string,
	goalId = 'g1'
): Extract<TimelineItem, {kind: 'goalStepConclusion'}> => ({
	kind: 'goalStepConclusion',
	id,
	agentName: '画师',
	goalId,
	text: 'RuntimeException: truncated',
	status: 'error'
});

const outcome = (
	id: string,
	goalId = 'g1'
): Extract<TimelineItem, {kind: 'goalOutcome'}> => ({
	kind: 'goalOutcome',
	id,
	goalId,
	goalStatus: 'passed',
	text: 'done',
	status: 'done'
});

test('placeGoalFlow stays on the handshake, not after the finish notice', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u0', text: 'start goal', isCommand: false},
		goalTool('t-goal', 'success'),
		outcome('go'),
		{kind: 'user', id: 'u1', text: '完成了吗', isCommand: false}
	];
	const next = placeGoalFlow(items, flow('g1'));
	assert.deepEqual(
		next.map(i => i.id),
		['u0', 't-goal', 'goal-flow-g1', 'go', 'u1']
	);
});

test('goalFlowInsertIndex falls back ahead of trailing user when Goal markers missing', () => {
	const items: TimelineItem[] = [
		{kind: 'assistant', id: 'a1', text: 'hi', status: 'done'},
		{kind: 'user', id: 'u1', text: '完成了吗', isCommand: false}
	];
	assert.equal(goalFlowInsertIndex(items, 'g1'), 1);
});

test('placeGoalFlow replaces an existing chrome for the same goalId', () => {
	const items: TimelineItem[] = [
		{
			kind: 'tool',
			id: 't-goal',
			tool: 'goal',
			status: 'success',
			title: 'goal',
			command: null,
			output: 'ok',
			exitCode: null,
			summary: null,
			startedAt: 1
		},
		flow('g1'),
		{kind: 'user', id: 'u1', text: 'next', isCommand: false}
	];
	const next = placeGoalFlow(items, {...flow('g1'), phase: 'started', label: 'Goal · running'});
	assert.equal(next.filter(i => i.kind === 'goalFlow').length, 1);
	assert.equal(next[1]?.kind === 'goalFlow' && next[1].phase, 'started');
	assert.equal(next[2]?.id, 'u1');
});

test('placeGoalFlow follows assistant prose after a stacked plan, not a failed goal card', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u0', text: '/goal', isCommand: false},
		goalTool('t-fail', 'error'),
		stack([goalTool('t-ok', 'success')]),
		{kind: 'assistant', id: 'a1', text: 'Goal 已启动，进度见下方。', status: 'done'}
	];
	const next = placeGoalFlow(items, {...flow('g1'), phase: 'started', label: 'Goal · running'});
	assert.deepEqual(
		next.map(i => i.id),
		['u0', 't-fail', 'stack-1', 'a1', 'goal-flow-g1']
	);
});

test('placeGoalFlow stays ahead of a later user turn after assistant prose', () => {
	const items: TimelineItem[] = [
		goalTool('t-fail', 'error'),
		stack([goalTool('t-ok', 'success')]),
		{kind: 'assistant', id: 'a1', text: 'Goal 已启动', status: 'done'},
		{kind: 'user', id: 'u1', text: '完成了吗', isCommand: false}
	];
	const next = placeGoalFlow(items, {...flow('g1'), phase: 'started', label: 'Goal · running'});
	assert.deepEqual(
		next.map(i => i.id),
		['t-fail', 'stack-1', 'a1', 'goal-flow-g1', 'u1']
	);
});

test('placeGoalFlow stays on handshake prose when a step conclusion lands later', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u0', text: '/goal', isCommand: false},
		goalTool('t-fail', 'error'),
		stack([goalTool('t-ok', 'success')]),
		{kind: 'assistant', id: 'a1', text: '请确认是否开始执行。', status: 'done'},
		stepConclusion('sc1')
	];
	const next = placeGoalFlow(items, {...flow('g1'), phase: 'started', label: 'Goal · running'});
	assert.deepEqual(
		next.map(i => i.id),
		['u0', 't-fail', 'stack-1', 'a1', 'goal-flow-g1', 'sc1']
	);
});

test('placeGoalFlow moves once from plan handshake to a later start', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u0', text: '/goal', isCommand: false},
		stack([goalTool('t-plan', 'success')]),
		{kind: 'assistant', id: 'a-plan', text: '请确认是否开始执行。', status: 'done'},
		{kind: 'user', id: 'u1', text: '开始', isCommand: false},
		stack([goalTool('t-start', 'success')]),
		{kind: 'assistant', id: 'a-start', text: '已开始执行。', status: 'done'},
		stepConclusion('sc1')
	];
	const next = placeGoalFlow(items, {...flow('g1'), phase: 'started', label: 'Goal · running'});
	assert.deepEqual(
		next.map(i => i.id),
		['u0', 'stack-1', 'a-plan', 'u1', 'stack-1', 'a-start', 'goal-flow-g1', 'sc1']
	);
});
