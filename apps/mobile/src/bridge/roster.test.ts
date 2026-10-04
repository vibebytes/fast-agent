import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bootRoster,
  connectChecked,
  fromServerRoster,
  loseSource,
  persistRoster,
  pickerBlocked,
  probeRoster,
  reachable,
  rosterFromEvent,
  switchSource,
  trustFingerprint,
  type CachedRoster,
  type RosterItem
} from './roster.ts';

const item = (over: Partial<RosterItem> = {}): RosterItem => ({
  agentId: 'b',
  displayName: '小B',
  endpoints: ['wss://b.example/bridge'],
  fingerprint: 'sha256:abc',
  presence: 'Idle',
  ...over
});

test('a roster fingerprint is trusted only when it matches the certificate', () => {
  assert.equal(trustFingerprint('sha256:abc', 'sha256:abc'), true);
  assert.equal(trustFingerprint('sha256:abc', 'sha256:other'), false);
  assert.equal(trustFingerprint('', 'sha256:abc'), false);
});

test('an individual with no open endpoint is not reachable', () => {
  assert.equal(reachable(item(), () => false), false);
  assert.equal(reachable(item(), url => url.includes('b.example')), true);
  assert.equal(reachable(item({ endpoints: [] }), () => true), false);
  assert.equal(reachable(item({ endpoints: ['unix:///tmp/b.sock'] }), () => true), false);
});

test('a server roster id becomes the phone agent id and keeps the main session', () => {
  const items = fromServerRoster({
    items: [
      {
        id: 'agent-b',
        displayName: '小B',
        endpoints: ['wss://b.example/bridge'],
        fingerprint: 'sha256:abc',
        token: 'tok-b',
        presence: 'Idle',
        mainSessionId: 'sess-b'
      }
    ]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].agentId, 'agent-b');
  assert.equal(items[0].mainSessionId, 'sess-b');
  assert.equal(items[0].token, 'tok-b');
  assert.deepEqual(items[0].endpoints, ['wss://b.example/bridge']);
});

test('connect uses the first open endpoint and refuses a different certificate', async () => {
  const target = item({ endpoints: ['wss://down.example/bridge', 'wss://up.example/bridge'] });
  const open = (url: string) => url.includes('up.example');
  const matched = await connectChecked(target, open, async () => 'sha256:abc');
  assert.equal('url' in matched && matched.url, 'wss://up.example/bridge');
  const refused = await connectChecked(target, open, async () => 'sha256:other');
  assert.equal('error' in refused && refused.error, '指纹不符');
  const unseen = await connectChecked(target, open, async () => null);
  assert.equal('error' in unseen && unseen.error, '未能核对证书');
});

test('a roster_changed event replaces the shown individuals', () => {
  const shown = rosterFromEvent({
    type: 'roster_changed',
    items: [
      {
        id: 'agent-b',
        displayName: '小B',
        endpoints: ['wss://b.example/bridge'],
        fingerprint: 'sha256:abc',
        presence: 'Idle',
        mainSessionId: 'sess-b'
      }
    ]
  });
  assert.equal(shown?.[0]?.agentId, 'agent-b');
  assert.equal(shown?.[0]?.mainSessionId, 'sess-b');
});

test('boot shows the cached roster with unknown reachability', () => {
  const raw = persistRoster({items: [item({reachable: true})], sourceId: 'a'});
  const booted = bootRoster(raw);
  assert.equal(booted.items[0]?.reachable, 'unknown');
  assert.equal(booted.items[0]?.displayName, '小B');
  assert.equal(booted.sourceId, 'a');
});

test('a dead source switches and asks to subscribe again', () => {
  const next = loseSource({items: [item()], sourceId: 'a'}, 'a', ['b']);
  assert.equal(next.cache.sourceId, 'b');
  assert.equal(next.resubscribe, true);
  const none = loseSource({items: [item()], sourceId: 'a'}, 'a', ['a']);
  assert.equal(none.cache.sourceId, null);
  assert.equal(none.resubscribe, false);
});

test('a failed probe marks the individual unreachable and blocks a tap', async () => {
  const marked = await probeRoster([item()], async () => false, 30);
  assert.equal(marked[0]?.reachable, false);
  assert.equal(pickerBlocked(marked[0]!), true);
  const open = await probeRoster([item()], async () => true, 30);
  assert.equal(open[0]?.reachable, true);
  assert.equal(pickerBlocked({...open[0]!, mainSessionId: 'sess-b'}), false);
});

test('a dead roster source is replaced by another live connection', () => {
  const cache: CachedRoster = { items: [item()], sourceId: 'a' };
  assert.equal(switchSource(cache, 'a', ['a', 'b']).sourceId, 'b');
  assert.equal(switchSource(cache, 'a', ['a']).sourceId, null);
  assert.equal(switchSource(cache, 'z', ['b']).sourceId, 'a');
});
