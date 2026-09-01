import test from 'node:test';
import assert from 'node:assert/strict';
import {displayColumn, emptyBuffer, reduceTextBuffer, type TextBuffer} from './TextBuffer.js';

function apply(buffer: TextBuffer, ...events: Parameters<typeof reduceTextBuffer>[1][]): TextBuffer {
	let current = buffer;
	for (const event of events) {
		current = reduceTextBuffer(current, event).buffer;
	}
	return current;
}

test('insert in the middle', () => {
	const b = apply({text: 'ab', cursor: 1}, {type: 'insert', text: 'X'});
	assert.deepEqual(b, {text: 'aXb', cursor: 2});
});

test('backspace at head / middle / tail', () => {
	assert.deepEqual(apply({text: 'ab', cursor: 0}, {type: 'backspace'}), {text: 'ab', cursor: 0});
	assert.deepEqual(apply({text: 'ab', cursor: 1}, {type: 'backspace'}), {text: 'b', cursor: 0});
	assert.deepEqual(apply({text: 'ab', cursor: 2}, {type: 'backspace'}), {text: 'a', cursor: 1});
});

test('backspace removes a full CJK / emoji code point', () => {
	assert.deepEqual(apply({text: '你a', cursor: 1}, {type: 'backspace'}), {text: 'a', cursor: 0});
	const emoji = '👍x';
	assert.deepEqual(
		apply({text: emoji, cursor: emoji.length - 1}, {type: 'backspace'}),
		{text: 'x', cursor: 0}
	);
});

test('move left/right clamps at boundaries', () => {
	assert.deepEqual(apply({text: 'ab', cursor: 0}, {type: 'moveLeft'}), {text: 'ab', cursor: 0});
	assert.deepEqual(apply({text: 'ab', cursor: 2}, {type: 'moveRight'}), {text: 'ab', cursor: 2});
	assert.deepEqual(apply({text: '你a', cursor: 1}, {type: 'moveLeft'}), {text: '你a', cursor: 0});
});

test('movement and deletion treat ZWJ emoji as one grapheme', () => {
	const family = '👨‍👩‍👧'; // 8 UTF-16 units, 1 grapheme cluster
	const text = `${family}x`;
	assert.deepEqual(apply({text, cursor: text.length - 1}, {type: 'moveLeft'}), {text, cursor: 0});
	assert.deepEqual(apply({text, cursor: 0}, {type: 'moveRight'}), {text, cursor: family.length});
	assert.deepEqual(apply({text, cursor: family.length}, {type: 'backspace'}), {text: 'x', cursor: 0});
	assert.deepEqual(apply({text, cursor: 0}, {type: 'delete'}), {text: 'x', cursor: 0});
});

test('home / end stay on the current line', () => {
	const text = 'one\ntwo\nthree';
	assert.deepEqual(apply({text, cursor: 5}, {type: 'home'}), {text, cursor: 4});
	assert.deepEqual(apply({text, cursor: 5}, {type: 'end'}), {text, cursor: 7});
});

test('documentHome / documentEnd jump to buffer edges', () => {
	const text = 'one\ntwo';
	assert.deepEqual(apply({text, cursor: 5}, {type: 'documentHome'}), {text, cursor: 0});
	assert.deepEqual(apply({text, cursor: 1}, {type: 'documentEnd'}), {text, cursor: text.length});
});

test('moveUp / moveDown preserve column, clamp on short lines', () => {
	const text = 'aaaa\nbb\ncccc';
	assert.deepEqual(apply({text, cursor: 10}, {type: 'moveUp'}), {text, cursor: 7});
	assert.deepEqual(apply({text, cursor: 2}, {type: 'moveUp'}), {text, cursor: 2});
});

test('moveUp / moveDown map columns visually across CJK lines', () => {
	// Line 0 '你好世界' = 4 chars / 8 columns; line 1 'abcdefgh' ASCII.
	const text = '你好世界\nabcdefgh';
	// Cursor after 'abcd' (display column 4) → lands after '你好' (offset 2).
	assert.deepEqual(apply({text, cursor: 9}, {type: 'moveUp'}), {text, cursor: 2});
	// Cursor after '你好' (display column 4) → lands after 'abcd' (offset 9).
	assert.deepEqual(apply({text, cursor: 2}, {type: 'moveDown'}), {text, cursor: 9});
});

test('displayColumn counts CJK as width 2', () => {
	assert.equal(displayColumn('你a', 1), 2);
	assert.equal(displayColumn('你a', 2), 3);
});

test('IME submit folds remnant character into the submitted value', () => {
	const result = reduceTextBuffer({text: 'hel', cursor: 3}, {type: 'submit', remnant: 'p'});
	assert.equal(result.submitted, 'help');
	assert.deepEqual(result.buffer, emptyBuffer());
});

test('submit ignores empty / whitespace-only input', () => {
	const result = reduceTextBuffer({text: '  ', cursor: 2}, {type: 'submit'});
	assert.equal(result.submitted, undefined);
});

test('paste inserts multi-line text in one shot', () => {
	const b = apply({text: '', cursor: 0}, {type: 'insert', text: 'a\nb\nc'});
	assert.deepEqual(b, {text: 'a\nb\nc', cursor: 5});
});

test('set clamps cursor into the new text', () => {
	assert.deepEqual(
		apply({text: 'hello', cursor: 5}, {type: 'set', text: 'hi', cursor: 99}),
		{text: 'hi', cursor: 2}
	);
});
