import assert from 'node:assert/strict';
import test from 'node:test';
import {extractQuery} from './extractQuery.js';
import {extractQuery as fromIndex} from './index.js';

test('extractQuery returns inner query text', () => {
	const raw = `<env>
  <cwd>/proj</cwd>
</env>

<query>
hello world
</query>`;
	assert.equal(extractQuery(raw), 'hello world');
});

test('extractQuery leaves plain text unchanged', () => {
	assert.equal(extractQuery('just text'), 'just text');
});

test('extractQuery trims and tolerates unclosed tags', () => {
	assert.equal(extractQuery('<query>\n  padded  \n</query>'), 'padded');
	assert.equal(extractQuery('<query>no close'), '<query>no close');
});

test('package export includes extractQuery', () => {
	assert.equal(fromIndex('<query>x</query>'), 'x');
});
