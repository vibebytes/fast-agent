import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {LiveChildWork} from '@fast-ide/session-view';
import {goalStepChildWork} from './backgroundTasks';

function work(partial: Partial<LiveChildWork> & Pick<LiveChildWork, 'id'>): LiveChildWork {
	return {
		kind: 'run',
		title: 'goal-step:g1',
		status: 'succeeded',
		startedAt: 1,
		...partial
	};
}

test('goalStepChildWork scopes settled L1 rows to the active goalId', () => {
	const rows = [
		work({id: 'run:a', goalId: 'g1', stepId: 'analyst'}),
		work({id: 'run:b', goalId: 'g2', stepId: 'reviewer', title: 'goal-step:g2'}),
		work({id: 'run:c', title: 'goal-step:g1'}), // legacy title marker
		work({id: 'run:d', title: 'subagent', goalId: undefined})
	];
	const forG1 = goalStepChildWork(rows, 'g1');
	assert.deepEqual(
		forG1.map(w => w.id).sort(),
		['run:a', 'run:c']
	);
	assert.equal(goalStepChildWork(rows, 'g2').map(w => w.id).join(), 'run:b');
});
