import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {approvalKey, takeNewApprovals} from './useApprovalSound.js';

describe('takeNewApprovals', () => {
	it('reports first-seen approvals and ignores repeats', () => {
		const seen = new Set<string>();
		const first = takeNewApprovals(seen, {
			t1: {approvals: [{id: 'a1'}, {id: 'a2'}]}
		});
		assert.deepEqual(first, [approvalKey('t1', 'a1'), approvalKey('t1', 'a2')]);
		assert.deepEqual(
			takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}, {id: 'a2'}]}}),
			[]
		);
	});

	it('reports only newly arrived approvals', () => {
		const seen = new Set<string>();
		takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}]}});
		const added = takeNewApprovals(seen, {
			t1: {approvals: [{id: 'a1'}, {id: 'a2'}]}
		});
		assert.deepEqual(added, [approvalKey('t1', 'a2')]);
	});

	it('forgets resolved approvals on a live task so they can chime again', () => {
		const seen = new Set<string>();
		takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}]}});
		takeNewApprovals(seen, {t1: {approvals: []}});
		assert.equal(seen.has(approvalKey('t1', 'a1')), false);
		const added = takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}]}});
		assert.deepEqual(added, [approvalKey('t1', 'a1')]);
	});

	it('keeps keys when a task is evicted so hydrate does not re-chime', () => {
		const seen = new Set<string>();
		takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}]}});
		assert.deepEqual(takeNewApprovals(seen, {}), []);
		assert.equal(seen.has(approvalKey('t1', 'a1')), true);
		assert.deepEqual(takeNewApprovals(seen, {t1: {approvals: [{id: 'a1'}]}}), []);
	});
});
