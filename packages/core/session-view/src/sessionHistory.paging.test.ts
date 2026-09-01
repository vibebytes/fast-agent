import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyBridgeEvent,
	createTranscriptState,
	oldestLoadedTurnId
} from './index.js';

test('session_restored records hasMoreOlder and totalTurnCount', () => {
	const state = applyBridgeEvent(createTranscriptState(), {
		type: 'session_restored',
		sessionId: 's1',
		hasMoreOlder: true,
		totalTurnCount: 40,
		turns: [
			{
				turnId: 'restored_20',
				userText: 'recent',
				assistantText: 'ok',
				tools: []
			}
		]
	});
	assert.equal(state.hasMoreOlder, true);
	assert.equal(state.totalTurnCount, 40);
	assert.equal(oldestLoadedTurnId(state), 'restored_20');
});

test('session_history_page prepends older Turns and updates hasMoreOlder', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'session_restored',
		sessionId: 's1',
		hasMoreOlder: true,
		totalTurnCount: 3,
		turns: [
			{turnId: 'restored_1', userText: 'mid', assistantText: 'm', tools: []},
			{turnId: 'restored_2', userText: 'new', assistantText: 'n', tools: []}
		]
	});
	assert.equal(oldestLoadedTurnId(state), 'restored_1');

	state = applyBridgeEvent(state, {
		type: 'session_history_page',
		sessionId: 's1',
		beforeTurnId: 'restored_1',
		hasMoreOlder: false,
		totalTurnCount: 3,
		turns: [{turnId: 'restored_0', userText: 'old', assistantText: 'o', tools: []}]
	});

	assert.equal(state.hasMoreOlder, false);
	assert.equal(state.totalTurnCount, 3);
	assert.equal(oldestLoadedTurnId(state), 'restored_0');
	assert.deepEqual(
		state.entries.filter(e => e.role === 'user').map(e => e.turnId),
		['restored_0', 'restored_1', 'restored_2']
	);
	// Live tail entries stay after prepended history.
	assert.equal(state.entries.at(-1)?.turnId, 'restored_2');
});

test('session_history_page does not duplicate already-loaded Turns', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'session_restored',
		sessionId: 's1',
		hasMoreOlder: true,
		totalTurnCount: 2,
		turns: [{turnId: 'restored_1', userText: 'a', assistantText: 'b', tools: []}]
	});
	state = applyBridgeEvent(state, {
		type: 'session_history_page',
		sessionId: 's1',
		beforeTurnId: 'restored_1',
		hasMoreOlder: false,
		totalTurnCount: 2,
		turns: [{turnId: 'restored_1', userText: 'a', assistantText: 'b', tools: []}]
	});
	assert.equal(state.entries.filter(e => e.role === 'user').length, 1);
});
