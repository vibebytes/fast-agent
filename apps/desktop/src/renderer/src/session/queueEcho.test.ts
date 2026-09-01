import assert from 'node:assert/strict';
import test from 'node:test';
import {countUserMatches, isEchoReflected, makeQueueEcho} from './queueEcho.js';

type Row = {kind: string; text?: string};

function rows(...entries: Array<[string, string?]>): Row[] {
	return entries.map(([kind, text]) => ({kind, text}));
}

test('countUserMatches counts only user entries with the exact text', () => {
	const items = rows(
		['user', 'fix it'],
		['assistant', 'fix it'],
		['user', 'fix it'],
		['user', 'fix it please']
	);
	assert.equal(countUserMatches(items, 'fix it'), 2);
	assert.equal(countUserMatches(items, 'missing'), 0);
});

test('an echo reflects only when a NEW matching entry appears past its baseline', () => {
	const items = rows(['user', 'same text']);
	const echo = makeQueueEcho('t1', 'same text', items);
	assert.equal(echo.baseline, 1);
	assert.equal(isEchoReflected(echo, items), false);

	assert.equal(isEchoReflected(echo, [...items, ...rows(['tool', 'x'])]), false);
	assert.equal(isEchoReflected(echo, [...items, ...rows(['user', 'same text'])]), true);
});

test('resending identical text still works — each send raises the bar', () => {
	let items = rows();
	const first = makeQueueEcho('t1', 'go', items);
	items = [...items, ...rows(['user', 'go'])];
	assert.equal(isEchoReflected(first, items), true);

	const second = makeQueueEcho('t1', 'go', items);
	assert.equal(second.baseline, 1);
	assert.equal(isEchoReflected(first, items), true);
	assert.equal(isEchoReflected(second, items), false);
	items = [...items, ...rows(['user', 'go'])];
	assert.equal(isEchoReflected(second, items), true);
});

test('a null echo and an unrelated-text entry never count as reflected', () => {
	assert.equal(isEchoReflected(null, rows(['user', 'hi'])), false);
	const echo = makeQueueEcho('t1', 'hello', rows());
	assert.equal(isEchoReflected(echo, rows(['user', 'hi'])), false);
});
