import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCodeChangeEvent, createCodeChangesState} from './codeChangesProjection.js';

test('Code Changes stays empty for non-write Bridge events (placeholder)', () => {
	let state = createCodeChangesState();
	state = applyCodeChangeEvent(state, {
		type: 'assistant_delta',
		text: 'hello'
	});
	state = applyCodeChangeEvent(state, {
		type: 'tool_started',
		id: 't1',
		tool: 'read_file',
		args: {path: 'src/a.ts'}
	});
	assert.equal(state.entries.length, 0);
});

test('Code Changes projects write-like tools with path and optional diff', () => {
	let state = createCodeChangesState();
	state = applyCodeChangeEvent(state, {
		type: 'tool_started',
		id: 'w1',
		tool: 'write',
		args: {path: 'src/App.tsx', description: 'Add button'}
	});
	assert.equal(state.entries.length, 1);
	assert.equal(state.entries[0]?.path, 'src/App.tsx');
	assert.equal(state.entries[0]?.status, 'running');

	state = applyCodeChangeEvent(state, {
		type: 'tool_finished',
		id: 'w1',
		tool: 'write',
		success: true,
		fields: {
			path: 'src/App.tsx',
			diff: '@@ -1 +1 @@\n-old\n+new\n',
			summary: 'updated App'
		}
	});
	assert.equal(state.entries.length, 1);
	assert.equal(state.entries[0]?.status, 'done');
	assert.equal(state.entries[0]?.diff?.includes('+new'), true);
	assert.equal(state.entries[0]?.summary, 'updated App');
});

test('Code Changes accepts FILE_EDIT and rejects substring lookalike tools', () => {
	let state = createCodeChangesState();
	state = applyCodeChangeEvent(state, {
		type: 'tool_started',
		id: 'fe',
		tool: 'FILE_EDIT',
		args: {path: 'a.ts'}
	});
	assert.equal(state.entries.length, 1);
	state = applyCodeChangeEvent(state, {
		type: 'tool_started',
		id: 'fake',
		tool: 'my_file_edit_x',
		args: {path: 'b.ts'}
	});
	assert.equal(state.entries.length, 1, 'substring lookalike must not enter Code Changes');
});
