/**
 * Flicker sentinel (gemini-cli's useFlickerDetector, hardened).
 *
 * A dynamic frame taller than the terminal viewport is THE root cause of torn
 * redraws in Ink's inline mode: the renderer cannot erase rows that scrolled
 * out, so the previous frame leaks into scrollback as garbage. We measure the
 * rendered root after every commit and count violations. Dev/debug surfaces
 * the counter; tests assert it stays at zero.
 */
import {useEffect, useRef} from 'react';
import {measureElement, type DOMElement} from 'ink';

let flickerFrameCount = 0;
let lastFlickerInfo = '';

export function getFlickerFrameCount(): number {
	return flickerFrameCount;
}

export function getLastFlickerInfo(): string {
	return lastFlickerInfo;
}

export function resetFlickerFrameCount(): void {
	flickerFrameCount = 0;
	lastFlickerInfo = '';
}

export function useFlickerDetector(
	rootRef: React.RefObject<DOMElement | null>,
	terminalRows: number,
	onFlicker?: (height: number, rows: number) => void
): void {
	const callbackRef = useRef(onFlicker);
	callbackRef.current = onFlicker;

	useEffect(() => {
		if (!rootRef.current) return;
		try {
			const {height} = measureElement(rootRef.current);
			if (height > terminalRows) {
				flickerFrameCount += 1;
				lastFlickerInfo = `frame height ${height} > terminal rows ${terminalRows}`;
				callbackRef.current?.(height, terminalRows);
			}
		} catch {
			// measureElement can throw before layout settles; never break rendering.
		}
	});
}
