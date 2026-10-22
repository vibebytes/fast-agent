import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	pullsReviewDiff,
	reviewDiffGate,
	reviewDiffUnavailableKey,
	shouldExplainReviewDiffOff
} from './useAgentReview.js';
import type {ReviewList} from '@fast-ide/session-view';

test('a closed switch explains unavailable as the experimental switch', () => {
	assert.equal(shouldExplainReviewDiffOff(false, true), true);
	assert.equal(shouldExplainReviewDiffOff(true, true), false);
	assert.equal(shouldExplainReviewDiffOff(false, false), false);
});

test('a closed switch does not ask for hunks even when rows are pending', () => {
	assert.equal(pullsReviewDiff(false, 3), false);
	assert.equal(pullsReviewDiff(false, 0), false);
});

test('an open switch still asks when something is undecided', () => {
	assert.equal(pullsReviewDiff(true, 3), true);
	assert.equal(pullsReviewDiff(true, 0), false);
});

const pendingList = (available: boolean): ReviewList => ({
	revision: 4,
	available,
	changes: [{changeId: 'c1', path: 'a.txt', state: {kind: 'pending'}} as never]
});

test('gate asks for hunks only for an open switch with undecided rows', () => {
	assert.deepEqual(reviewDiffGate(true, pendingList(true)), {pull: true, explain: false});
	assert.deepEqual(reviewDiffGate(false, pendingList(true)), {pull: false, explain: false});
	assert.deepEqual(reviewDiffGate(true, pendingList(false)), {pull: true, explain: false});
	assert.deepEqual(reviewDiffGate(true, null), {pull: false, explain: false});
});

test('the switch hint follows the daemon saying unavailable, not a local row count', () => {
	// The daemon answered that review is unavailable: the hint is earned even though rows were pending.
	assert.deepEqual(reviewDiffGate(false, pendingList(false)), {pull: false, explain: true});
	// A stale cached list still says available: no hint yet, the next answer decides.
	assert.deepEqual(reviewDiffGate(false, pendingList(true)), {pull: false, explain: false});
	// Decided rows are not evidence about the switch — an open switch must never hint.
	const decided: ReviewList = {revision: 4, available: true, changes: []};
	assert.deepEqual(reviewDiffGate(true, decided), {pull: false, explain: false});
});

test('the hint key points at the experimental switch', () => {
	assert.equal(reviewDiffUnavailableKey, 'settings.experimental.reviewDiffUnavailable');
});
