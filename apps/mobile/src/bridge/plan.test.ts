import assert from 'node:assert/strict';
import {test} from 'node:test';

import {attachOne, detachOne} from './attach-count.ts';
import {helloRejectDetail} from './hello.ts';
import {overlayGoalGate} from './mobile-transcript.ts';
import {createNotify} from './notify.ts';
import {applyProjectSessions, isRegisteredWorkspaceHash, type SessionRow} from './session-list.ts';

const row = (id: string): SessionRow => ({
  id,
  title: id,
  summary: null,
  lastModified: '',
  messageCount: 0,
  runMode: null,
  engineKind: null
});

test('HelloReject UNAUTHORIZED stays typed when a message is present', () => {
  const detail = helloRejectDetail({code: 'UNAUTHORIZED', message: 'invalid authToken'});
  assert.equal(detail.code, 'unauthorized');
});

test('attach twice then detach once keeps the session; the second release drops it', () => {
  let counts = attachOne({}, 's');
  counts = attachOne(counts, 's');
  const once = detachOne(counts, 's');
  assert.equal(once.release, false);
  assert.equal(once.counts.s, 1);
  const twice = detachOne(once.counts, 's');
  assert.equal(twice.release, true);
  assert.equal(twice.counts.s, undefined);
});

test('a Meta workspace id is not a registered sessions hash', () => {
  assert.equal(isRegisteredWorkspaceHash('abcdef012345'), true);
  assert.equal(isRegisteredWorkspaceHash('550e8400-e29b-41d4-a716-446655440000'), false);
});

test('unknown empty sessions_list keeps the seed; a known empty list clears; a full page keeps the rest', () => {
  const seed = [row('a'), row('b')];
  assert.deepEqual(applyProjectSessions(seed, [], false).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(applyProjectSessions(seed, [], true), []);
  const page = Array.from({length: 20}, (_, i) => row(`n${i}`));
  const merged = applyProjectSessions(seed, page, true);
  assert.equal(merged.length, 22);
  assert.equal(merged[0]?.id, 'n0');
  assert.equal(merged.at(-1)?.id, 'b');
  assert.deepEqual(applyProjectSessions(seed, [row('only')], true).map((s) => s.id), ['only']);
});

test('goal overlay keeps canSubmitNow false when the session is not ready', () => {
  const next = overlayGoalGate(
    {
      runState: 'idle',
      canSubmitNow: false,
      canEnqueue: false,
      canCancel: false,
      composerLocked: false,
      lockReason: null
    },
    {goalId: 'g', phase: 'started', status: 'running'}
  );
  assert.equal(next.canSubmitNow, false);
  assert.equal(next.runState, 'running');
});

test('notify runs listeners before returning and coalesces a nested write', () => {
  const listeners = new Set<() => void>();
  const notify = createNotify();
  const seen: string[] = [];
  listeners.add(() => {
    seen.push('outer');
    if (seen.length === 1) notify(listeners);
  });
  notify(listeners);
  assert.deepEqual(seen, ['outer', 'outer']);
});
