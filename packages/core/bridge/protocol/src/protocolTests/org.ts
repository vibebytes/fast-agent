/** protocol.test — org. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('bridgeCommandSchema round-trips Goal host commands', () => {
	const cases = [
		{type: 'ConfirmGoal', goalId: 'g1'},
		{type: 'ConfirmGoal', goalId: 'g1', patchJson: '{"acceptance":"tests pass"}'},
		{type: 'PatchGoal', goalId: 'g1', patchJson: '{"statement":"new"}'},
		{type: 'SteerGoal', goalId: 'g1', note: 'prefer streaming API'},
		{type: 'GoalStatus', goalId: 'g1', tenantId: 'default'},
		{type: 'PauseGoal', goalId: 'g1'},
		{type: 'ResumeGoal', goalId: 'g1'},
		{type: 'CancelGoal', goalId: 'g1'},
		{type: 'EscalateResume', goalId: 'g1'},
		{type: 'EscalateFail', goalId: 'g1'}
	] as const;

	for (const cmd of cases) {
		const parsed = parseBridgeCommand(cmd);
		assert.equal(parsed.type, cmd.type);
		const again = bridgeCommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
		assert.equal(again.type, cmd.type);
	}
});

test('goal_updated event parses across phases', () => {
	const attachHydrate = bridgeEventSchema.parse({
		type: 'goal_updated',
		sessionId: '01a003a0-c660-7728-9177-5b8a255b0959',
		goalId: '01a003a2-3f4d-726d-aa85-523e5b2ff059',
		phase: 'finished',
		status: 'passed',
		name: '算力企业机会与切入点研讨',
		statement: '基于提供的材料组建多角色团队研讨',
		acceptance: '1. 交付一份可正常打开的HTML文件。2. 结论务实精炼。'
	});
	assert.equal(attachHydrate.type, 'goal_updated');
	if (attachHydrate.type === 'goal_updated') {
		assert.equal(attachHydrate.eventSeq, undefined);
		assert.equal(attachHydrate.phase, 'finished');
	}

	const awaiting = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'awaiting_confirm',
		status: 'awaiting_confirm',
		statement: 'ship widget',
		acceptance: 'tests green',
		workflowJson: '{"kind":"pipeline","nodes":[]}',
		membersJson: '[{"name":"dev","role":"executor"}]',
		budgetJson: '{"max_rejects":3}',
		loopAgentId: 'line-1'
	});
	assert.equal(awaiting.type, 'goal_updated');
	if (awaiting.type === 'goal_updated') {
		assert.equal(awaiting.phase, 'awaiting_confirm');
		assert.equal(awaiting.goalId, 'g1');
	}

	const finished = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'finished',
		status: 'passed',
		resultSummary: 'Goal passed'
	});
	assert.equal(finished.type, 'goal_updated');

	const escalated = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'escalated',
		status: 'blocked',
		escalateActions: ['Resume', 'Fail'],
		reason: 'budget exhausted'
	});
	assert.equal(escalated.type, 'goal_updated');

	const paused = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'paused',
		status: 'paused'
	});
	assert.equal(paused.type, 'goal_updated');
	if (paused.type === 'goal_updated') assert.equal(paused.phase, 'paused');

	const withProgress = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepIds: ['writer'],
		progressJson: '{"completed_steps":["researcher"],"reject_count":0}'
	});
	assert.equal(withProgress.type, 'goal_updated');
	if (withProgress.type === 'goal_updated') {
		assert.deepEqual(withProgress.currentStepIds, ['writer']);
		assert.ok(withProgress.progressJson?.includes('researcher'));
	}

	const parallel = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepIds: ['bull', 'bear', 'risk'],
		activeRunIds: ['r1', 'r2', 'r3']
	});
	assert.equal(parallel.type, 'goal_updated');
	if (parallel.type === 'goal_updated') {
		assert.deepEqual(parallel.currentStepIds, ['bull', 'bear', 'risk']);
		assert.deepEqual(parallel.activeRunIds, ['r1', 'r2', 'r3']);
	}

	const legacyCsv = bridgeEventSchema.parse({
		type: 'goal_updated',
		eventSeq: 1,
		sessionId: 's1',
		goalId: 'g1',
		phase: 'started',
		status: 'running',
		currentStepId: 'bull,bear,risk'
	});
	assert.equal(legacyCsv.type, 'goal_updated');
	if (legacyCsv.type === 'goal_updated') {
		assert.equal(legacyCsv.currentStepId, 'bull,bear,risk');
	}
});

test('command_result carries the Goal snapshot for card refresh (PatchGoal/ConfirmGoal)', () => {
	const parsed = bridgeEventSchema.parse({
		type: 'command_result',
		name: 'PatchGoal',
		message: 'patched g1',
		status: 'accepted',
		sessionId: 's1',
		goal: {
			id: 'g1',
			status: 'awaiting_confirm',
			statement: 'ship widget v2',
			acceptance: 'tests green',
			originSessionId: 's1',
			workflowJson: '{"kind":"pipeline","nodes":[]}',
			budgetJson: '{"max_rejects":5}',
			membersJson: '[{"name":"dev","role":"executor","model":"gpt"}]',
			loopAgentId: 'line-1',
			escalateActions: []
		}
	});
	assert.equal(parsed.type, 'command_result');
	if (parsed.type === 'command_result') {
		assert.equal(parsed.goal?.id, 'g1');
		assert.equal(parsed.goal?.statement, 'ship widget v2');
		assert.equal(parsed.goal?.membersJson, '[{"name":"dev","role":"executor","model":"gpt"}]');
	}
});
