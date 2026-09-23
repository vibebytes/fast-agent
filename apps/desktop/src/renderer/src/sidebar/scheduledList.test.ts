import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {isRunInProgress, planFireLabel, planPlace, relativeLabel, runSlice} from './scheduledList.js';

describe('planFireLabel', () => {
	it('formats the next fire in the job timezone', () => {
		assert.equal(planFireLabel('2026-09-22T00:00:00Z', 'Asia/Shanghai'), '9/22 08:00');
	});
});

describe('relativeLabel', () => {
	it('uses hours for a same-day run', () => {
		const now = Date.parse('2026-09-22T15:00:00Z');
		const label = relativeLabel('2026-09-22T00:00:00Z', now, 'en');
		assert.match(label, /15 hours ago|15 hr\. ago/);
	});
});

describe('planPlace', () => {
	it('prefers the workspace name, then the open project, then the folder', () => {
		assert.equal(planPlace({workspaceName: 'desk', projectDisplayName: 'other'}), 'desk');
		assert.equal(planPlace({projectDisplayName: 'Quant'}), 'Quant');
		assert.equal(planPlace({workspaceRoot: '/Users/me/work/agent'}), 'agent');
		assert.equal(planPlace({}), '');
	});
});

describe('runSlice', () => {
	it('keeps up to 20 runs on one page and pages the rest', () => {
		const rows = Array.from({length: 21}, (_, i) => i);
		assert.equal(runSlice(rows, 0).pages, 2);
		assert.deepEqual(runSlice(rows, 0).rows, rows.slice(0, 20));
		assert.deepEqual(runSlice(rows, 1).rows, [20]);
		assert.equal(runSlice(rows.slice(0, 20), 0).pages, 1);
	});
});

describe('isRunInProgress', () => {
	it('treats dispatching and running as in progress', () => {
		assert.equal(isRunInProgress('dispatching'), true);
		assert.equal(isRunInProgress('running'), true);
		assert.equal(isRunInProgress('succeeded'), false);
	});
});
