import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNdjsonChunk} from './parseNdjson.js';

test('parseNdjsonChunk emits complete lines and returns remainder', () => {
	const lines: string[] = [];
	const remainder = parseNdjsonChunk('{"a":', '1}\n{"b":2', line => lines.push(line));

	assert.deepEqual(lines, ['{"a":1}']);
	assert.equal(remainder, '{"b":2');
});

test('parseNdjsonChunk tolerates blank lines and mixed line endings', () => {
	const lines: string[] = [];
	const remainder = parseNdjsonChunk(
		'',
		'\n {"type":"ready"} \r\n\r\n{"type":"assistant_delta","text":"hi"}\n',
		line => lines.push(line)
	);

	assert.deepEqual(lines, [
		'{"type":"ready"}',
		'{"type":"assistant_delta","text":"hi"}'
	]);
	assert.equal(remainder, '');
});

test('parseNdjsonChunk keeps malformed partial payload in remainder until complete', () => {
	const lines: string[] = [];
	const afterFirst = parseNdjsonChunk('', '{"type":"ready"', line => lines.push(line));
	assert.equal(lines.length, 0);
	assert.equal(afterFirst, '{"type":"ready"');

	const afterSecond = parseNdjsonChunk(afterFirst, '}\n{"type":"oops"', line => lines.push(line));
	assert.deepEqual(lines, ['{"type":"ready"}']);
	assert.equal(afterSecond, '{"type":"oops"');
});

test('parseNdjsonChunk handles large single-line events', () => {
	const lines: string[] = [];
	const bigPayload = 'x'.repeat(256 * 1024);
	const remainder = parseNdjsonChunk('', `{"type":"assistant_delta","text":"${bigPayload}"}\n`, line => lines.push(line));

	assert.equal(lines.length, 1);
	assert.match(lines[0] ?? '', /"assistant_delta"/);
	assert.equal(remainder, '');
});
