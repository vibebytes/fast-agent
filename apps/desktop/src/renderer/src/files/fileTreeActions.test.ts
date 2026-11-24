import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createWorkspaceFile,
	deleteWorkspaceEntry,
	newFilePath,
	parentDirOf,
	prunedPaths,
	type FileTreeEntry
} from './fileTreeActions.js';

const dir: FileTreeEntry = {name: 'src', kind: 'dir', relativePath: 'src'};
const file: FileTreeEntry = {name: 'App.ts', kind: 'file', relativePath: 'src/App.ts'};

test('new files target the clicked directory or the clicked file sibling directory', () => {
	assert.equal(newFilePath(dir, 'New.ts'), 'src/New.ts');
	assert.equal(newFilePath(file, 'New.ts'), 'src/New.ts');
	assert.equal(newFilePath({...file, relativePath: 'App.ts'}, 'New.ts'), 'New.ts');
});

test('new file names cannot escape into another path', () => {
	for (const name of ['', '../New.ts', 'nested/New.ts', 'nested\\New.ts', '.', '..']) {
		assert.throws(() => newFilePath(dir, name));
	}
});

test('createWorkspaceFile creates an empty file without a CAS cursor', async () => {
	const calls: unknown[][] = [];
	const result = await createWorkspaceFile(dir, 'New.ts', {
		saveWorkspaceFile: async (...args: unknown[]) => {
			calls.push(args);
			return {ok: true, relativePath: 'src/New.ts', mtime: 1, bytes: 0};
		}
	});
	assert.equal(result.ok, true);
	assert.deepEqual(calls, [['src/New.ts', '', undefined, undefined]]);
});

test('cancelling delete confirmation never calls the workspace API', async () => {
	let calls = 0;
	const result = await deleteWorkspaceEntry(dir, async () => false, {
		deleteWorkspaceFile: async () => {
			calls += 1;
			return {ok: true, relativePath: 'src'};
		}
	});
	assert.equal(result, null);
	assert.equal(calls, 0);
});

test('confirmed directory deletion explicitly requests recursive deletion', async () => {
	const calls: unknown[][] = [];
	const result = await deleteWorkspaceEntry(dir, async () => true, {
		deleteWorkspaceFile: async (...args: unknown[]) => {
			calls.push(args);
			return {ok: true, relativePath: 'src'};
		}
	});
	assert.equal(result?.ok, true);
	assert.deepEqual(calls, [['src', true]]);
});

test('confirmed file deletion is not recursive', async () => {
	const calls: unknown[][] = [];
	await deleteWorkspaceEntry(file, async () => true, {
		deleteWorkspaceFile: async (...args: unknown[]) => {
			calls.push(args);
			return {ok: true, relativePath: file.relativePath};
		}
	});
	assert.deepEqual(calls, [['src/App.ts', false]]);
});

test('an IPC rejection maps to a failed delete result instead of an unhandled rejection', async () => {
	const result = await deleteWorkspaceEntry(dir, async () => true, {
		deleteWorkspaceFile: async () => {
			throw new Error('ipc bridge down');
		}
	});
	assert.deepEqual(result, {ok: false, error: 'ipc bridge down'});
});

test('parentDirOf returns the directory that holds a mutated path', () => {
	assert.equal(parentDirOf('src/App.ts'), 'src');
	assert.equal(parentDirOf('App.ts'), '.');
	assert.equal(parentDirOf('src'), '.');
	assert.equal(parentDirOf('src/sub'), 'src');
	assert.equal(parentDirOf('src/'), '.');
	assert.equal(parentDirOf('./src/App.ts'), 'src');
});

test('prunedPaths drops the deleted directory and everything under it', () => {
	const expanded = new Set(['a', 'a/b', 'a/b/c', 'keep', 'a-keep']);
	assert.deepEqual([...prunedPaths(expanded, 'a')].sort(), ['a-keep', 'keep']);
	assert.deepEqual([...prunedPaths(new Set(['a', 'b']), '.')].sort(), ['a', 'b']);
	assert.deepEqual([...prunedPaths(new Set(['a']), 'missing')], ['a']);
});
