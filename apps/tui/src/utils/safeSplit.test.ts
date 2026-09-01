import test from 'node:test';
import assert from 'node:assert/strict';
import {findSafeSplitPoints, splitStableChunks} from './safeSplit.js';

test('no split point in single paragraph', () => {
	const result = splitStableChunks('hello world streaming');
	assert.deepEqual(result.chunks, []);
	assert.equal(result.tail, 'hello world streaming');
});

test('splits at blank lines between paragraphs', () => {
	const result = splitStableChunks('para one\n\npara two\n\npara three tail');
	assert.deepEqual(result.chunks, ['para one', 'para two']);
	assert.equal(result.tail, 'para three tail');
});

test('does not split inside fenced code blocks', () => {
	const text = 'intro\n\n```python\nfor i in x:\n\n    print(i)\n\n```\n\nafter';
	const result = splitStableChunks(text);
	assert.deepEqual(result.chunks, ['intro', '```python\nfor i in x:\n\n    print(i)\n\n```']);
	assert.equal(result.tail, 'after');
});

test('open code fence keeps everything after it in the tail', () => {
	const text = 'before\n\n```js\nconst a = 1;\n\nconst b = 2;';
	const result = splitStableChunks(text);
	assert.deepEqual(result.chunks, ['before']);
	assert.equal(result.tail, '```js\nconst a = 1;\n\nconst b = 2;');
});

test('collapses runs of blank lines into one boundary', () => {
	const result = splitStableChunks('a\n\n\n\nb');
	assert.deepEqual(result.chunks, ['a']);
	assert.equal(result.tail, 'b');
});

test('trailing blank lines do not create a boundary (tail must exist)', () => {
	const result = splitStableChunks('paragraph\n\n');
	assert.deepEqual(result.chunks, []);
	assert.equal(result.tail, 'paragraph\n\n');
});

test('CJK paragraphs split correctly', () => {
	const result = splitStableChunks('第一段：中文内容。\n\n第二段还在输出');
	assert.deepEqual(result.chunks, ['第一段：中文内容。']);
	assert.equal(result.tail, '第二段还在输出');
});

test('append-stability: chunks of any prefix are a prefix of chunks of the full text', () => {
	const full = [
		'# 标题',
		'',
		'第一段中文，包含 `代码` 和 **加粗**。',
		'',
		'```scala',
		'val x = 1',
		'',
		'val y = 2',
		'```',
		'',
		'- 列表一',
		'- 列表二',
		'',
		'| a | b |',
		'|---|---|',
		'| 1 | 2 |',
		'',
		'结尾段落 with mixed 中英文 content streaming...'
	].join('\n');

	let previousChunks: string[] = [];
	for (let cut = 1; cut <= full.length; cut++) {
		const {chunks} = splitStableChunks(full.slice(0, cut));
		assert.ok(
			chunks.length >= previousChunks.length,
			`chunk count regressed at cut=${cut}`
		);
		for (const [index, chunk] of previousChunks.entries()) {
			assert.equal(chunks[index], chunk, `chunk ${index} changed at cut=${cut}`);
		}
		previousChunks = chunks;
	}
});

test('findSafeSplitPoints returns ascending offsets pointing after blank-line runs', () => {
	const text = 'a\n\nb\n\nc';
	const points = findSafeSplitPoints(text);
	assert.deepEqual(points, [3, 6]);
	assert.equal(text.slice(points[0], points[1]! - 2), 'b');
});
