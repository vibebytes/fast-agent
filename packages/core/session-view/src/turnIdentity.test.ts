import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bareRunId,
	entryMatchesKey,
	entryTurnIdIs,
	isGoalNoticeId,
	isScheduledId,
	sameRunId,
	sameTurn,
	serverRunIdOf
} from './turnIdentity.js';

test('bareRunId strips the wire WorkId prefix', () => {
	assert.equal(bareRunId('run:abc'), 'abc');
	assert.equal(bareRunId('abc'), 'abc');
	assert.equal(bareRunId(undefined), '');
	assert.equal(sameRunId('run:abc', 'abc'), true);
	assert.equal(sameRunId('run:abc', 'abd'), false);
	assert.equal(sameRunId(undefined, 'abc'), false);
});

test('sameTurn cross-matches turnId and clientMessageId in both directions', () => {
	assert.equal(sameTurn({turnId: 't1'}, {turnId: 't1'}), true);
	assert.equal(sameTurn({turnId: 't1'}, {clientMessageId: 't1'}), true);
	assert.equal(sameTurn({clientMessageId: 'c1'}, {turnId: 'c1'}), true);
	assert.equal(sameTurn({clientMessageId: 'c1'}, {clientMessageId: 'c1'}), true);
	assert.equal(sameTurn({turnId: 't1', clientMessageId: 'c1'}, {turnId: 'c2', clientMessageId: 'c1'}), true);
	assert.equal(sameTurn({turnId: 't1'}, {turnId: 't2', clientMessageId: 'c2'}), false);
	assert.equal(sameTurn({}, {}), false);
	assert.equal(sameTurn({turnId: 't1'}, {turnId: ''}), false);
});

test('entryMatchesKey hits either key; entryTurnIdIs is turnId-only', () => {
	assert.equal(entryMatchesKey({turnId: 't1'}, 't1'), true);
	assert.equal(entryMatchesKey({clientMessageId: 'c1'}, 'c1'), true);
	assert.equal(entryMatchesKey({turnId: 't1'}, undefined), false);
	assert.equal(entryMatchesKey({turnId: 't1'}, ''), false);
	assert.equal(entryTurnIdIs({turnId: 't1', clientMessageId: 't1'}, 't1'), true);
	assert.equal(entryTurnIdIs({clientMessageId: 't1'}, 't1'), false);
});

test('serverRunIdOf only remaps a distinct id pair', () => {
	assert.equal(serverRunIdOf({turnId: 'srv', clientMessageId: 'loc'}), 'srv');
	assert.equal(serverRunIdOf({turnId: 'srv', clientMessageId: 'srv'}), undefined);
	assert.equal(serverRunIdOf({turnId: 'srv'}), undefined);
	assert.equal(serverRunIdOf({clientMessageId: 'loc'}), undefined);
});

test('goal notice and scheduled id shapes', () => {
	assert.equal(isGoalNoticeId('goal-abc123-notice'), true);
	assert.equal(isGoalNoticeId('goal-step-abc123-conclusion'), true);
	assert.equal(isGoalNoticeId('goal-plain'), false);
	assert.equal(isGoalNoticeId(undefined), false);
	assert.equal(isGoalNoticeId(''), false);
	assert.equal(isScheduledId('sched-20240101-abc'), true);
	assert.equal(isScheduledId('turn-1'), false);
	assert.equal(isScheduledId(undefined), false);
});
