import assert from 'node:assert/strict';
import {afterEach, before, test} from 'node:test';
import {
	activeTabFocusTaskId,
	endTabFocus,
	markTabFocusIpc,
	markTabPaint,
	markTabRender,
	markTabStaging,
	startTabFocus
} from './performanceTrace.js';

before(() => {
	// Keep unit output clean; production tracing still uses console.debug.
	console.debug = () => {};
});

afterEach(() => {
	endTabFocus({reason: 'test-cleanup'});
});

test('tab.focus settles at interactive (backfill), not full backfill completion', () => {
	const id = startTabFocus({taskId: 't-long', fromTaskId: 't-a'});
	assert.equal(activeTabFocusTaskId(), 't-long');

	markTabRender({
		taskId: 't-long',
		bodyMissing: false,
		deferredPending: false,
		transcriptEntries: 40
	});
	// Still open — no paint / staging yet.
	assert.equal(activeTabFocusTaskId(), 't-long');

	markTabFocusIpc({id, ok: true, focusEpoch: 3, durationMs: 12});
	assert.equal(activeTabFocusTaskId(), 't-long');

	markTabStaging({
		taskId: 't-long',
		phase: 'staging',
		visible: 1,
		total: 10,
		sections: 10
	});
	markTabPaint({taskId: 't-long'});
	assert.equal(activeTabFocusTaskId(), 't-long');

	// Tail window mounted — idle backfill continues, but the switch is settled.
	markTabStaging({
		taskId: 't-long',
		phase: 'backfill',
		visible: 4,
		total: 10,
		sections: 10
	});
	assert.equal(activeTabFocusTaskId(), null);
});

test('tab.focus also settles on staging complete (short thread)', () => {
	const id = startTabFocus({taskId: 't-short', fromTaskId: null});
	markTabRender({taskId: 't-short', bodyMissing: false, deferredPending: false});
	markTabFocusIpc({id, ok: true, focusEpoch: 1, durationMs: 5});
	markTabPaint({taskId: 't-short'});
	markTabStaging({
		taskId: 't-short',
		phase: 'complete',
		visible: 2,
		total: 2,
		sections: 2
	});
	assert.equal(activeTabFocusTaskId(), null);
});

test('tab.focus ends immediately on ipc failure', () => {
	const id = startTabFocus({taskId: 't1', fromTaskId: null});
	markTabFocusIpc({id, ok: false, durationMs: 5});
	assert.equal(activeTabFocusTaskId(), null);
});

test('new focus supersedes the previous span', () => {
	startTabFocus({taskId: 'a', fromTaskId: null});
	startTabFocus({taskId: 'b', fromTaskId: 'a'});
	assert.equal(activeTabFocusTaskId(), 'b');
});
