import assert from 'node:assert/strict';
import test from 'node:test';
import type {ReviewChange, ReviewList} from '@fast-ide/session-view';
import {diffTabId, FILES_TAB_ID, type RailTab} from '../railTabs.js';
import {reviewRows} from './agentReview.js';
import {
	openReviewDiff,
	reviewRowOpenTarget,
	shouldApplyOpenDiffRequest,
	type RailTabsState
} from './openReviewDiff.js';

const files: RailTab = {id: FILES_TAB_ID, kind: 'files', title: 'Files', pinned: true};
const changes: RailTab = {id: 'rail-changes', kind: 'changes', title: 'Changes'};

const initial = (): RailTabsState => ({
	tabs: [files, changes],
	activeId: FILES_TAB_ID
});

const listOf = (rows: ReviewChange[]): ReviewList => ({
	revision: 1,
	available: true,
	changes: rows
});

const change = (over: Partial<ReviewChange> = {}): ReviewChange => ({
	id: 'chg-readme',
	checkpointId: 'ckpt-1',
	path: 'agent/README.md',
	kind: 'modified',
	state: {kind: 'pending'},
	...over
});

test('opening a review row focuses a Diff tab (not Files / Changes)', () => {
	const row = reviewRows(listOf([change()]), [])[0]!;
	const target = reviewRowOpenTarget(row);
	assert.ok(target, 'pending daemon rows must be openable');

	const next = openReviewDiff(initial(), target.changeId, target.path);
	assert.equal(next.activeId, diffTabId('chg-readme'));
	const active = next.tabs.find(t => t.id === next.activeId);
	assert.equal(active?.kind, 'diff');
	assert.equal(active?.changeId, 'chg-readme');
	assert.equal(active?.filePath, 'agent/README.md');
	assert.equal(active?.title, 'README.md');
});

test('opening the same change twice reuses one Diff tab', () => {
	const first = openReviewDiff(initial(), 'chg-readme', 'agent/README.md');
	const second = openReviewDiff(first, 'chg-readme', 'agent/README.md');
	assert.equal(second.tabs.filter(t => t.kind === 'diff').length, 1);
	assert.equal(second.activeId, diffTabId('chg-readme'));
});

test('a capturing row (no changeId) does not open a Diff tab', () => {
	const rows = reviewRows(listOf([]), [
		{id: 'live', path: 'README.md', add: 1, del: 0, status: 'running'}
	]);
	assert.equal(reviewRowOpenTarget(rows[0]!), null);
	const next = openReviewDiff(initial(), '', 'README.md');
	assert.equal(next.activeId, FILES_TAB_ID);
	assert.equal(next.tabs.some(t => t.kind === 'diff'), false);
});

test('diff tab id is known before setTabs (React 18 updater is deferred)', () => {
	// Regression: writing focusId inside setTabs(prev => { focusId = ... }) left
	// setActiveId(focusId) with undefined — Diff tab added, rail stayed on Changes.
	const changeId = 'chg-readme';
	const id = diffTabId(changeId);
	assert.equal(id, 'diff:chg-readme');
	const next = openReviewDiff(initial(), changeId, 'agent/README.md');
	assert.equal(next.activeId, id);
});

test('strip open request applies once per nonce; clearing App state is unsafe', () => {
	const request = {changeId: 'chg-readme', path: 'agent/README.md', nonce: 1};
	assert.equal(shouldApplyOpenDiffRequest(request, null), true);
	assert.equal(shouldApplyOpenDiffRequest(request, 1), false);
	assert.equal(shouldApplyOpenDiffRequest(request, 2), true);
	assert.equal(shouldApplyOpenDiffRequest(null, 1), false);

	// Full handoff without clearing App request — survives Strict Mode remount.
	let handledNonce: number | null = null;
	let state = initial();
	const onOpenChange = (changeId: string, path: string) => {
		const next = {changeId, path, nonce: Date.now()};
		if (shouldApplyOpenDiffRequest(next, handledNonce)) {
			handledNonce = next.nonce;
			state = openReviewDiff(state, next.changeId, next.path);
		}
	};

	const row = reviewRows(listOf([change()]), [
		{id: 'live', path: 'README.md', add: 1, del: 1, status: 'done'}
	])[0]!;
	const target = reviewRowOpenTarget(row);
	assert.ok(target);
	onOpenChange(target.changeId, target.path);
	assert.equal(state.tabs.find(t => t.id === state.activeId)?.kind, 'diff');

	// Remount simulation: handledNonce resets, request still present with a new open.
	handledNonce = null;
	onOpenChange(target.changeId, target.path);
	assert.equal(state.activeId, diffTabId('chg-readme'));
});
