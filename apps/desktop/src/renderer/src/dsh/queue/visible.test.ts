import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dockOpen, inboxItems, steeringItems} from './visible.js';
import type {DshQueueItem} from '../../env';

const queued: DshQueueItem = {id: 'a', placement: 'queued', text: 'one'};
const steering: DshQueueItem = {id: 'b', placement: 'steering', text: 'two'};
const context: DshQueueItem = {id: 'c', placement: 'context', text: 'hidden'};

test('context items are not inbox or steering', () => {
	const items = [queued, steering, context];
	assert.deepEqual(inboxItems(items).map(i => i.id), ['a']);
	assert.deepEqual(steeringItems(items).map(i => i.id), ['b']);
});

test('empty array clears the dock; queue:false never opens', () => {
	assert.equal(dockOpen(true, []), false);
	assert.equal(dockOpen(false, [queued]), false);
	assert.equal(dockOpen(undefined, [queued]), false);
	assert.equal(dockOpen(true, [queued]), true);
	assert.equal(dockOpen(true, [steering]), true);
	assert.equal(dockOpen(true, [context]), false);
});
