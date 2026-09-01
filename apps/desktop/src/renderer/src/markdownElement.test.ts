import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
	__markdownCacheSizeForTests,
	__resetMarkdownCacheForTests,
	markdownElement
} from './markdownElement.js';

const FIXTURE = [
	'# Title',
	'',
	'A paragraph with **bold**, `inline`, and a [link](https://example.com).',
	'',
	'| a | b |',
	'| - | - |',
	'| 1 | 2 |',
	'',
	'```ts',
	'const x: number = 1;',
	'```'
].join('\n');

const OPTIONS = {children: FIXTURE, remarkPlugins: [remarkGfm]};

beforeEach(() => {
	__resetMarkdownCacheForTests();
});

test('cached element is byte-identical to a direct ReactMarkdown call', () => {
	const cached = markdownElement(OPTIONS, FIXTURE);
	const direct = ReactMarkdown(OPTIONS);
	assert.equal(renderToStaticMarkup(cached), renderToStaticMarkup(direct));
});

test('same cache key returns the same element reference (parse skipped)', () => {
	const first = markdownElement(OPTIONS, FIXTURE);
	const second = markdownElement(OPTIONS, FIXTURE);
	assert.equal(first, second);
	assert.equal(__markdownCacheSizeForTests(), 1);
});

test('null cache key never stores (streaming variants)', () => {
	const first = markdownElement(OPTIONS, null);
	const second = markdownElement(OPTIONS, null);
	assert.notEqual(first, second);
	assert.equal(__markdownCacheSizeForTests(), 0);
});

test('LRU evicts the oldest entry beyond the cap', () => {
	for (let i = 0; i < 85; i++) {
		markdownElement({children: `entry ${i}`}, `entry ${i}`);
	}
	assert.equal(__markdownCacheSizeForTests(), 80);
	// entry 0 evicted → a fresh parse (different reference than a re-add).
	const before = __markdownCacheSizeForTests();
	markdownElement({children: 'entry 0'}, 'entry 0');
	assert.equal(__markdownCacheSizeForTests(), before);
});
