import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayOf, parseDisplays, toggled, withDisplay } from './display.ts';

test('home defaults to brief, side chats to full', () => {
  assert.equal(displayOf({}, 'h', true), 'brief');
  assert.equal(displayOf({}, 's', false), 'full');
});

test('an explicit choice wins over the default and survives a round trip', () => {
  const prefs = withDisplay({}, 'h', toggled(displayOf({}, 'h', true)));
  assert.equal(displayOf(prefs, 'h', true), 'full');
  assert.deepEqual(parseDisplays(JSON.stringify(prefs)), { h: 'full' });
});

test('parseDisplays keeps only known values', () => {
  assert.deepEqual(parseDisplays(null), {});
  assert.deepEqual(parseDisplays('nope'), {});
  assert.deepEqual(parseDisplays(JSON.stringify({ a: 'brief', b: 'loud', c: 3 })), { a: 'brief' });
});
