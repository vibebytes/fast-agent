import assert from 'node:assert/strict';
import test from 'node:test';
import {taskChrome} from './modelSettings.js';

test('taskChrome resolves per-task runMode/effort/thinking without backfilling sampling', () => {
	const fallback = {runMode: 'yolo' as const, effort: 'high', thinking: false};
	assert.deepEqual(taskChrome({runMode: 'agent', effort: 'low', thinking: true}, fallback), {
		runMode: 'agent',
		effort: 'low',
		thinking: true
	});
	assert.deepEqual(taskChrome({}, fallback), {
		runMode: 'yolo',
		effort: undefined,
		thinking: undefined
	});
	assert.deepEqual(taskChrome(null, fallback), {
		runMode: 'yolo',
		effort: 'high',
		thinking: false
	});
});
