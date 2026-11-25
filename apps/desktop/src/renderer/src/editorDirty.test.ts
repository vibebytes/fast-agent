import assert from 'node:assert/strict';
import test from 'node:test';
import {EditorDirtyBaseline, sameEditorText} from './editorDirty';

test('programmatic disk reload is not a user edit', () => {
	const baseline = new EditorDirtyBaseline('v0');
	baseline.programmatic('v1');
	assert.equal(baseline.isUserEdit('v1'), false);
});

test('typing that diverges from the seed is a user edit', () => {
	const baseline = new EditorDirtyBaseline('v0');
	assert.equal(baseline.isUserEdit('typed'), true);
	assert.equal(baseline.isUserEdit('v0'), false);
});

test('render sync after a reload keeps the reloaded baseline', () => {
	const baseline = new EditorDirtyBaseline('v0');
	baseline.programmatic('v1');
	baseline.sync('v1');
	assert.equal(baseline.isUserEdit('v1'), false);
});

test('sameEditorText ignores CRLF/LF differences', () => {
	assert.equal(sameEditorText('a\r\nb', 'a\nb'), true);
	assert.equal(sameEditorText('a', 'b'), false);
});
