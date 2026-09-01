import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdownTable} from './MarkdownTable.js';

test('parseMarkdownTable parses pipe tables', () => {
	const table = parseMarkdownTable([
		'| Name | Value |',
		'| --- | --- |',
		'| alpha | 1 |',
		'| beta | 2 |'
	]);
	assert.ok(table);
	assert.deepEqual(table?.headers, ['Name', 'Value']);
	assert.equal(table?.rows.length, 2);
});

test('parseMarkdownTable rejects invalid tables', () => {
	assert.equal(parseMarkdownTable(['not a table']), undefined);
});
