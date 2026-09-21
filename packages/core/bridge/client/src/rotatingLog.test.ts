import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRotatingLogStream} from './rotatingLog.js';

const write = (s: NodeJS.WritableStream, data: string) =>
	new Promise<void>((res, rej) => s.write(data, err => (err ? rej(err) : res())));
const end = (s: NodeJS.WritableStream) => new Promise<void>(res => s.end(res));

test('rotates at maxBytes and keeps at most `keep` archives', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rotlog-'));
	const file = path.join(dir, 'daemon.out.log');
	const s = createRotatingLogStream(file, {maxBytes: 12, keep: 2});
	for (let i = 0; i < 8; i++) await write(s, `line${i}\n`); // 6 bytes each → two lines per file
	await end(s);
	assert.ok(existsSync(file));
	assert.ok(existsSync(`${file}.1`));
	assert.ok(existsSync(`${file}.2`));
	assert.ok(!existsSync(`${file}.3`));
	assert.ok(statSync(file).size <= 12);
	assert.equal(readFileSync(`${file}.2`, 'utf8'), 'line2\nline3\n');
	assert.equal(readFileSync(`${file}.1`, 'utf8'), 'line4\nline5\n');
	assert.equal(readFileSync(file, 'utf8'), 'line6\nline7\n');
});

test('never rotates below maxBytes', async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'rotlog-'));
	const file = path.join(dir, 'daemon.out.log');
	const s = createRotatingLogStream(file, {maxBytes: 1024, keep: 1});
	await write(s, 'a'.repeat(100));
	await write(s, 'b'.repeat(100));
	await end(s);
	assert.ok(!existsSync(`${file}.1`));
	assert.equal(statSync(file).size, 200);
});
