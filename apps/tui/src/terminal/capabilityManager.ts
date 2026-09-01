export type TerminalCapabilities = {
	width: number;
	height: number;
	colorDepth: number;
	unicode: boolean;
	noColor: boolean;
	screenReader: boolean;
	dumbTerminal: boolean;
	keyProtocol: 'default' | 'kitty' | 'modifyOtherKeys';
};

export function detectTerminalCapabilities(): TerminalCapabilities {
	const width = process.stdout.columns ?? 80;
	const height = process.stdout.rows ?? 24;
	const noColor = process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === '0';
	const term = process.env.TERM ?? '';
	const dumbTerminal = term === 'dumb' || !process.stdout.isTTY;
	const screenReader = process.env.FAST_SCREEN_READER === '1';

	return {
		width,
		height,
		colorDepth: noColor || dumbTerminal ? 1 : detectColorDepth(term),
		unicode: detectUnicodeSupport(dumbTerminal),
		noColor,
		screenReader,
		dumbTerminal,
		keyProtocol: 'default'
	};
}

/** Color depth in bits: 24 (truecolor), 8 (256 colors) or 4 (16 colors). */
function detectColorDepth(term: string): number {
	const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
	if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 24;
	if (process.env.TERM_PROGRAM === 'iTerm.app' || process.env.TERM_PROGRAM === 'vscode') return 24;
	if (term.includes('256color')) return 8;
	return 4;
}

function detectUnicodeSupport(dumbTerminal: boolean): boolean {
	if (dumbTerminal) return false;
	const locale = process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? '';
	if (locale.length === 0) {
		// macOS terminals are UTF-8 by default even without locale env vars.
		return process.platform === 'darwin';
	}
	return /utf-?8/i.test(locale);
}

/** Cheap accessor for components that only need the screen-reader flag. */
export function isScreenReader(): boolean {
	return process.env.FAST_SCREEN_READER === '1';
}

export function shouldUseAlternateBuffer(caps: TerminalCapabilities): boolean {
	return !caps.dumbTerminal && !caps.screenReader && caps.height >= 24;
}

export function effectiveWidth(caps: TerminalCapabilities, reserve = 2): number {
	return Math.max(20, caps.width - reserve);
}
