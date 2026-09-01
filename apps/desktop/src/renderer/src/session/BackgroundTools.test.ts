import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {LiveChildWork, LiveTask} from '@fast-ide/session-view';
import {
	drawerChildWork,
	drawerTasks,
	goalDetailChildWork,
	isGoalStepWork
} from './backgroundTasks';

function task(status: string, taskId = 'j1'): LiveTask {
	return {taskId, kind: 'loop', status, startedAt: 1};
}

function childWork(
	id: string,
	title: string,
	parentRef?: string,
	kind = 'run'
): LiveChildWork {
	return {kind, id, parentRef, title, status: 'running', startedAt: 1};
}

describe('drawerTasks', () => {
	it('keeps armed and paused; drops cancelled/expired', () => {
		const rows = drawerTasks([
			task('armed', 'a'),
			task('paused', 'p'),
			task('cancelled', 'c'),
			task('expired', 'e'),
			task('running', 'r')
		]);
		assert.deepEqual(
			rows.map(t => t.taskId),
			['a', 'p', 'r']
		);
	});

	it('keeps session_loop projection kind=loop when armed', () => {
		const loop: LiveTask = {
			taskId: 'job-loop',
			kind: 'loop',
			status: 'armed',
			title: 'every 2m',
			startedAt: 1
		};
		assert.equal(drawerTasks([loop]).length, 1);
		assert.equal(drawerTasks([loop])[0]!.kind, 'loop');
	});
});

describe('drawerChildWork', () => {
	it('drops the main-session run and keeps actual child workloads', () => {
		const rows = drawerChildWork([
			childWork('run:main', 'run'),
			childWork('run:step', 'goal-step:g1'),
			childWork('run:child', 'run', 'run:main'),
			childWork('fire:job:occ', 'scheduled research', undefined, 'fire')
		]);

		assert.deepEqual(
			rows.map(w => w.id),
			['run:step', 'run:child', 'fire:job:occ']
		);
	});

	it('keeps two live sibling subagent rows', () => {
		const rows = drawerChildWork([
			childWork('run:c1', 'subagent'),
			childWork('run:c2', 'subagent')
		]);
		assert.equal(rows.length, 2);
		assert.deepEqual(
			rows.map(w => w.id),
			['run:c1', 'run:c2']
		);
	});

	it('hides goal-step rows when Goal flowchart owns them', () => {
		const rows = drawerChildWork(
			[
				childWork('run:step', 'goal-step:g1'),
				childWork('run:child', 'subagent', 'run:step'),
				childWork('fire:job:occ', 'scheduled research', undefined, 'fire')
			],
			{hideGoalSteps: true}
		);
		assert.deepEqual(
			rows.map(w => w.id),
			['run:child', 'fire:job:occ']
		);
		assert.equal(isGoalStepWork(childWork('run:step', 'goal-step:g1')), true);
	});
});

describe('goalDetailChildWork', () => {
	it('keeps nested subagent and drops goal-step projection', () => {
		const rows = goalDetailChildWork([
			childWork('run:step', 'goal-step:g1'),
			childWork('run:child', 'subagent', 'run:step'),
			childWork('run:orphan', 'run')
		]);
		assert.deepEqual(
			rows.map(w => w.id),
			['run:child']
		);
	});
});
