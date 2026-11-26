import assert from 'node:assert/strict';
import test from 'node:test';
import {pathLabel} from './path';

test('pathLabel splits name and shortens a long directory', () => {
	assert.deepEqual(pathLabel('data/A客户/skill-to-rl-env/output/GOOGL_2026_x.py'), {
		name: 'GOOGL_2026_x.py',
		dir: 'data/…/output'
	});
});

test('pathLabel keeps short directories intact', () => {
	assert.deepEqual(pathLabel('a/b/c.txt'), {name: 'c.txt', dir: 'a/b'});
	assert.deepEqual(pathLabel('c.txt'), {name: 'c.txt', dir: ''});
});

test('pathLabel collapses only the middle of deep paths', () => {
	assert.deepEqual(pathLabel('a/b/c/d/e.txt'), {name: 'e.txt', dir: 'a/…/d'});
});
