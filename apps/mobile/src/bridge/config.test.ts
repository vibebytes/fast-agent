import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');

test('config persists under bridge.config.v3 and migrates from v2', () => {
  assert.match(source, /const KEY = 'bridge\.config\.v3'/);
  assert.match(source, /const LEGACY_KEY = 'bridge\.config\.v2'/);
  assert.match(source, /raw = await storageGet\(LEGACY_KEY\)/);
});

test('config backfills transport/trust via inferTransport and flags migration', () => {
  assert.match(source, /const inferred = inferTransport\(server\.serverUrl\)/);
  assert.match(source, /if \(!server\.transport \|\| !server\.trust\) migrated = true/);
  assert.match(source, /if \(migrated\) await saveBridgeConfig\(config\)/);
});

test('config re-exports inferTransport from the pure saved-server module', () => {
  assert.match(source, /import \{ inferTransport, type SavedServerTransport \} from '\.\/saved-server'/);
  assert.match(source, /export \{ inferTransport \}/);
});

test('saveBridgeConfig strips tokens before persisting', () => {
  const fn = source.slice(source.indexOf('export async function saveBridgeConfig'));
  assert.match(fn, /writeToken\(server\.id, server\.token\)/);
  const stripped = fn.slice(fn.indexOf('const stripped'), fn.indexOf('await storageSet'));
  assert.doesNotMatch(stripped, /token/);
});
