import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attentionOf, type SessionFacts } from './attention.ts';

const fact = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's',
  title: 'S',
  pending: null,
  running: false,
  ...over
});

test('nothing attached is idle', () => {
  assert.deepEqual(attentionOf([], 'h'), { mood: 'idle', needsCount: 0, needs: [], working: [] });
});

test('home running reads as working; a side chat running alone does not', () => {
  assert.equal(attentionOf([fact({ sessionId: 'h', running: true })], 'h').mood, 'working');
  const side = attentionOf([fact({ sessionId: 'x', running: true })], 'h');
  assert.equal(side.mood, 'idle');
  assert.equal(side.working.length, 1);
});

test('any blocking card wins over working and is counted across sessions', () => {
  const a = attentionOf(
    [
      fact({ sessionId: 'h', running: true }),
      fact({ sessionId: 'x', pending: { kind: 'approval', text: 'rm', count: 2 } }),
      fact({ sessionId: 'y', pending: { kind: 'question', text: 'which?', count: 1 } })
    ],
    'h'
  );
  assert.equal(a.mood, 'needs');
  assert.equal(a.needsCount, 3);
  assert.deepEqual(a.needs.map((f) => f.sessionId), ['x', 'y']);
});
