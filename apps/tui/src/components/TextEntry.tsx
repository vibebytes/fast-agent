/**
 * Self-hosted text input. Cursor rendering follows gemini-cli TextInput /
 * ink multi-input: chalk.inverse caret + terminalCursorFocus/Position for IME.
 * (No software blink, no manual ?25h — Ink's terminalBuffer owns cursor hide.)
 *
 * Text is controlled by `value`/`onChange` (parent owns the string). Local
 * state only tracks the cursor so external clears (Esc / Ctrl+U / history)
 * paint immediately without waiting for a buffer sync effect.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Text, useInput} from 'ink';
import chalk from 'chalk';
import {reduceTextBuffer, type TextBuffer} from '../input/TextBuffer.js';
import {useHomeEndKeys} from '../hooks/useHomeEndKeys.js';
import {MOUSE_REMNANT_RE} from '../hooks/useMouseWheel.js';
import {graphemes} from '../utils/textWidth.js';

/** CSI 3~ — true forward-delete (Win/Linux Delete). Ink also maps \x7f → key.delete. */
const FORWARD_DELETE_RE = /\u001b\[3[~^$]/;

type Props = {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	focus?: boolean;
	placeholder?: string;
	/**
	 * When false (Composer default), ↑/↓ are left for the parent (history /
	 * suggestions) unless the buffer already contains a newline. When true,
	 * ↑/↓ always move the cursor between lines.
	 */
	multiline?: boolean;
	/**
	 * Bare quick keys (r/c): consulted for a single printable char while the
	 * buffer is EMPTY; returning true suppresses insertion. Only claim keys
	 * whose action will actually fire — otherwise typing loses characters.
	 */
	onBareKey?: (ch: string) => boolean;
};

/**
 * gemini-cli TextInput pattern: embed chalk.inverse at the caret position.
 * UTF-16 `cursor` → grapheme-cluster index (never highlights half a ZWJ
 * emoji); EOL / newline → inverse space.
 */
function lineWithInverseCaret(text: string, cursor: number): string {
	const clusters = graphemes(text);
	let clusterIndex = 0;
	let offset = 0;
	while (offset < cursor && clusterIndex < clusters.length) {
		offset += clusters[clusterIndex]!.length;
		clusterIndex += 1;
	}
	const before = clusters.slice(0, clusterIndex).join('');
	const at = clusters[clusterIndex];
	const after = clusters.slice(clusterIndex + 1).join('');
	if (!at || at === '\n') {
		return before + chalk.inverse(' ') + (at === '\n' ? `\n${after}` : after);
	}
	return before + chalk.inverse(at) + after;
}

export function TextEntry({
	value,
	onChange,
	onSubmit,
	focus = true,
	placeholder = '',
	multiline = false,
	onBareKey
}: Props) {
	const [cursor, setCursor] = useState(() => value.length);
	const cursorRef = useRef(cursor);
	cursorRef.current = cursor;
	const valueRef = useRef(value);
	valueRef.current = value;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;
	/** Set in stdin 'data' before Ink's useInput sees the same CSI 3~. */
	const forwardDeleteRef = useRef(false);

	// Clamp cursor when the parent resets/shrinks the value.
	useEffect(() => {
		setCursor(current => Math.min(current, value.length));
	}, [value]);

	const apply = (event: Parameters<typeof reduceTextBuffer>[1]): TextBuffer => {
		const result = reduceTextBuffer({text: valueRef.current, cursor: cursorRef.current}, event);
		valueRef.current = result.buffer.text;
		cursorRef.current = result.buffer.cursor;
		setCursor(result.buffer.cursor);
		return result.buffer;
	};

	// Distinguish Win/Linux forward-delete (CSI 3~) from macOS/Linux Backspace (\x7f),
	// both of which Ink reports as key.delete.
	useEffect(() => {
		if (!focus || process.stdin.isTTY !== true) return;
		const onData = (data: Buffer | string) => {
			const text = typeof data === 'string' ? data : data.toString('utf8');
			if (FORWARD_DELETE_RE.test(text)) {
				FORWARD_DELETE_RE.lastIndex = 0;
				forwardDeleteRef.current = true;
			}
		};
		process.stdin.on('data', onData);
		return () => {
			process.stdin.off('data', onData);
		};
	}, [focus]);

	useHomeEndKeys(
		focus,
		() => {
			apply({type: 'home'});
		},
		() => {
			apply({type: 'end'});
		}
	);

	useInput((input, key) => {
		if (!focus) return;

		// Shift+Enter → newline (Enter alone submits).
		if (key.return && key.shift) {
			const next = apply({type: 'insert', text: '\n'});
			onChangeRef.current(next.text);
			return;
		}

		if (key.return) {
			const result = reduceTextBuffer(
				{text: valueRef.current, cursor: cursorRef.current},
				{type: 'submit', remnant: input}
			);
			valueRef.current = '';
			cursorRef.current = 0;
			setCursor(0);
			onChangeRef.current('');
			if (result.submitted) onSubmitRef.current(result.submitted);
			return;
		}

		if (key.backspace) {
			const next = apply({type: 'backspace'});
			onChangeRef.current(next.text);
			return;
		}

		// key.delete: \x7f (Backspace on macOS / many Linux terms) → backspace;
		// CSI 3~ (forward Delete) sets forwardDeleteRef in the stdin listener.
		if (key.delete) {
			const forward = forwardDeleteRef.current;
			forwardDeleteRef.current = false;
			const next = apply({type: forward ? 'delete' : 'backspace'});
			onChangeRef.current(next.text);
			return;
		}

		// Arrow keys only — do NOT bind Ctrl+F (conflicts with TOGGLE_FOOTER).
		if (key.leftArrow) {
			apply({type: 'moveLeft'});
			return;
		}
		if (key.rightArrow) {
			apply({type: 'moveRight'});
			return;
		}
		if (key.ctrl && input === 'a') {
			apply({type: 'home'});
			return;
		}
		if (key.ctrl && input === 'e') {
			apply({type: 'end'});
			return;
		}
		// Ctrl+J → newline (fallback when the terminal does not flag Shift+Enter).
		if (key.ctrl && input === 'j') {
			const next = apply({type: 'insert', text: '\n'});
			onChangeRef.current(next.text);
			return;
		}

		const lineNav = multiline || valueRef.current.includes('\n');
		if (lineNav && key.upArrow) {
			apply({type: 'moveUp'});
			return;
		}
		if (lineNav && key.downArrow) {
			apply({type: 'moveDown'});
			return;
		}
		if (!lineNav && (key.upArrow || key.downArrow)) return;

		// Tab / Escape / Ctrl chords are owned by Composer — ignore here.
		if (key.tab || key.escape || key.ctrl || key.meta) return;

		if (input) {
			const cleaned = input.replace(MOUSE_REMNANT_RE, '');
			if (cleaned.length === 0) return;
			if (
				cleaned.length === 1 &&
				valueRef.current.length === 0 &&
				onBareKey?.(cleaned)
			) {
				return;
			}
			const next = apply({type: 'insert', text: cleaned});
			onChangeRef.current(next.text);
		}
	}, {isActive: focus});

	const showPlaceholder = value.length === 0 && placeholder.length > 0;

	// Mirror gemini-cli TextInput placeholder / value branches.
	if (showPlaceholder) {
		return focus ? (
			<Text terminalCursorFocus terminalCursorPosition={0} dimColor>
				{chalk.inverse(placeholder[0] ?? ' ')}
				{placeholder.slice(1)}
			</Text>
		) : (
			<Text dimColor>{placeholder}</Text>
		);
	}

	const cursorPosition = Math.min(cursor, value.length);
	const display = focus ? lineWithInverseCaret(value, cursorPosition) : value;

	return (
		<Text
			terminalCursorFocus={focus}
			terminalCursorPosition={focus ? cursorPosition : undefined}
		>
			{display}
		</Text>
	);
}
