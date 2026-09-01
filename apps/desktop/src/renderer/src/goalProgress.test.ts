import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {goalProgress} from './goalProgress';

describe('goalProgress', () => {
	it('parses completed_steps and pending_extras', () => {
		const p = goalProgress(
			JSON.stringify({
				completed_steps: ['researcher', ''],
				pending_extras: {writer: 'retry'},
				reject_count: 2
			})
		);
		assert.deepEqual([...p.completedSteps], ['researcher']);
		assert.deepEqual([...p.pendingExtras], ['writer']);
		assert.equal(p.rejectCount, 2);
	});

	it('returns empty on missing or invalid json', () => {
		assert.equal(goalProgress(null).completedSteps.size, 0);
		assert.equal(goalProgress('{').rejectCount, 0);
	});
});
