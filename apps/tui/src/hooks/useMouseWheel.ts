/**
 * SGR mouse wheel support (DECSET 1000 + 1006) for the fullscreen renderer.
 *
 * Opt-in via FAST_MOUSE=1: Ink's keypress parser does not understand SGR
 * mouse reports, so with tracking enabled every wheel tick also reaches
 * `useInput` as a garbage sequence. The Composer strips those remnants
 * (see MOUSE_REMNANT_RE), but we still keep the feature behind a flag so a
 * terminal/multiplexer with quirky mouse handling can never corrupt input
 * by default. Keyboard scrolling: PgUp/PgDn always; Home/End only while the
 * transcript is scrolled away from the bottom (otherwise they edit the input).
 */
import {useEffect, useRef} from 'react';

const ENABLE_MOUSE = '\u001b[?1000h\u001b[?1006h';
const DISABLE_MOUSE = '\u001b[?1006l\u001b[?1000l';

/** SGR wheel reports: button 64 = wheel up, 65 = wheel down. */
const SGR_MOUSE_RE = /\u001b\[<(\d+);\d+;\d+[Mm]/g;

/** What's left of an SGR report after Ink strips the leading ESC. */
export const MOUSE_REMNANT_RE = /\[<\d+;\d+;\d+[Mm]/g;

export function mouseWheelEnabled(force = false): boolean {
	if (force) return process.stdout.isTTY === true;
	return process.env['FAST_MOUSE'] === '1' && process.stdout.isTTY === true;
}

export function useMouseWheel(
	active: boolean,
	onWheel: (direction: 'up' | 'down') => void,
	options: {force?: boolean} = {}
): void {
	const handlerRef = useRef(onWheel);
	handlerRef.current = onWheel;

	useEffect(() => {
		if (!active || !mouseWheelEnabled(options.force === true)) return;

		process.stdout.write(ENABLE_MOUSE);
		const onData = (data: Buffer | string) => {
			const text = typeof data === 'string' ? data : data.toString('utf8');
			for (const match of text.matchAll(SGR_MOUSE_RE)) {
				const button = Number(match[1]);
				if (button === 64) handlerRef.current('up');
				else if (button === 65) handlerRef.current('down');
			}
		};
		process.stdin.on('data', onData);

		return () => {
			process.stdin.off('data', onData);
			process.stdout.write(DISABLE_MOUSE);
		};
	}, [active, options.force]);
}
