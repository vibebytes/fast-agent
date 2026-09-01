import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findLastSafeSplitPoint, splitStreamingMarkdown} from './markdownSplit.js';

test('findLastSafeSplitPoint keeps incomplete code fence in pending', () => {
	const text = 'Hello\n\n```ts\nconst x = 1\n';
	const split = findLastSafeSplitPoint(text);
	assert.equal(text.slice(0, split), 'Hello\n\n');
	assert.ok(text.slice(split).startsWith('```ts'));
});

test('findLastSafeSplitPoint freezes closed paragraphs', () => {
	const text = 'Para one.\n\nPara two.\n\nPara three growing';
	const {frozen, pending} = splitStreamingMarkdown(text);
	assert.equal(frozen, 'Para one.\n\nPara two.\n\n');
	assert.equal(pending, 'Para three growing');
});

test('tail delta does not move frozen prefix once a paragraph closed', () => {
	const a = splitStreamingMarkdown('One.\n\nTwo');
	const b = splitStreamingMarkdown('One.\n\nTwo more tokens');
	assert.equal(a.frozen, b.frozen);
	assert.equal(a.frozen, 'One.\n\n');
	assert.notEqual(a.pending, b.pending);
});
