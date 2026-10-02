import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  expireReachability,
  loadRoster,
  persistRoster,
  switchSource,
  type CachedRoster,
  type RosterItem
} from './roster.ts';

const item = (over: Partial<RosterItem> = {}): RosterItem => ({
  agentId: 'b',
  displayName: '小B',
  endpoints: ['wss://b.example/bridge'],
  fingerprint: 'sha256:abc',
  presence: 'Idle',
  reachable: true,
  ...over
});

test('a dead roster source is replaced within the same update', () => {
  const cache: CachedRoster = { items: [item()], sourceId: 'a' };
  const switched = switchSource(cache, 'a', ['b']);
  assert.equal(switched.sourceId, 'b');
});

test('expired cache rows stay and are marked unknown', () => {
  const cache: CachedRoster = { items: [item({ agentId: 'c', displayName: '小C' })], sourceId: 'a' };
  const raw = persistRoster(cache);
  const loaded = expireReachability(loadRoster(raw));
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0]?.displayName, '小C');
  assert.equal(loaded.items[0]?.reachable, 'unknown');
});
