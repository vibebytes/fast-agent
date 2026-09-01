import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {replayEvents, snapshotTimeline, keyInput} from './fixtures.js';
import {FIXTURE_TURN_FLOW, FIXTURE_TASK_LIFECYCLE} from '../fixtures/bridgeEvents.js';
import {matchKeybinding, Command} from '../input/keybindings.js';

test('replayEvents rebuilds timeline from bridge fixtures', () => {
	let state = reducer(initialState, {type: 'submit_user', text: 'hello', clientMessageId: 'client_1'});
	state = replayEvents(FIXTURE_TURN_FLOW, state);
	const timeline = snapshotTimeline(state);
	assert.ok(timeline.some(line => line.startsWith('tool_group:')));
});

test('replayEvents handles run lifecycle events', () => {
	const state = replayEvents(FIXTURE_TASK_LIFECYCLE);
	assert.equal(state.status, 'run done');
});

test('keyInput helper drives keybinding matcher', () => {
	const cmd = matchKeybinding(keyInput('c', {ctrl: true}));
	assert.equal(cmd, Command.CANCEL_TASK);
});
