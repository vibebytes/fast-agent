import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {
	compactPath,
	countWrappedLines,
	fitTerminalLine,
	graphemes,
	padToWidth,
	stripAnsi,
	tailLines,
	truncateEnd,
	truncateMiddle,
	visualWidth
} from './textWidth.js';

test('visualWidth: ASCII, CJK, mixed, emoji, ANSI', () => {
	assert.equal(visualWidth('hello'), 5);
	assert.equal(visualWidth('中文'), 4);
	assert.equal(visualWidth('中a文b'), 6);
	assert.equal(visualWidth('１２３'), 6); // fullwidth digits
	assert.equal(visualWidth('🚀'), 2);
	assert.equal(visualWidth('👨‍👩‍👧‍👦'), 2); // ZWJ family = one cluster, two columns
	assert.equal(visualWidth('\u001b[31m红\u001b[0m'), 2); // ANSI stripped
	assert.equal(visualWidth(''), 0);
});

test('graphemes never splits surrogate pairs or ZWJ sequences', () => {
	assert.deepEqual(graphemes('a中'), ['a', '中']);
	assert.deepEqual(graphemes('👨‍👩‍👧‍👦x'), ['👨‍👩‍👧‍👦', 'x']);
	assert.deepEqual(graphemes('é'), ['é']); // combining mark stays attached
});

test('truncateEnd is width-accurate for CJK', () => {
	assert.equal(truncateEnd('中文内容很长', 5), '中文…');
	assert.equal(visualWidth(truncateEnd('中文内容很长', 5)) <= 5, true);
	assert.equal(truncateEnd('short', 10), 'short');
	assert.equal(truncateEnd('abcdef', 4), 'abc…');
	assert.equal(truncateEnd('whatever', 1), '…');
	assert.equal(truncateEnd('anything', 0), '');
});

test('truncateEnd never splits an emoji', () => {
	const result = truncateEnd('🚀🚀🚀', 4);
	assert.equal(result, '🚀…');
	assert.ok(visualWidth(result) <= 4);
});

test('truncateMiddle keeps head and tail within budget', () => {
	const longPath = join(homedir(), '项目', '很深', '的', '目录', 'file.ts');
	const result = truncateMiddle(longPath, 16);
	assert.ok(visualWidth(result) <= 16);
	assert.ok(result.includes('…'));
	assert.ok(result.endsWith('.ts'));
});

test('compactPath fits CJK paths', () => {
	const result = compactPath(join(homedir(), '中文目录', '子目录', '更深', '文件.md'), 20);
	assert.ok(visualWidth(result) <= 20);
});

test('padToWidth and fitTerminalLine produce exact-width CJK lines', () => {
	assert.equal(visualWidth(padToWidth('中文', 10)), 10);
	assert.equal(visualWidth(fitTerminalLine('中文内容超过预算了', 8)), 8);
	assert.equal(visualWidth(fitTerminalLine('ok', 8)), 8);
});

test('countWrappedLines accounts for CJK double width', () => {
	// 10 CJK chars = 20 columns -> 2 rows at width 10.
	assert.equal(countWrappedLines('一二三四五六七八九十', 10), 2);
	assert.equal(countWrappedLines('abcde', 10), 1);
	assert.equal(countWrappedLines('a\nb\nc', 10), 3);
	// Long URL hard-wraps.
	assert.equal(countWrappedLines('x'.repeat(25), 10), 3);
});

test('tailLines keeps the last rows and reports hidden count', () => {
	const text = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
	const result = tailLines(text, 2, 80);
	assert.equal(result.text, 'l4\nl5');
	assert.equal(result.hiddenLines, 3);
	const all = tailLines(text, 10, 80);
	assert.equal(all.text, text);
	assert.equal(all.hiddenLines, 0);
});

test('stripAnsi removes color sequences', () => {
	assert.equal(stripAnsi('\u001b[32mgreen\u001b[0m'), 'green');
});
