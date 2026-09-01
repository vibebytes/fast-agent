import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlocks, parseInline} from './MarkdownContent.js';

test('parseBlocks extracts fenced code blocks', () => {
	const blocks = parseBlocks('intro\n```ts\nconst x = 1\n```\noutro');
	assert.equal(blocks.length, 3);
	assert.equal(blocks[1]?.kind, 'code');
	if (blocks[1]?.kind === 'code') {
		assert.equal(blocks[1].language, 'ts');
		assert.match(blocks[1].content, /const x = 1/);
	}
});

test('parseBlocks extracts quote lines', () => {
	const blocks = parseBlocks('> warning line');
	assert.equal(blocks[0]?.kind, 'quote');
});

test('parseBlocks extracts markdown tables', () => {
	const blocks = parseBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |');
	assert.equal(blocks[0]?.kind, 'table');
});

test('parseBlocks extracts bullet lists', () => {
	const blocks = parseBlocks('- one\n- two');
	assert.equal(blocks[0]?.kind, 'list');
	if (blocks[0]?.kind === 'list') {
		assert.deepEqual(blocks[0].items, [
			{content: 'one', indent: 0, marker: '•'},
			{content: 'two', indent: 0, marker: '•'}
		]);
	}
});

test('parseBlocks keeps ordered list numbering', () => {
	const blocks = parseBlocks('1. first\n2. second\n3. third');
	assert.equal(blocks[0]?.kind, 'list');
	if (blocks[0]?.kind === 'list') {
		assert.deepEqual(blocks[0].items.map(item => item.marker), ['1.', '2.', '3.']);
		assert.deepEqual(blocks[0].items.map(item => item.content), ['first', 'second', 'third']);
	}
});

test('parseBlocks marks unclosed code fences as streaming', () => {
	const blocks = parseBlocks('text\n```py\nprint(1)\n');
	const code = blocks.find(block => block.kind === 'code');
	assert.ok(code);
	if (code?.kind === 'code') {
		assert.equal(code.closed, false);
		assert.match(code.content, /print\(1\)/);
	}
});

test('parseBlocks extracts headings and horizontal rules', () => {
	const blocks = parseBlocks('## Title\n---\nbody');
	assert.equal(blocks[0]?.kind, 'heading');
	assert.equal(blocks[1]?.kind, 'hr');
	assert.equal(blocks[2]?.kind, 'text');
});

test('parseBlocks accepts non-word fence languages like c++', () => {
	const blocks = parseBlocks('```c++\nint x;\n```');
	assert.equal(blocks[0]?.kind, 'code');
	if (blocks[0]?.kind === 'code') assert.equal(blocks[0].language, 'c++');
});

test('parseBlocks keeps inline backticks inside a fence open', () => {
	const blocks = parseBlocks('```md\nuse ``` to fence\nmore\n```\nafter');
	assert.equal(blocks[0]?.kind, 'code');
	if (blocks[0]?.kind === 'code') {
		// A bare ``` line closes; ``` mid-line must not.
		assert.match(blocks[0].content, /use ``` to fence/);
		assert.match(blocks[0].content, /more/);
		assert.equal(blocks[0].closed, true);
	}
	assert.equal(blocks[1]?.kind, 'text');
});

test('parseBlocks folds wrapped list item continuation lines', () => {
	const blocks = parseBlocks('- a long item that\n  continues here\n- second');
	assert.equal(blocks[0]?.kind, 'list');
	if (blocks[0]?.kind === 'list') {
		assert.deepEqual(blocks[0].items.map(item => item.content), [
			'a long item that continues here',
			'second'
		]);
	}
});

test('parseBlocks table does not swallow later prose containing pipes', () => {
	const blocks = parseBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nrun `a | b` in shell');
	assert.equal(blocks[0]?.kind, 'table');
	if (blocks[0]?.kind === 'table') assert.equal(blocks[0].rows.length, 1);
	assert.equal(blocks[1]?.kind, 'text');
});

test('parseInline does not italicize multiplication', () => {
	const tokens = parseInline('2*3*4 equals 24');
	assert.deepEqual(tokens, [{kind: 'text', content: '2*3*4 equals 24'}]);
});

test('parseInline keeps parenthesized URLs intact', () => {
	const tokens = parseInline('see [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now');
	assert.deepEqual(tokens[1], {
		kind: 'link',
		content: 'Foo',
		url: 'https://en.wikipedia.org/wiki/Foo_(bar)'
	});
});

test('parseInline keeps bold spans containing backticks whole', () => {
	const tokens = parseInline('**code `x` inside**');
	assert.deepEqual(tokens, [{kind: 'bold', content: 'code `x` inside'}]);
});
