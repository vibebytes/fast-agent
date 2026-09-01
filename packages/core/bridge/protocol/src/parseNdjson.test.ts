import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNdjsonChunk, utf8Stream} from './parseNdjson.js';

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

test('utf8Stream reassembles CJK split across chunks; String(chunk) becomes U+FFFD', () => {
	const text = '最严重的是';
	const line = `${JSON.stringify({type: 'assistant_delta', text})}\n`;
	const bytes = Buffer.from(line, 'utf8');
	const zhong = Buffer.from('重', 'utf8');
	const idx = bytes.indexOf(zhong);
	assert.ok(idx >= 0);
	const a = bytes.subarray(0, idx + 2);
	const b = bytes.subarray(idx + 2);

	const broken: string[] = [];
	parseNdjsonChunk('', String(a) + String(b), l => broken.push(l));
	assert.match(broken[0] ?? '', /\uFFFD/);
	assert.equal(JSON.parse(broken[0] ?? '{}').text, '最严��的是');

	const decode = utf8Stream();
	const lines: string[] = [];
	let rem = parseNdjsonChunk('', decode(a), l => lines.push(l));
	rem = parseNdjsonChunk(rem, decode(b), l => lines.push(l));
	assert.equal(rem, '');
	assert.equal(JSON.parse(lines[0] ?? '{}').text, text);
	assert.equal(lines[0]?.includes('\uFFFD'), false);
});

test('utf8Stream survives every byte-boundary split of a CJK event line', () => {
	const line = `${JSON.stringify({type: 'assistant_delta', text: '分析沪深300的成交量变化，量能温和放大。'})}\n`;
	const bytes = Buffer.from(line, 'utf8');
	const expected = line.trim();

	for (let splitAt = 1; splitAt < bytes.length; splitAt++) {
		const decode = utf8Stream();
		const lines: string[] = [];
		let rem = parseNdjsonChunk('', decode(bytes.subarray(0, splitAt)), l => lines.push(l));
		rem = parseNdjsonChunk(rem, decode(bytes.subarray(splitAt)), l => lines.push(l));
		rem = parseNdjsonChunk(rem, decode(Buffer.alloc(0)), l => lines.push(l));

		assert.equal(lines.length, 1, `split@${splitAt}`);
		assert.equal(lines[0], expected, `split@${splitAt}`);
		assert.equal(rem, '', `split@${splitAt}`);
	}
});
