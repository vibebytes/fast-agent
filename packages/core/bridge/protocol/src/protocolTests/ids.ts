/** protocol.test — ids. Loaded by protocol.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, bridgeCommandSchema, isLiveChrome, parseBridgeCommand, pickIdList, wireIdList} from '../protocol.js';

test('wireIdList dual-reads JSON array, CSV, and empty', () => {
	assert.deepEqual(wireIdList(['bull', 'bear', 'bull']), ['bear', 'bull']);
	assert.deepEqual(wireIdList('bull, bear'), ['bear', 'bull']);
	assert.deepEqual(wireIdList(''), []);
	assert.deepEqual(pickIdList(['a'], 'b,c'), ['a']);
	assert.deepEqual(pickIdList(undefined, 'b,c'), ['b', 'c']);
});
