import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeHome, homeKey, homeStep, pinIndividual, withHome, type Home } from './home.ts';

test('homes without an agent id stay keyed by server', () => {
  const home: Home = { serverId: 's1', projectId: 'p1', sessionId: 'h1' };
  assert.equal(homeKey(home), 's1');
  assert.equal(withHome({}, home).s1?.sessionId, 'h1');
});

test('a pinned individual stays attached when the new server lists other projects', () => {
  const home: Home = { serverId: 's2', projectId: 'old', sessionId: 'sess-b', agentId: 'agent-b' };
  const step = homeStep(home, { connected: true, projectId: 'new', projectIds: ['new'], listed: [] });
  assert.equal(step.kind, 'attach');
  if (step.kind === 'attach') assert.equal(step.sessionId, 'sess-b');
});

test('the open home follows the selected individual main session', () => {
  const homes = pinIndividual(
    {},
    { serverId: 's1', projectId: 'p1', agentId: 'agent-b', mainSessionId: 'sess-b' }
  );
  assert.equal(activeHome(homes, 's1', 'agent-b')?.sessionId, 'sess-b');
  assert.equal(activeHome(homes, 's1', null)?.sessionId, undefined);
});

test('homes with an agent id are stored per individual', () => {
  const a: Home = { serverId: 's1', projectId: 'p1', sessionId: 'h1', agentId: 'agent-a' };
  const b: Home = { serverId: 's1', projectId: 'p1', sessionId: 'h2', agentId: 'agent-b' };
  const homes = withHome(withHome({}, a), b);
  assert.equal(homes['agent-a']?.sessionId, 'h1');
  assert.equal(homes['agent-b']?.sessionId, 'h2');
});
