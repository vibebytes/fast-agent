import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	queueClearCommands,
	queueEditCommands,
	queuePauseCommand,
	queueRemoveCommands,
	queueReorderCommands,
	queueSteerPlan
} from './runQueue.js';

const host = (items: string[]) => ({queue: items.map((text, i) => ({id: `q${i}`, text}))});

test('queueRemoveCommands dsh path requires membership and emits Queue remove', () => {
	const src = {queue: [], dshCaps: {queue: true, goal: false, budget: false, question: false, slash: false}, dshQueue: [{id: 'a', placement: 'queued', text: 'x'} as never]};
	assert.deepEqual(queueRemoveCommands(src, 's', 'a'), [{type: 'Queue', sessionId: 's', itemId: 'a', action: 'remove'}]);
	assert.deepEqual(queueRemoveCommands(src, 's', 'missing'), []);
});

test('queueRemoveCommands host path validates queue membership', () => {
	assert.deepEqual(queueRemoveCommands(host(['hi']), 's', 'q0'), [{type: 'FollowUpRemove', sessionId: 's', itemId: 'q0'}]);
	assert.deepEqual(queueRemoveCommands(host([]), 's', 'q0'), []);
});

test('queueClearCommands filters dsh context placement and empty host queue', () => {
	const src = {queue: [], dshCaps: {queue: true, goal: false, budget: false, question: false, slash: false}, dshQueue: [
		{id: 'a', placement: 'queued', text: '1'},
		{id: 'b', placement: 'context', text: '2'}
	] as never};
	assert.deepEqual(queueClearCommands(src, 's'), [{type: 'Queue', sessionId: 's', itemId: 'a', action: 'remove'}]);
	assert.deepEqual(queueClearCommands(host([]), 's'), []);
	assert.deepEqual(queueClearCommands(host(['x']), 's'), [{type: 'FollowUpRemove', sessionId: 's', itemId: 'q0'}]);
});

test('queueReorderCommands bounds + no-op rejection', () => {
	const src = host(['a', 'b']);
	assert.deepEqual(queueReorderCommands(src, 's', 0, 1), [{type: 'FollowUpReorder', sessionId: 's', fromIndex: 0, toIndex: 1}]);
	assert.deepEqual(queueReorderCommands(src, 's', 1, 1), []);
	assert.deepEqual(queueReorderCommands(src, 's', -1, 0), []);
	assert.deepEqual(queueReorderCommands(src, 's', 0, 2), []);
});

test('queueEditCommands trims text and routes by caps', () => {
	const src = {queue: host(['old']).queue, dshCaps: {queue: true, goal: false, budget: false, question: false, slash: false}, dshQueue: [{id: 'a', placement: 'queued', text: 'old'} as never]};
	assert.deepEqual(queueEditCommands(src, 's', 'a', ' new '), [{type: 'Queue', sessionId: 's', itemId: 'a', action: 'edit', text: 'new'}]);
	assert.deepEqual(queueEditCommands(host(['old']), 's', 'q0', '  '), []);
	const hostSrc = host(['old']);
	assert.deepEqual(queueEditCommands(hostSrc, 's', 'q0', 'new'), [{type: 'FollowUpUpdate', sessionId: 's', itemId: 'q0', text: 'new'}]);
	assert.deepEqual(queueEditCommands(hostSrc, 's', 'zz', 'new'), []);
});

test('queuePauseCommand always emits FollowUpPause', () => {
	assert.deepEqual(queuePauseCommand('s', true), {type: 'FollowUpPause', sessionId: 's', paused: true});
});

test('queueSteerPlan covers dsh / host / missing', () => {
	const dshSrc = {queue: [], dshCaps: {queue: true, goal: false, budget: false, question: false, slash: false}, dshQueue: [{id: 'a', placement: 'steering', text: 'go'} as never]};
	assert.deepEqual(queueSteerPlan(dshSrc, 'a'), {kind: 'dsh'});
	assert.deepEqual(queueSteerPlan(dshSrc, 'zz'), null);
	assert.deepEqual(queueSteerPlan(host(['go']), 'q0'), {kind: 'interrupt', text: 'go'});
	assert.deepEqual(queueSteerPlan(host([]), 'q0'), null);
});
