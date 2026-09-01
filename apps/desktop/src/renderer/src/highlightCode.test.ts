import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	__highlightCacheSizeForTests,
	__resetHighlightCacheForTests,
	highlightCacheKey,
	highlightCode
} from './highlightCode.js';

test('highlight cache key is stable for same code and language aliases', () => {
	assert.equal(highlightCacheKey('const x = 1', 'ts'), highlightCacheKey('const x = 1', 'typescript'));
	assert.notEqual(highlightCacheKey('a', 'js'), highlightCacheKey('b', 'js'));
});

test('highlightCode returns cached HTML on second call for the same input', async () => {
	__resetHighlightCacheForTests();
	const first = await highlightCode('console.log(1)', 'javascript');
	const sizeAfterFirst = __highlightCacheSizeForTests();
	const second = await highlightCode('console.log(1)', 'javascript');
	assert.equal(second, first);
	assert.equal(__highlightCacheSizeForTests(), sizeAfterFirst);
	assert.ok(first.includes('console') || first.includes('<pre'));
});
