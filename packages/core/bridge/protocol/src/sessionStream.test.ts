import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SESSION_STREAM_EVENT_TYPES, isSessionStreamEvent} from './sessionStream.js';

test('SESSION_STREAM catalog covers former four-end drift items', () => {
	for (const type of [
		'question_batch_requested',
		'question_batch_resolved',
		'goal_updated',
		'follow_up_changed',
		'proc_updated',
		'task_updated',
		'child_work_changed',
		'checkpoint',
		'gap',
		'run_state'
	]) {
		assert.equal(isSessionStreamEvent(type), true, type);
	}
});

test('SESSION_STREAM catalog stays sorted and unique', () => {
	const list = [...SESSION_STREAM_EVENT_TYPES];
	assert.deepEqual(list, [...list].sort());
	assert.equal(new Set(list).size, list.length);
});

test('host-level events stay off the session stream', () => {
	for (const type of ['ready', 'sessions_list', 'command_result', 'heartbeat', 'host_error']) {
		assert.equal(isSessionStreamEvent(type), false, type);
	}
});
