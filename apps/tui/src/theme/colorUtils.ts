/**
 * Color interpolation utilities — ported from gemini-cli's design.
 *
 * These let us derive semantic background colors (input, message, border,
 * focus) from the terminal's actual background color, so the app blends
 * naturally with the host terminal.
 */

/* ============================== RGB converters ============================ */

export function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace(/^#/, '');
	if (h.length === 3) {
		return [
			parseInt(h[0]! + h[0], 16),
			parseInt(h[1]! + h[1], 16),
			parseInt(h[2]! + h[2], 16),
		];
	}
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
	];
}

export function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return `#${[r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/* ================================ Luminance =============================== */

export function getLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex);
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Returns 'dark' or 'light' based on the background — i.e. the kind of theme that works on it. */
export function getThemeTypeFromBackgroundColor(hex: string): 'dark' | 'light' {
	return getLuminance(hex) < 0.5 ? 'dark' : 'light';
}

/* ============================== Interpolation ============================= */

/**
 * Linear interpolation between two hex colors.
 * `ratio` ∈ [0,1] — 0 → color1, 1 → color2.
 */
export function interpolateColor(color1: string, color2: string, ratio: number): string {
	const [r1, g1, b1] = hexToRgb(color1);
	const [r2, g2, b2] = hexToRgb(color2);
	const t = Math.max(0, Math.min(1, ratio));
	return rgbToHex(
		r1 + (r2 - r1) * t,
		g1 + (g2 - g1) * t,
		b1 + (b2 - b1) * t,
	);
}

/* ====================== Theme-aware background helpers ==================== */

/**
 * Pick a text color (black or white) that has sufficient contrast
 * against the given background.
 */
export function contrastText(hex: string): string {
	return getLuminance(hex) > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Blend a foreground color over a background color at the given opacity
 * (alpha ∈ [0, 1]).  This approximates CSS `rgba(foreground, alpha)` on
 * top of `background`.
 */
export function blendOverBackground(fgHex: string, bgHex: string, alpha: number): string {
	const [fr, fg, fb] = hexToRgb(fgHex);
	const [br, bg, bb] = hexToRgb(bgHex);
	const a = Math.max(0, Math.min(1, alpha));
	return rgbToHex(
		fr * a + br * (1 - a),
		fg * a + bg * (1 - a),
		fb * a + bb * (1 - a),
	);
}
