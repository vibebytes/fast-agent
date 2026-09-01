import assert from 'node:assert/strict';
import test from 'node:test';
import {sortFsEntries} from './sortFsEntries.js';

test('sortFsEntries: dirs first then name', () => {
	const sorted = sortFsEntries([
		{name: 'z.txt', kind: 'file' as const},
		{name: 'b', kind: 'dir' as const},
		{name: 'a.txt', kind: 'file' as const},
		{name: 'a', kind: 'dir' as const}
	]);
	assert.deepEqual(
		sorted.map(e => e.name),
		['a', 'b', 'a.txt', 'z.txt']
	);
});
