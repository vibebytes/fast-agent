/**
 * OSC 11 terminal background detection: query the terminal's background
 * color before Ink mounts and pick a dark/light default theme automatically
 * (same trick gemini-cli uses). Best-effort with a hard timeout — terminals
 * that don't answer simply get the dark default.
 */

import {getLuminance, rgbToHex as rgbToHexWithHash} from '../theme/colorUtils.js';

export type BackgroundKind = 'dark' | 'light' | 'unknown';

export interface BackgroundInfo {
	kind: BackgroundKind;
	/** The actual 6‑digit hex colour (without `#`) if OSC 11 gave us one. */
	hex: string | undefined;
}

/** Parse an OSC 11 reply like `\x1b]11;rgb:1e1e/2222/2727\x07`. */
export function parseOsc11Response(data: string): {r: number; g: number; b: number} | undefined {
	const match = data.match(/\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/);
	if (!match) return undefined;
	const scale = (channel: string) => {
		const value = Number.parseInt(channel, 16);
		const max = 16 ** channel.length - 1;
		return Math.round((value / max) * 255);
	};
	return {r: scale(match[1]!), g: scale(match[2]!), b: scale(match[3]!)};
}

/** Convert {r,g,b} → 6-char hex string (no `#`) — thin wrapper over colorUtils. */
export function rgbToHex(r: number, g: number, b: number): string {
	return rgbToHexWithHash(r, g, b).slice(1);
}

/** Shortcut: parse an OSC 11 response and also return the hex. */
export function parseOsc11AsHex(data: string): string | undefined {
	const rgb = parseOsc11Response(data);
	return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : undefined;
}

/**
 * Dark/light split via the SAME sRGB relative luminance the theme layer uses
 * (colorUtils.getLuminance). Two different luma formulas used to disagree on
 * mid-gray terminal backgrounds, making detection and theme adaptation fight.
 */
export function classifyBackground(rgb: {r: number; g: number; b: number}): BackgroundKind {
	return getLuminance(rgbToHexWithHash(rgb.r, rgb.g, rgb.b)) >= 0.5 ? 'light' : 'dark';
}

export async function detectTerminalBackground(timeoutMs = 150): Promise<BackgroundInfo> {
	const {stdin, stdout} = process;
	if (!stdin.isTTY || !stdout.isTTY) {
		return {kind: 'unknown', hex: undefined};
	}

	return new Promise<BackgroundInfo>(resolve => {
		let settled = false;
		let buffer = '';
		const wasRaw = stdin.isRaw;

		const finish = (result: BackgroundInfo) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stdin.off('data', onData);
			try {
				if (!wasRaw) stdin.setRawMode(false);
				stdin.pause();
			} catch {
				// Terminal teardown races are non-fatal here.
			}
			resolve(result);
		};

		const onData = (chunk: Buffer) => {
			buffer += chunk.toString('utf8');
			const rgb = parseOsc11Response(buffer);
			if (rgb) {
				finish({
					kind: classifyBackground(rgb),
					hex: rgbToHex(rgb.r, rgb.g, rgb.b),
				});
			}
		};

		const timer = setTimeout(() => finish({kind: 'unknown', hex: undefined}), timeoutMs);
		timer.unref?.();

		try {
			stdin.setRawMode(true);
			stdin.resume();
			stdin.on('data', onData);
			// BEL-terminated query; most terminals reply with OSC 11 + BEL/ST.
			stdout.write('\u001b]11;?\u0007');
		} catch {
			finish({kind: 'unknown', hex: undefined});
		}
	});
}
