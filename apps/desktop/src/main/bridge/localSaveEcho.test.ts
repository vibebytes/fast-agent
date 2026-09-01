import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isLocalSaveEcho,
	localSaveKey,
	rememberLocalSave
} from './localSaveEcho.js';

test('localSaveKey joins pathHash|path|mtime', () => {
	assert.equal(localSaveKey('abc', 'src/a.ts', 42), 'abc|src/a.ts|42');
});

test('isLocalSaveEcho: connectionId match suppresses client origin', () => {
	const map = new Map<string, number>();
	const r = isLocalSaveEcho(
		map,
		{
			origin: 'client',
			pathHash: 'h',
			relativePath: 'a.txt',
			mtime: 1,
			connectionId: 'conn-1'
		},
		'conn-1',
		1_000
	);
	assert.equal(r.suppress, true);
});

test('isLocalSaveEcho: recent TTL match suppresses and learns connectionId', () => {
	const map = new Map<string, number>();
	rememberLocalSave(map, 'h', 'a.txt', 9, 1_000, 2_000);
	const r = isLocalSaveEcho(
		map,
		{
			origin: 'client',
			pathHash: 'h',
			relativePath: 'a.txt',
			mtime: 9,
			connectionId: 'learned'
		},
		null,
		1_500
	);
	assert.equal(r.suppress, true);
	assert.equal(r.learnConnectionId, 'learned');
});

test('isLocalSaveEcho: expired TTL does not suppress', () => {
	const map = new Map<string, number>();
	rememberLocalSave(map, 'h', 'a.txt', 9, 1_000, 2_000);
	const r = isLocalSaveEcho(
		map,
		{origin: 'client', pathHash: 'h', relativePath: 'a.txt', mtime: 9},
		null,
		4_000
	);
	assert.equal(r.suppress, false);
});

test('isLocalSaveEcho: watch origin suppressed by TTL', () => {
	const map = new Map<string, number>();
	rememberLocalSave(map, 'h', 'a.txt', 9, 1_000, 2_000);
	const r = isLocalSaveEcho(
		map,
		{origin: 'watch', pathHash: 'h', relativePath: 'a.txt', mtime: 9},
		'conn',
		1_100
	);
	assert.equal(r.suppress, true);
});

test('isLocalSaveEcho: agent origin never suppressed', () => {
	const map = new Map<string, number>();
	rememberLocalSave(map, 'h', 'a.txt', 9, 1_000, 2_000);
	const r = isLocalSaveEcho(
		map,
		{origin: 'agent', pathHash: 'h', relativePath: 'a.txt', mtime: 9},
		'conn',
		1_100
	);
	assert.equal(r.suppress, false);
});

test('rememberLocalSave prunes expired keys', () => {
	const map = new Map<string, number>();
	rememberLocalSave(map, 'h', 'old.txt', 1, 1_000, 100);
	rememberLocalSave(map, 'h', 'new.txt', 2, 1_200, 2_000);
	assert.equal(map.has(localSaveKey('h', 'old.txt', 1)), false);
	assert.equal(map.has(localSaveKey('h', 'new.txt', 2)), true);
});
