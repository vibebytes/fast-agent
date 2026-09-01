import test from 'node:test';
import assert from 'node:assert/strict';
import {openDialog, closeDialog, initialDialogState, moveSelection} from './dialogState.js';

test('dialog stack opens and closes', () => {
	let state = openDialog(initialDialogState, {type: 'shortcuts'});
	assert.equal(state.active?.type, 'shortcuts');
	state = openDialog(state, {type: 'theme', selected: 0});
	assert.equal(state.active?.type, 'theme');
	state = closeDialog(state);
	assert.equal(state.active?.type, 'shortcuts');
});

test('moveSelection wraps', () => {
	assert.equal(moveSelection(0, 3, 'up'), 2);
	assert.equal(moveSelection(2, 3, 'down'), 0);
});

test('dialog stack remains consistent under rapid help/session open-close', () => {
	let state = initialDialogState;
	state = openDialog(state, {type: 'help', commands: []});
	state = openDialog(state, {type: 'sessionBrowser', selected: 0});
	state = openDialog(state, {type: 'shortcuts'});
	assert.equal(state.active?.type, 'shortcuts');

	state = closeDialog(state);
	assert.equal(state.active?.type, 'sessionBrowser');
	state = closeDialog(state);
	assert.equal(state.active?.type, 'help');
	state = closeDialog(state);
	assert.equal(state.active, undefined);
	assert.equal(state.stack.length, 0);
});
