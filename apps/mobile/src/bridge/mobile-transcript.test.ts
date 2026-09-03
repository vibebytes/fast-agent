import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  batchAnswersOf,
  batchDraftCompleted,
  emptyBatchDraft,
  foldUserEchoes,
  goalKeepsBusy,
  isEchoEntry,
  optimisticUserEntry,
  overlayGoalGate,
  parseRecommendedLabel,
  STOPPABLE_GOAL_PHASES
} from './mobile-transcript.ts';

test('foldUserEchoes appends a user echo and keeps it without a real row', () => {
  const {entries, pending} = foldUserEchoes([], [{clientMessageId: 'm1', text: 'hello'}]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.role, 'user');
  assert.equal(entries[0]?.text, 'hello');
  assert.equal(isEchoEntry(entries[0]!), true);
  assert.deepEqual(pending, [{clientMessageId: 'm1', text: 'hello'}]);
});

test('foldUserEchoes drops the echo when a real user row shares clientMessageId', () => {
  const echo = optimisticUserEntry('m1', 'hello');
  const real = {
    id: 'user-turn-1',
    role: 'user' as const,
    text: 'hello',
    status: 'done' as const,
    clientMessageId: 'm1',
    turnId: 'turn-1'
  };
  const {entries, pending} = foldUserEchoes([echo, real], [{clientMessageId: 'm1', text: 'hello'}]);
  assert.equal(entries.some(isEchoEntry), false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, 'user-turn-1');
  assert.deepEqual(pending, []);
});

test('foldUserEchoes drops the echo on same text when engine omits clientMessageId', () => {
  const echo = optimisticUserEntry('m1', 'hello');
  const real = {
    id: 'user-2',
    role: 'user' as const,
    text: 'hello',
    status: 'done' as const
  };
  const {entries, pending} = foldUserEchoes([echo, real], [{clientMessageId: 'm1', text: 'hello'}]);
  assert.equal(entries.some(isEchoEntry), false);
  assert.deepEqual(pending, []);
});

test('foldUserEchoes keeps a second identical-text echo until its own real row arrives', () => {
  const first = {id: 'user-1', role: 'user' as const, text: 'hello', status: 'done' as const, clientMessageId: 'm1'};
  const {entries, pending} = foldUserEchoes(
    [first],
    [
      {clientMessageId: 'm1', text: 'hello'},
      {clientMessageId: 'm2', text: 'hello'}
    ]
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.clientMessageId, 'm2');
  assert.equal(entries.filter(isEchoEntry).length, 1);
});

test('foldUserEchoes does not TTL-drop an unmatched echo', () => {
  const echo = optimisticUserEntry('m1', 'still here');
  const {entries, pending} = foldUserEchoes([echo], [{clientMessageId: 'm1', text: 'still here'}]);
  assert.equal(entries.length, 1);
  assert.equal(isEchoEntry(entries[0]!), true);
  assert.equal(pending.length, 1);
});

test('STOPPABLE_GOAL_PHASES matches Desktop SessionPane', () => {
  assert.deepEqual([...STOPPABLE_GOAL_PHASES].sort(), ['escalated', 'paused', 'started']);
  assert.equal(goalKeepsBusy({goalId: 'g1', phase: 'started', status: 'running'}), true);
  assert.equal(goalKeepsBusy({goalId: 'g1', phase: 'awaiting_confirm', status: 'idle'}), false);
  assert.equal(goalKeepsBusy({goalId: 'g1', phase: 'finished', status: 'passed'}), false);
});

test('overlayGoalGate turns idle into running with canCancel false', () => {
  const base = {
    runState: 'idle' as const,
    canSubmitNow: true,
    canEnqueue: false,
    canCancel: false,
    composerLocked: false,
    lockReason: null
  };
  const over = overlayGoalGate(base, {goalId: 'g1', phase: 'started', status: 'running'});
  assert.equal(over.runState, 'running');
  assert.equal(over.canSubmitNow, true);
  assert.equal(over.canCancel, false);
  assert.equal(over.canEnqueue, false);
});

test('parseRecommendedLabel strips conventional suffixes', () => {
  assert.deepEqual(parseRecommendedLabel('Fast (Recommended)'), {label: 'Fast', recommended: true});
  assert.deepEqual(parseRecommendedLabel('稳妥（推荐）'), {label: '稳妥', recommended: true});
  assert.deepEqual(parseRecommendedLabel('Plain'), {label: 'Plain', recommended: false});
});

test('batchAnswersOf skips empty selected and keeps custom', () => {
  const drafts = {
    q1: {...emptyBatchDraft(), selected: ['A']},
    q2: {...emptyBatchDraft(), skipped: true},
    q3: {...emptyBatchDraft(), custom: 'other'}
  };
  assert.equal(batchDraftCompleted(drafts.q2), true);
  assert.deepEqual(
    batchAnswersOf(
      [
        {id: 'q1'},
        {id: 'q2'},
        {id: 'q3'}
      ],
      drafts
    ),
    [
      {id: 'q1', selected: ['A']},
      {id: 'q2', selected: []},
      {id: 'q3', selected: [], custom: 'other'}
    ]
  );
});
