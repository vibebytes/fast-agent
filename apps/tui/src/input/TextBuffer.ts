/**
 * Pure text-buffer editor for TextEntry. Cursor is a UTF-16 code-unit offset
 * into `text`; movement and deletion walk by grapheme cluster so surrogate
 * pairs, ZWJ emoji (👨‍👩‍👧) and combining marks are never split.
 */
import stringWidth from 'string-width';
import {graphemes} from '../utils/textWidth.js';

export type TextBuffer = {
	text: string;
	cursor: number;
};

export type TextBufferEvent =
	| {type: 'insert'; text: string}
	| {type: 'backspace'}
	| {type: 'delete'}
	| {type: 'moveLeft'}
	| {type: 'moveRight'}
	| {type: 'moveUp'}
	| {type: 'moveDown'}
	| {type: 'home'}
	| {type: 'end'}
	| {type: 'documentHome'}
	| {type: 'documentEnd'}
	| {type: 'set'; text: string; cursor?: number}
	| {type: 'submit'; remnant?: string};

export type TextBufferResult = {
	buffer: TextBuffer;
	/** Present when the event was a submit; includes any IME remnant. */
	submitted?: string;
};

function clamp(cursor: number, text: string): number {
	return Math.max(0, Math.min(text.length, cursor));
}

function prevGraphemeStart(text: string, cursor: number): number {
	if (cursor <= 0) return 0;
	const clusters = graphemes(text.slice(0, cursor));
	if (clusters.length === 0) return 0;
	return cursor - clusters[clusters.length - 1]!.length;
}

function nextGraphemeEnd(text: string, cursor: number): number {
	if (cursor >= text.length) return text.length;
	const clusters = graphemes(text.slice(cursor));
	if (clusters.length === 0) return text.length;
	return cursor + clusters[0]!.length;
}

function lineInfo(text: string, cursor: number): {
	lines: string[];
	lineIndex: number;
	colInLine: number;
} {
	const lines = text.split('\n');
	const before = text.slice(0, cursor);
	const beforeLines = before.split('\n');
	const lineIndex = beforeLines.length - 1;
	const lineStart = before.lastIndexOf('\n') + 1;
	return {lines, lineIndex, colInLine: cursor - lineStart};
}

function offsetAt(lines: string[], lineIndex: number, col: number): number {
	let offset = 0;
	for (let i = 0; i < lineIndex; i++) {
		offset += lines[i]!.length + 1;
	}
	return offset + Math.min(col, lines[lineIndex]?.length ?? 0);
}

/**
 * UTF-16 offset of the position on `lineIndex` closest to `displayCol`
 * visual columns (CJK = 2), never landing inside a grapheme cluster.
 * Vertical cursor movement must map columns visually — reusing the raw
 * UTF-16 column made ↑/↓ jump sideways across CJK lines.
 */
function offsetAtDisplayColumn(lines: string[], lineIndex: number, displayCol: number): number {
	let offset = 0;
	for (let i = 0; i < lineIndex; i++) {
		offset += lines[i]!.length + 1;
	}
	let width = 0;
	let col = 0;
	for (const cluster of graphemes(lines[lineIndex] ?? '')) {
		const clusterWidth = stringWidth(cluster);
		if (width + clusterWidth > displayCol) break;
		width += clusterWidth;
		col += cluster.length;
	}
	return offset + col;
}

export function emptyBuffer(): TextBuffer {
	return {text: '', cursor: 0};
}

/** Display-column width of the text before the cursor (CJK = 2). */
export function displayColumn(text: string, cursor: number): number {
	return stringWidth(text.slice(0, cursor));
}

export function reduceTextBuffer(buffer: TextBuffer, event: TextBufferEvent): TextBufferResult {
	const {text, cursor} = buffer;

	switch (event.type) {
		case 'insert': {
			const next = text.slice(0, cursor) + event.text + text.slice(cursor);
			return {buffer: {text: next, cursor: cursor + event.text.length}};
		}
		case 'backspace': {
			if (cursor <= 0) return {buffer};
			const start = prevGraphemeStart(text, cursor);
			return {buffer: {text: text.slice(0, start) + text.slice(cursor), cursor: start}};
		}
		case 'delete': {
			if (cursor >= text.length) return {buffer};
			const end = nextGraphemeEnd(text, cursor);
			return {buffer: {text: text.slice(0, cursor) + text.slice(end), cursor}};
		}
		case 'moveLeft':
			return {buffer: {text, cursor: prevGraphemeStart(text, cursor)}};
		case 'moveRight':
			return {buffer: {text, cursor: nextGraphemeEnd(text, cursor)}};
		case 'home': {
			const before = text.slice(0, cursor);
			const lineStart = before.lastIndexOf('\n') + 1;
			return {buffer: {text, cursor: lineStart}};
		}
		case 'end': {
			const {lines, lineIndex} = lineInfo(text, cursor);
			return {buffer: {text, cursor: offsetAt(lines, lineIndex, lines[lineIndex]?.length ?? 0)}};
		}
		case 'documentHome':
			return {buffer: {text, cursor: 0}};
		case 'documentEnd':
			return {buffer: {text, cursor: text.length}};
		case 'moveUp': {
			const {lines, lineIndex, colInLine} = lineInfo(text, cursor);
			if (lineIndex <= 0) return {buffer};
			const displayCol = stringWidth((lines[lineIndex] ?? '').slice(0, colInLine));
			return {buffer: {text, cursor: offsetAtDisplayColumn(lines, lineIndex - 1, displayCol)}};
		}
		case 'moveDown': {
			const {lines, lineIndex, colInLine} = lineInfo(text, cursor);
			if (lineIndex >= lines.length - 1) return {buffer};
			const displayCol = stringWidth((lines[lineIndex] ?? '').slice(0, colInLine));
			return {buffer: {text, cursor: offsetAtDisplayColumn(lines, lineIndex + 1, displayCol)}};
		}
		case 'set': {
			const nextText = event.text;
			return {buffer: {text: nextText, cursor: clamp(event.cursor ?? nextText.length, nextText)}};
		}
		case 'submit': {
			// IME fix: return key may carry a remnant character that was not yet
			// committed into the buffer — fold it in before submitting.
			const remnant = event.remnant && !/[\r\n]/.test(event.remnant) ? event.remnant : '';
			const finalText = (text + remnant).trim();
			return {
				buffer: {text: '', cursor: 0},
				submitted: finalText.length > 0 ? finalText : undefined
			};
		}
	}
}
