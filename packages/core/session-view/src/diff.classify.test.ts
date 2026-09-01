import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyToolActivity, isWriteTool} from './diff.js';

test('isWriteTool / classify edited: exact write names including FILE_EDIT', () => {
	const writes = [
		'write',
		'edit',
		'create',
		'apply_patch',
		'applyPatch',
		'search_replace',
		'str_replace',
		'file_write',
		'write_file',
		'file_edit',
		'edit_file',
		'FILE_EDIT'
	];
	for (const tool of writes) {
		assert.equal(classifyToolActivity(tool), 'edited', tool);
		assert.equal(isWriteTool(tool), true, tool);
	}
});

test('isWriteTool rejects substring lookalikes and explore tools', () => {
	assert.equal(isWriteTool('my_file_edit_x'), false);
	assert.equal(classifyToolActivity('my_file_edit_x'), 'other');
	assert.equal(isWriteTool('read_file'), false);
	assert.equal(classifyToolActivity('read_file'), 'explored');
	assert.equal(classifyToolActivity('grep'), 'searched');
	assert.equal(classifyToolActivity('web_fetch'), 'fetched');
});
