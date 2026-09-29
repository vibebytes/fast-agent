import assert from 'node:assert/strict';
import {test} from 'node:test';

import {statusLineOf, type StatusFacts} from './status-line.ts';

const calm: StatusFacts = {offline: false, leaseNotice: null, lockedWithoutCard: false, queued: false, runState: 'idle'};

test('nothing to say is no line', () => {
  assert.equal(statusLineOf(calm), null);
});

test('offline beats every other fact', () => {
  const line = statusLineOf({offline: true, leaseNotice: 'x', lockedWithoutCard: true, queued: true, runState: 'running'});
  assert.deepEqual(line, {kind: 'offline'});
});

test('lease beats decision, queued and running', () => {
  const line = statusLineOf({...calm, leaseNotice: 'taken', lockedWithoutCard: true, queued: true, runState: 'running'});
  assert.deepEqual(line, {kind: 'lease', notice: 'taken'});
});

test('queued beats running', () => {
  assert.deepEqual(statusLineOf({...calm, queued: true, runState: 'running'}), {kind: 'queued'});
});

test('stopping is still the running line', () => {
  assert.deepEqual(statusLineOf({...calm, runState: 'stopping'}), {kind: 'running', stopping: true});
});
