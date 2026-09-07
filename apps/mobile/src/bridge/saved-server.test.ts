import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inferTransport, upsertServer } from './saved-server.ts';

test('inferTransport maps host kinds to transport/trust', () => {
  assert.deepEqual(inferTransport('wss://192.168.1.10:1979/bridge'), { transport: 'lan', trust: 'pinned' });
  assert.deepEqual(inferTransport('ws://my-mac.local:1979/bridge'), { transport: 'lan', trust: 'pinned' });
  assert.deepEqual(inferTransport('wss://localhost:1979/bridge'), { transport: 'lan', trust: 'pinned' });
  assert.deepEqual(inferTransport('wss://machine.tail1234.ts.net/bridge'), {
    transport: 'tailscale',
    trust: 'pinned'
  });
  assert.deepEqual(inferTransport('wss://abc-123.trycloudflare.com/bridge'), {
    transport: 'cloudflare',
    trust: 'public'
  });
  assert.deepEqual(inferTransport('wss://myhost.example.com/bridge'), {
    transport: 'cloudflare',
    trust: 'public'
  });
  assert.deepEqual(inferTransport('not a url'), { transport: 'lan', trust: 'pinned' });
});

const cfEntry = (over: Partial<typeof base>) => ({ ...base, ...over });
const base = {
  id: 'a1',
  label: 'Desktop',
  serverUrl: 'wss://old.trycloudflare.com/bridge',
  token: 't1',
  fingerprint: null,
  transport: 'cloudflare' as const,
  trust: 'public' as const
};

test('upsertServer matches by serverKey and preserves label/lastConnectedAt', () => {
  const existing = cfEntry({ serverKey: 'k1', label: 'My Desktop', lastConnectedAt: 123 });
  const { servers, id } = upsertServer(
    [existing],
    {
      serverUrl: 'wss://new.trycloudflare.com/bridge',
      token: 't2',
      fingerprint: null,
      transport: 'cloudflare',
      trust: 'public',
      serverKey: 'k1'
    },
    'n1'
  );
  assert.equal(id, 'a1');
  assert.equal(servers.length, 1);
  assert.equal(servers[0].label, 'My Desktop');
  assert.equal(servers[0].serverUrl, 'wss://new.trycloudflare.com/bridge');
  assert.equal(servers[0].lastConnectedAt, 123);
  assert.equal(servers[0].serverKey, 'k1');
});

test('upsertServer keeps other desktops keyed entries when a new serverKey appears', () => {
  const k1 = cfEntry({ id: 'a1', serverKey: 'k1' });
  const { servers, id } = upsertServer(
    [k1],
    {
      label: 'Other Desktop',
      serverUrl: 'wss://other.trycloudflare.com/bridge',
      token: 't2',
      fingerprint: null,
      transport: 'cloudflare',
      trust: 'public',
      serverKey: 'k2'
    },
    'n1'
  );
  assert.equal(id, 'n1');
  assert.equal(servers.length, 2);
  assert.ok(servers.some((s) => s.serverKey === 'k1'));
  assert.ok(servers.some((s) => s.serverKey === 'k2'));
});

test('upsertServer legacy no-key scan replaces the unkeyed slot and keeps keyed entries', () => {
  const legacy = cfEntry({ id: 'a1' });
  const staleLegacy = cfEntry({ id: 'a3', serverUrl: 'wss://older.trycloudflare.com/bridge' });
  const keyed = cfEntry({ id: 'a2', serverKey: 'k1' });
  const { servers, id } = upsertServer(
    [legacy, staleLegacy, keyed],
    {
      label: 'Desktop',
      serverUrl: 'wss://fresh.trycloudflare.com/bridge',
      token: 't9',
      fingerprint: null,
      transport: 'cloudflare',
      trust: 'public'
    },
    'n1'
  );
  assert.equal(id, 'a1');
  assert.equal(servers.length, 2);
  assert.ok(servers.some((s) => s.id === 'a2' && s.serverKey === 'k1'));
  assert.ok(!servers.some((s) => s.id === 'a3'));
  assert.equal(servers.find((s) => s.id === 'a1')?.serverUrl, 'wss://fresh.trycloudflare.com/bridge');
});

test('upsertServer explicit id update leaves other cloudflare entries untouched', () => {
  const lan = {
    id: 'lan1',
    label: 'LAN',
    serverUrl: 'wss://192.168.1.10:1979/bridge',
    token: 't1',
    fingerprint: 'aa:bb',
    transport: 'lan' as const,
    trust: 'pinned' as const
  };
  const keyed = cfEntry({ id: 'a2', serverKey: 'k1' });
  const { servers, id } = upsertServer(
    [lan, keyed],
    {
      id: 'lan1',
      serverUrl: 'wss://192.168.1.20:1979/bridge',
      token: 't2',
      fingerprint: 'cc:dd',
      transport: 'lan',
      trust: 'pinned'
    },
    'n1'
  );
  assert.equal(id, 'lan1');
  assert.equal(servers.length, 2);
  assert.equal(servers.find((s) => s.id === 'lan1')?.serverUrl, 'wss://192.168.1.20:1979/bridge');
  assert.ok(servers.some((s) => s.id === 'a2'));
});
