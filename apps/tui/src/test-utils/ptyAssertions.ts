/**
 * Shared PTY assertion helpers for the terminalBuffer render pipeline.
 */
import assert from 'node:assert/strict';

const FULL_CLEAR_RE = /\u001b\[(?:2|3)J/;
const SYNC_START = '\u001b[?2026h';
const SYNC_END = '\u001b[?2026l';
const ALT_ENTER = '\u001b[?1049h';
const ALT_LEAVE = '\u001b[?1049l';

export function assertNoFullClear(output: string, label = 'PTY output'): void {
	assert.equal(FULL_CLEAR_RE.test(output), false, `${label} must not contain CSI 2J/3J full-clear sequences`);
}

/**
 * When synchronized output is used, starts and ends should be balanced.
 * Not all frames use it (depends on terminal capability), so this only
 * asserts pairing when at least one start is present.
 */
export function assertSynchronizedFrames(output: string, label = 'PTY output'): void {
	const starts = output.split(SYNC_START).length - 1;
	const ends = output.split(SYNC_END).length - 1;
	if (starts === 0) return;
	assert.equal(starts, ends, `${label}: unbalanced synchronized-output markers (${starts} starts, ${ends} ends)`);
}

export function countAltBufferEnters(output: string): number {
	return output.split(ALT_ENTER).length - 1;
}

export function countAltBufferLeaves(output: string): number {
	return output.split(ALT_LEAVE).length - 1;
}

export function assertAltBufferToggle(output: string, minCycles = 1): void {
	const enters = countAltBufferEnters(output);
	const leaves = countAltBufferLeaves(output);
	assert.ok(enters >= minCycles, `expected ≥${minCycles} alt-buffer enters, got ${enters}`);
	assert.ok(leaves >= minCycles, `expected ≥${minCycles} alt-buffer leaves, got ${leaves}`);
}

/** Extract visible lines from an @xterm/headless buffer. */
export function frameAt(terminal: {buffer: {active: {length: number; getLine: (y: number) => {translateToString: (trim?: boolean) => string} | undefined}}}): string {
	const buf = terminal.buffer.active;
	const lines: string[] = [];
	for (let y = 0; y < buf.length; y++) {
		const line = buf.getLine(y);
		if (line) lines.push(line.translateToString(true));
	}
	return lines.join('\n').replace(/\s+$/gm, '').trimEnd();
}

export function scrollbackLines(
	terminal: {buffer: {active: {length: number; getLine: (y: number) => {translateToString: (trim?: boolean) => string} | undefined}}}
): string[] {
	const buf = terminal.buffer.active;
	const lines: string[] = [];
	for (let y = 0; y < buf.length; y++) {
		const line = buf.getLine(y);
		if (line) {
			const text = line.translateToString(true).replace(/\s+$/g, '');
			if (text.length > 0) lines.push(text);
		}
	}
	return lines;
}
