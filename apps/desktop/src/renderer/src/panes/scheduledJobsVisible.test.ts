import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {scheduledJobKindLabel, scheduledJobsVisible} from './scheduledJobsVisible';

describe('scheduledJobsVisible', () => {
	it('keeps armed/paused session_loop and platform; drops cancelled and unknown kinds', () => {
		const rows = scheduledJobsVisible([
			{id: 'l1', kind: 'session_loop', status: 'armed'},
			{id: 'p1', kind: 'platform', status: 'paused'},
			{id: 'l2', kind: 'session_loop', status: 'cancelled'},
			{id: 'x', kind: 'other', status: 'armed'}
		]);
		assert.deepEqual(
			rows.map(j => j.id),
			['l1', 'p1']
		);
	});

	it('kind labels', () => {
		assert.equal(scheduledJobKindLabel('session_loop'), 'Loop');
		assert.equal(scheduledJobKindLabel('platform'), 'Automation');
	});
});
