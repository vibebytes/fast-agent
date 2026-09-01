import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {asLivingProjects} from './livingTasksTypes';

describe('asLivingProjects', () => {
	it('normalizes nested team under Goal', () => {
		const projects = asLivingProjects([
			{
				projectId: 'p1',
				displayName: 'Alpha',
				sessions: [
					{
						sessionId: 's1',
						title: 'Chat',
						projectId: 'p1',
						goals: [
							{
								goalId: 'g1',
								status: 'running',
								phase: 'started',
								statement: 'Ship it',
								currentStepId: 'bull,bear,risk',
								team: {
									teamId: 't1',
									name: 'Builders',
									members: [
										{
											name: 'coder',
											teamRole: 'executor',
											agentId: 'a1',
											runs: [{runId: 'r1', status: 'running'}]
										}
									]
								}
							}
						],
						procs: [{procId: 'proc1', status: 'running', command: 'npm test'}],
						subagents: [{runId: 'r2', status: 'running', title: 'explore'}]
					}
				]
			}
		]);
		assert.equal(projects.length, 1);
		assert.equal(projects[0]!.displayName, 'Alpha');
		const goal = projects[0]!.sessions[0]!.goals[0]!;
		assert.equal(goal.goalId, 'g1');
		assert.deepEqual(goal.currentStepIds, ['bear', 'bull', 'risk']);
		assert.equal(goal.team?.teamId, 't1');
		assert.equal(goal.team?.name, 'Builders');
		assert.equal(goal.team?.members[0]!.runs[0]!.runId, 'r1');
		assert.equal(projects[0]!.sessions[0]!.procs[0]!.command, 'npm test');
		assert.equal(projects[0]!.sessions[0]!.subagents[0]!.runId, 'r2');
	});

	it('prefers plural string[] over legacy singular CSV', () => {
		const projects = asLivingProjects([
			{
				projectId: 'p',
				sessions: [
					{
						sessionId: 's',
						goals: [
							{
								goalId: 'g',
								status: 'running',
								currentStepIds: ['bull', 'bear'],
								currentStepId: 'ignored,csv',
								activeRunIds: ['r1', 'r2'],
								activeRunId: 'legacy'
							}
						]
					}
				]
			}
		]);
		const goal = projects[0]!.sessions[0]!.goals[0]!;
		assert.deepEqual(goal.currentStepIds, ['bear', 'bull']);
		assert.deepEqual(goal.activeRunIds, ['r1', 'r2']);
	});

	it('falls back from legacy flat members', () => {
		const projects = asLivingProjects([
			{
				projectId: 'p',
				sessions: [
					{
						sessionId: 's',
						goals: [
							{
								goalId: 'g',
								status: 'running',
								teamId: 't',
								teamName: 'Legacy',
								members: [{name: 'm', teamRole: 'executor', agentId: 'a', runs: []}]
							}
						]
					}
				]
			}
		]);
		assert.equal(projects[0]!.sessions[0]!.goals[0]!.team?.name, 'Legacy');
		assert.equal(projects[0]!.sessions[0]!.goals[0]!.team?.members[0]!.name, 'm');
	});

	it('defaults missing arrays and null team', () => {
		const projects = asLivingProjects([{projectId: 'p', sessions: [{sessionId: 's'}]}]);
		assert.deepEqual(projects[0]!.sessions[0]!.goals, []);
		assert.deepEqual(projects[0]!.sessions[0]!.procs, []);
		assert.deepEqual(projects[0]!.sessions[0]!.subagents, []);
	});
});
