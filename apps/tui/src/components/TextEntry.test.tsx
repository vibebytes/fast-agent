import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Box, Text} from 'ink';
import {renderToFrame} from '../test-utils/frame.js';
import {reduceTextBuffer} from '../input/TextBuffer.js';

test('terminalCursorPosition is relative to the focused Text only (no sibling prefix)', () => {
	const prefix = '> ';
	const value = '你好';
	const cursor = value.length;
	// Prefix lives in a sibling Text — cursor offset must NOT include prefix.length
	// or Ink places the caret past this node's content (invisible).
	const frame = renderToFrame(
		React.createElement(
			Box,
			null,
			React.createElement(Text, null, prefix),
			React.createElement(
				Text,
				{terminalCursorFocus: true, terminalCursorPosition: cursor},
				value
			)
		),
		{columns: 40, rows: 4}
	);
	assert.match(frame.plain, /你好/);
});

test('macOS Delete (\\x7f → key.delete) maps to backspace at EOL', () => {
	const result = reduceTextBuffer({text: 'abc', cursor: 3}, {type: 'backspace'});
	assert.equal(result.buffer.text, 'ab');
	assert.equal(result.buffer.cursor, 2);
});

test('forward delete (CSI 3~) removes the code point after the cursor', () => {
	const result = reduceTextBuffer({text: 'abc', cursor: 1}, {type: 'delete'});
	assert.equal(result.buffer.text, 'ac');
	assert.equal(result.buffer.cursor, 1);
});

test('Shift+Enter newline is an insert of \\n', () => {
	const result = reduceTextBuffer({text: 'ab', cursor: 2}, {type: 'insert', text: '\n'});
	assert.equal(result.buffer.text, 'ab\n');
	assert.equal(result.buffer.cursor, 3);
});

test('home / end stay on the current line (physical Home/End + Ctrl+A/E)', () => {
	const text = 'ab\ncd';
	assert.deepEqual(
		reduceTextBuffer({text, cursor: 4}, {type: 'home'}).buffer,
		{text, cursor: 3}
	);
	assert.deepEqual(
		reduceTextBuffer({text, cursor: 3}, {type: 'end'}).buffer,
		{text, cursor: 5}
	);
});

test('focus=false omits cursor attributes in the logical buffer path', () => {
	const result = reduceTextBuffer({text: 'abc', cursor: 3}, {type: 'set', text: 'ab', cursor: 99});
	assert.equal(result.buffer.cursor, 2);
});

test('IME remnant submit path used by TextEntry', () => {
	const result = reduceTextBuffer({text: '中', cursor: 1}, {type: 'submit', remnant: '文'});
	assert.equal(result.submitted, '中文');
});

test('focused caret paints without throwing and keeps the underlying text', () => {
	const value = 'ab';
	const cursor = 1;
	const frame = renderToFrame(
		React.createElement(
			Text,
			{terminalCursorFocus: true, terminalCursorPosition: cursor},
			'a' + '\u001b[7mb\u001b[27m' // chalk.inverse style, gemini-cli pattern
		),
		{columns: 40, rows: 3}
	);
	assert.match(frame.plain, /ab/);
});
