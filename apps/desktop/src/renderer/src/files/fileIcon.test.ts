import test from 'node:test';
import assert from 'node:assert/strict';
import {fileIconId} from './fileIcon.js';

test('fileIconId resolves common names and extensions', () => {
	assert.equal(fileIconId('app.tsx'), 'react_ts');
	assert.equal(fileIconId('.gitignore'), 'git');
	assert.ok(fileIconId('package.json'));
	assert.ok(fileIconId('README.md'));
	assert.equal(fileIconId('totally-unknown.zzzzzz'), 'file');
});
