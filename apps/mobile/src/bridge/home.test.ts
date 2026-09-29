import assert from 'node:assert/strict';
import { test } from 'node:test';

import { homeStep, parseHomes, withHome, withoutHome, type Home, type HomeInput } from './home.ts';

const home: Home = { serverId: 's1', projectId: 'p1', sessionId: 'h1' };
const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  connected: true,
  projectId: 'p1',
  projectIds: ['p1'],
  listed: ['h1', 'x'],
  ...over
});

test('recorded home attaches without waiting for the listing', () => {
  assert.deepEqual(homeStep(home, input({ projectIds: null, listed: undefined })), { kind: 'attach', sessionId: 'h1' });
  assert.deepEqual(homeStep(home, input({ listed: undefined })), { kind: 'attach', sessionId: 'h1' });
  assert.deepEqual(homeStep(home, input()), { kind: 'attach', sessionId: 'h1' });
});

test('recorded home still attaches while offline', () => {
  assert.deepEqual(homeStep(home, input({ connected: false })), { kind: 'attach', sessionId: 'h1' });
});

test('home missing from its project listing is recreated', () => {
  assert.deepEqual(homeStep(home, input({ listed: ['x'] })), { kind: 'create', projectId: 'p1' });
});

test('home whose project disappeared is recreated in the current project', () => {
  assert.deepEqual(homeStep(home, input({ projectId: 'p2', projectIds: ['p2'], listed: undefined })), {
    kind: 'create',
    projectId: 'p2'
  });
});

test('no home: create when connected with a project, otherwise wait', () => {
  assert.deepEqual(homeStep(undefined, input()), { kind: 'create', projectId: 'p1' });
  assert.deepEqual(homeStep(undefined, input({ connected: false })), { kind: 'wait' });
  assert.deepEqual(homeStep(undefined, input({ projectId: null })), { kind: 'wait' });
});

test('gone home while offline waits instead of creating', () => {
  assert.deepEqual(homeStep(home, input({ connected: false, listed: [] })), { kind: 'wait' });
});

test('homes are kept per server', () => {
  const two = withHome(withHome({}, home), { serverId: 's2', projectId: 'q', sessionId: 'h2' });
  assert.equal(two.s1?.sessionId, 'h1');
  assert.equal(two.s2?.sessionId, 'h2');
  assert.deepEqual(Object.keys(withoutHome(two, 's1')), ['s2']);
});

test('parseHomes drops malformed rows and bad json', () => {
  assert.deepEqual(parseHomes(null), {});
  assert.deepEqual(parseHomes('{'), {});
  assert.deepEqual(parseHomes(JSON.stringify({ s1: home, s2: { serverId: 's2' } })), { s1: home });
});
