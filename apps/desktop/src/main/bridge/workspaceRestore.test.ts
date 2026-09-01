import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	initialWorkspaceRestoreState,
	reduceWorkspaceRestore,
	RESTORE_TIMEOUT_MS,
	type WorkspaceRestoreCommand,
	type WorkspaceRestoreState
} from './workspaceRestore.js';

function fold(
	events: Parameters<typeof reduceWorkspaceRestore>[1][]
): {state: WorkspaceRestoreState; commands: WorkspaceRestoreCommand[]} {
	let state = initialWorkspaceRestoreState();
	const commands: WorkspaceRestoreCommand[] = [];
	for (const event of events) {
		const next = reduceWorkspaceRestore(state, event);
		state = next.state;
		commands.push(...next.commands);
	}
	return {state, commands};
}

test('start ensures Engine and arms timeout (no prefs fallback)', () => {
	const {state, commands} = fold([{type: 'start'}]);
	assert.equal(state.done, false);
	assert.equal(state.failed, false);
	assert.deepEqual(commands, [
		{type: 'ensureEngine'},
		{type: 'armTimeout', ms: RESTORE_TIMEOUT_MS}
	]);
});

test('metaApplied seals restore and publishes restored', () => {
	const {state, commands} = fold([{type: 'start'}, {type: 'metaApplied'}]);
	assert.equal(state.done, true);
	assert.equal(state.failed, false);
	assert.deepEqual(commands, [
		{type: 'ensureEngine'},
		{type: 'armTimeout', ms: RESTORE_TIMEOUT_MS},
		{type: 'clearTimeout'},
		{type: 'publishRestored'}
	]);
});

test('timeout before meta fails restore once', () => {
	const {state, commands} = fold([{type: 'start'}, {type: 'timeout'}]);
	assert.equal(state.done, true);
	assert.equal(state.failed, true);
	assert.ok(commands.some(c => c.type === 'publishFailed'));
	const failed = commands.find(c => c.type === 'publishFailed');
	assert.equal(failed?.type, 'publishFailed');
	if (failed?.type === 'publishFailed') {
		assert.match(failed.reason, /timed out/i);
	}
});

test('timeout after metaApplied is a no-op', () => {
	const after = fold([{type: 'start'}, {type: 'metaApplied'}]);
	const late = reduceWorkspaceRestore(after.state, {type: 'timeout'});
	assert.equal(late.state.done, true);
	assert.equal(late.state.failed, false);
	assert.deepEqual(late.commands, []);
});

test('engineFailed before meta fails restore', () => {
	const {state, commands} = fold([
		{type: 'start'},
		{type: 'engineFailed', message: 'spawn failed'}
	]);
	assert.equal(state.done, true);
	assert.equal(state.failed, true);
	assert.deepEqual(
		commands.filter(c => c.type === 'publishFailed'),
		[{type: 'publishFailed', reason: 'spawn failed'}]
	);
});

test('late metaApplied after success still republishes restored', () => {
	const after = fold([{type: 'start'}, {type: 'metaApplied'}]);
	const late = reduceWorkspaceRestore(after.state, {type: 'metaApplied'});
	assert.equal(late.state.done, true);
	assert.deepEqual(late.commands, [
		{type: 'clearTimeout'},
		{type: 'publishRestored'}
	]);
});

test('late metaApplied after timeout still publishes restored (clears sticky fail path)', () => {
	const after = fold([{type: 'start'}, {type: 'timeout'}]);
	assert.equal(after.state.failed, true);
	const late = reduceWorkspaceRestore(after.state, {type: 'metaApplied'});
	assert.equal(late.state.done, true);
	assert.equal(late.state.failed, false);
	assert.deepEqual(late.commands, [
		{type: 'clearTimeout'},
		{type: 'publishRestored'}
	]);
});
