import test from 'node:test';
import assert from 'node:assert/strict';
import {codeChangesKey} from './codeChangesKey.js';
import type {CodeChange} from './env';

function change(id: string, status: CodeChange['status']): CodeChange {
	return {id, path: `src/${id}.ts`, tool: 'edit', status};
}

test('empty list has stable empty key', () => {
	assert.equal(codeChangesKey([]), '');
	assert.equal(codeChangesKey([]), codeChangesKey([]));
});

test('same content yields same key across array identities', () => {
	const a = [change('c1', 'done'), change('c2', 'running')];
	const b = [change('c1', 'done'), change('c2', 'running')];
	assert.notEqual(a, b);
	assert.equal(codeChangesKey(a), codeChangesKey(b));
});

test('new change or status settle changes the key', () => {
	const base = [change('c1', 'running')];
	const settled = [change('c1', 'done')];
	const appended = [change('c1', 'done'), change('c2', 'running')];
	assert.notEqual(codeChangesKey(base), codeChangesKey(settled));
	assert.notEqual(codeChangesKey(settled), codeChangesKey(appended));
});
