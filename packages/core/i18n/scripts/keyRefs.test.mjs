import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {refsInText, scanRoots, classify} from './keyRefs.mjs';

const enKeys = new Set([
  'shell.tabs.diff',
  'shell.tabs.files',
  'settings.b',
  'mobile.connection.idle',
  'mobile.connection.open'
]);

test('quoted keys are collected regardless of quote style', () => {
  assert.deepEqual(refsInText(`t('shell.tabs.diff'); t("settings.b")`, enKeys).sort(), [
    'settings.b',
    'shell.tabs.diff'
  ]);
});

test('dynamic prefixes with a known runtime list expand to that list', () => {
  assert.deepEqual(refsInText('`mobile.connection.${state}`', enKeys).sort(), [
    'mobile.connection.closed',
    'mobile.connection.connecting',
    'mobile.connection.hello',
    'mobile.connection.idle',
    'mobile.connection.open'
  ]);
});

test('dynamic prefixes without a runtime list expand from the catalog', () => {
  assert.deepEqual(refsInText('`shell.tabs.${tab}`', enKeys).sort(), ['shell.tabs.diff', 'shell.tabs.files']);
});

test('dynamic prefixes matching no catalog key are reported as unknown', () => {
  assert.deepEqual(refsInText('`shell.nope.${x}`', enKeys), ['shell.nope.<dynamic>']);
});

test('keys listed as ignore are not reported (engine methods share the settings namespace)', () => {
  const refs = new Map([['settings.describe', ['desktop/main/bridge/dsh/settings.ts']]]);
  assert.deepEqual(classify(refs, enKeys, new Set(['settings.describe'])), {missing: [], unknownDynamic: []});
  assert.deepEqual(
    classify(refs, enKeys).missing.map((entry) => entry.key),
    ['settings.describe']
  );
});

test('every configured root is scanned, not just the first', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'keyrefs-'));
  const mobile = join(tmp, 'mobile');
  const desktop = join(tmp, 'desktop');
  mkdirSync(mobile);
  mkdirSync(desktop);
  writeFileSync(join(mobile, 'one.ts'), `t('shell.tabs.diff')`);
  writeFileSync(join(desktop, 'two.tsx'), `t('shell.typo.key')`);

  const refs = scanRoots(
    [
      {name: 'mobile', dir: mobile},
      {name: 'desktop', dir: desktop}
    ],
    enKeys
  );

  const {missing, unknownDynamic} = classify(refs, enKeys);
  assert.deepEqual(unknownDynamic, []);
  assert.deepEqual(
    missing.map((entry) => entry.key),
    ['shell.typo.key']
  );
  assert.deepEqual(missing[0].files, ['desktop/two.tsx']);
});
