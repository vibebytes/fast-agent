import assert from 'node:assert/strict';
import test from 'node:test';
import {taskSampling} from './modelSettings.js';

test('taskSampling uses the task record without backfilling from active chrome', () => {
	const activeChrome = {effort: 'high', thinking: false};
	assert.deepEqual(taskSampling({effort: 'low', thinking: true}, activeChrome), {
		effort: 'low',
		thinking: true
	});
	assert.deepEqual(taskSampling({}, activeChrome), {effort: undefined, thinking: undefined});
	assert.deepEqual(taskSampling(null, activeChrome), {effort: 'high', thinking: false});
});
