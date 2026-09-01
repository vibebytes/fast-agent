import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {defaultProjectPath, defaultProjectPathOnHost, isDefaultProjectPath} from './defaultProject.js';

test('defaultProjectPath is $HOME/fast_workspace/.default_project (Tasks mount)', () => {
	const home = '/Users/test';
	assert.equal(defaultProjectPath(home), path.join(home, 'fast_workspace', '.default_project'));
});

test('defaultProjectPathOnHost is POSIX and ignores a trailing slash', () => {
	assert.equal(defaultProjectPathOnHost('/home/kai/'), '/home/kai/fast_workspace/.default_project');
	assert.equal(defaultProjectPathOnHost('/home/kai'), '/home/kai/fast_workspace/.default_project');
});

test('isDefaultProjectPath accepts only the canonical Tasks root', () => {
	const home = mkdtempSync(path.join(tmpdir(), 'default-proj-'));
	const canonical = defaultProjectPath(home);
	mkdirSync(canonical, {recursive: true});
	assert.equal(isDefaultProjectPath(canonical, home), true);
	assert.equal(isDefaultProjectPath(path.join(home, 'fast_workspace'), home), false);
	assert.equal(isDefaultProjectPath(path.join(home, 'code', 'agent_work'), home), false);
	assert.equal(
		isDefaultProjectPath(path.join(home, 'Documents', 'fast_workspace', '.default_project'), home),
		false
	);
});
