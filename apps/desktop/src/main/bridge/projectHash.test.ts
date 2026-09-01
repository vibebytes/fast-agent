import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {projectHash} from './projectHash.js';

test('projectHash is stable for the same absolute path', () => {
	const root = path.resolve('/tmp/fast-ide-hash-fixture');
	assert.equal(projectHash(root), projectHash(root));
	assert.equal(projectHash(root).length, 12);
});

test('projectHash differs for distinct directory roots', () => {
	assert.notEqual(
		projectHash(path.resolve('/tmp/proj-alpha')),
		projectHash(path.resolve('/tmp/proj-beta'))
	);
});
