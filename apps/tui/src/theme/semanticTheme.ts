/**
 * Semantic theme tokens — components must use these, never raw colors.
 *
 * Two layers: each theme maps a concrete palette into semantic roles
 * (text/status/border/diff/...). Components only ever reference the semantic
 * layer, so adding a theme never touches a component. Hex values are safe
 * everywhere: chalk downsamples to 256/16 colors on lesser terminals, and the
 * `ansi`/`no-color` themes provide explicit degraded palettes.
 */
export type SemanticTheme = {
	text: {
		primary: string;
		secondary: string;
		muted: string;
		accent: string;
		inverse: string;
	};
	status: {
		success: string;
		warning: string;
		danger: string;
		info: string;
		running: string;
	};
	border: {
		default: string;
		focus: string;
		panel: string;
	};
	background: {
		panel: string;
		focus: string;
		selection: string;
		/**
		 * User-message strip (claude-code v2 style). Optional so custom JSON
		 * themes keep loading; renderers fall back to `focus`.
		 */
		userMessage?: string;
	};
	/** Diff rendering. Omitted backgrounds mean prefix-only (+/-) mode. */
	diff: {
		addedBg?: string;
		removedBg?: string;
		addedFg: string;
		removedFg: string;
	};
	tool: {
		shell: string;
		diff: string;
		file: string;
	};
	dialog: {
		title: string;
		footer: string;
	};
	/** Brand gradient cycled by the shared spinner clock. */
	spinner: string[];
	dim: boolean;
	noColor: boolean;
};

/** One Dark — default dark theme. */
export const defaultDarkTheme: SemanticTheme = {
	text: {
		primary: '#E8EAED',
		secondary: '#9DA5B4',
		muted: '#697078',
		accent: '#58B6E8',
		inverse: '#1E2227'
	},
	status: {
		success: '#5FC88B',
		warning: '#E5C07B',
		danger: '#E06C75',
		info: '#61AFEF',
		running: '#56B6C2'
	},
	border: {
		default: '#3E4451',
		focus: '#58B6E8',
		panel: '#3E4451'
	},
	background: {
		panel: '#23272E',
		focus: '#2C313A',
		selection: '#264F78',
		userMessage: '#343B45'
	},
	diff: {
		addedBg: '#1C3A2A',
		removedBg: '#41282B',
		addedFg: '#9FE6B8',
		removedFg: '#F0A8AE'
	},
	tool: {
		shell: '#98C379',
		diff: '#C678DD',
		file: '#61AFEF'
	},
	dialog: {
		title: '#58B6E8',
		footer: '#697078'
	},
	spinner: ['#58B6E8', '#56B6C2', '#5FC88B', '#56B6C2'],
	dim: true,
	noColor: false
};

/** One Light — default light theme. */
export const defaultLightTheme: SemanticTheme = {
	text: {
		primary: '#383A42',
		secondary: '#696C77',
		muted: '#A0A1A7',
		accent: '#4078F2',
		inverse: '#FAFAFA'
	},
	status: {
		success: '#50A14F',
		warning: '#C18401',
		danger: '#E45649',
		info: '#0184BC',
		running: '#0997B3'
	},
	border: {
		default: '#D4D4D4',
		focus: '#4078F2',
		panel: '#D4D4D4'
	},
	background: {
		panel: '#F0F0F1',
		focus: '#E5E5E6',
		selection: '#CCE0FF',
		userMessage: '#E4E4E5'
	},
	diff: {
		addedBg: '#DDF4DF',
		removedBg: '#FBE3E4',
		addedFg: '#22863A',
		removedFg: '#B31D28'
	},
	tool: {
		shell: '#50A14F',
		diff: '#A626A4',
		file: '#0184BC'
	},
	dialog: {
		title: '#4078F2',
		footer: '#A0A1A7'
	},
	spinner: ['#4078F2', '#0997B3', '#50A14F', '#0997B3'],
	dim: true,
	noColor: false
};

export const draculaTheme: SemanticTheme = {
	text: {
		primary: '#F8F8F2',
		secondary: '#BFC7D5',
		muted: '#6272A4',
		accent: '#BD93F9',
		inverse: '#282A36'
	},
	status: {
		success: '#50FA7B',
		warning: '#F1FA8C',
		danger: '#FF5555',
		info: '#8BE9FD',
		running: '#FF79C6'
	},
	border: {
		default: '#44475A',
		focus: '#BD93F9',
		panel: '#44475A'
	},
	background: {
		panel: '#313342',
		focus: '#3B3D4F',
		selection: '#44475A',
		userMessage: '#454860'
	},
	diff: {
		addedBg: '#1F3D2B',
		removedBg: '#46262E',
		addedFg: '#8AF7A6',
		removedFg: '#FF9AA0'
	},
	tool: {
		shell: '#50FA7B',
		diff: '#FF79C6',
		file: '#8BE9FD'
	},
	dialog: {
		title: '#BD93F9',
		footer: '#6272A4'
	},
	spinner: ['#BD93F9', '#FF79C6', '#8BE9FD', '#FF79C6'],
	dim: true,
	noColor: false
};

export const gruvboxDarkTheme: SemanticTheme = {
	text: {
		primary: '#EBDBB2',
		secondary: '#BDAE93',
		muted: '#928374',
		accent: '#83A598',
		inverse: '#282828'
	},
	status: {
		success: '#B8BB26',
		warning: '#FABD2F',
		danger: '#FB4934',
		info: '#83A598',
		running: '#8EC07C'
	},
	border: {
		default: '#504945',
		focus: '#83A598',
		panel: '#504945'
	},
	background: {
		panel: '#32302F',
		focus: '#3C3836',
		selection: '#504945',
		userMessage: '#46403D'
	},
	diff: {
		addedBg: '#32361A',
		removedBg: '#442E2D',
		addedFg: '#D5D89A',
		removedFg: '#FCA5A0'
	},
	tool: {
		shell: '#B8BB26',
		diff: '#D3869B',
		file: '#83A598'
	},
	dialog: {
		title: '#83A598',
		footer: '#928374'
	},
	spinner: ['#83A598', '#8EC07C', '#B8BB26', '#8EC07C'],
	dim: true,
	noColor: false
};

export const nordTheme: SemanticTheme = {
	text: {
		primary: '#ECEFF4',
		secondary: '#D8DEE9',
		muted: '#616E88',
		accent: '#88C0D0',
		inverse: '#2E3440'
	},
	status: {
		success: '#A3BE8C',
		warning: '#EBCB8B',
		danger: '#BF616A',
		info: '#81A1C1',
		running: '#8FBCBB'
	},
	border: {
		default: '#434C5E',
		focus: '#88C0D0',
		panel: '#434C5E'
	},
	background: {
		panel: '#3B4252',
		focus: '#434C5E',
		selection: '#4C566A',
		userMessage: '#4A5468'
	},
	diff: {
		addedBg: '#37422F',
		removedBg: '#4B3138',
		addedFg: '#C5D9AF',
		removedFg: '#E4A6AC'
	},
	tool: {
		shell: '#A3BE8C',
		diff: '#B48EAD',
		file: '#81A1C1'
	},
	dialog: {
		title: '#88C0D0',
		footer: '#616E88'
	},
	spinner: ['#88C0D0', '#8FBCBB', '#A3BE8C', '#8FBCBB'],
	dim: true,
	noColor: false
};

export const solarizedLightTheme: SemanticTheme = {
	text: {
		primary: '#586E75',
		secondary: '#657B83',
		muted: '#93A1A1',
		accent: '#268BD2',
		inverse: '#FDF6E3'
	},
	status: {
		success: '#859900',
		warning: '#B58900',
		danger: '#DC322F',
		info: '#2AA198',
		running: '#6C71C4'
	},
	border: {
		default: '#EEE8D5',
		focus: '#268BD2',
		panel: '#EEE8D5'
	},
	background: {
		panel: '#EEE8D5',
		focus: '#E4DECB',
		selection: '#D3CBB7',
		userMessage: '#E7E0CD'
	},
	diff: {
		addedBg: '#E4EBC9',
		removedBg: '#F8DDD4',
		addedFg: '#5A6E00',
		removedFg: '#A02622'
	},
	tool: {
		shell: '#859900',
		diff: '#D33682',
		file: '#268BD2'
	},
	dialog: {
		title: '#268BD2',
		footer: '#93A1A1'
	},
	spinner: ['#268BD2', '#2AA198', '#859900', '#2AA198'],
	dim: true,
	noColor: false
};

/** Plain 16-color palette for terminals without truecolor. */
export const ansiTheme: SemanticTheme = {
	text: {
		primary: 'white',
		secondary: 'gray',
		muted: 'gray',
		accent: 'cyan',
		inverse: 'black'
	},
	status: {
		success: 'green',
		warning: 'yellow',
		danger: 'red',
		info: 'blue',
		running: 'cyan'
	},
	border: {
		default: 'gray',
		focus: 'cyan',
		panel: 'gray'
	},
	background: {
		panel: 'black',
		focus: 'black',
		selection: 'blue',
		userMessage: 'blackBright'
	},
	diff: {
		// No backgrounds: prefix-only diff on 16-color terminals.
		addedFg: 'green',
		removedFg: 'red'
	},
	tool: {
		shell: 'green',
		diff: 'magenta',
		file: 'blue'
	},
	dialog: {
		title: 'cyan',
		footer: 'gray'
	},
	spinner: ['cyan'],
	dim: true,
	noColor: false
};

export const noColorTheme: SemanticTheme = {
	...defaultDarkTheme,
	text: {...defaultDarkTheme.text, accent: 'white'},
	status: {
		success: 'white',
		warning: 'white',
		danger: 'white',
		info: 'white',
		running: 'white'
	},
	border: {...defaultDarkTheme.border, focus: 'white'},
	diff: {addedFg: 'white', removedFg: 'white'},
	tool: {shell: 'white', diff: 'white', file: 'white'},
	dialog: {title: 'white', footer: 'white'},
	spinner: ['white'],
	noColor: true
};

/** Theme names are open (custom JSON themes register at startup). */
export type ThemeName = string;

const registry = new Map<ThemeName, SemanticTheme>([
	['default-dark', defaultDarkTheme],
	['default-light', defaultLightTheme],
	['dracula', draculaTheme],
	['gruvbox-dark', gruvboxDarkTheme],
	['nord', nordTheme],
	['solarized-light', solarizedLightTheme],
	['ansi', ansiTheme],
	['no-color', noColorTheme]
]);

export function registerTheme(name: ThemeName, theme: SemanticTheme): void {
	registry.set(name, theme);
}

export function hasTheme(name: ThemeName): boolean {
	return registry.has(name);
}

export function getThemeNames(): ThemeName[] {
	return [...registry.keys()];
}

export function resolveTheme(name: ThemeName = 'default-dark'): SemanticTheme {
	return registry.get(name) ?? defaultDarkTheme;
}

/* ==================== Terminal background adaptation ==================== */

import {getLuminance, blendOverBackground} from './colorUtils.js';

/**
 * Produce a variant of `theme` whose background colours are relative to
 * the terminal's actual background (`terminalBgHex`, with or without `#`).
 *
 * This makes the app blend seamlessly with the terminal: the root
 * box uses the exact terminal background colour, and derived interior
 * backgrounds (focus, selection, user-message, borders) are subtly
 * different via alpha‑blending.
 *
 * When `terminalBgHex` is missing or the terminal background is
 * incompatible with the theme type (e.g. light terminal with dark theme),
 * the original theme is returned unchanged.
 *
 * @param theme         The resolved semantic theme.
 * @param terminalBgHex 6‑digit hex colour (with or without `#`), or undefined.
 * @returns A theme with terminal‑aware background colours.
 */
export function applyTerminalBackground(
	theme: SemanticTheme,
	terminalBgHex: string | undefined,
): SemanticTheme {
	if (!terminalBgHex) return theme;

	const hex = terminalBgHex.replace(/^#/, '');
	if (hex.length !== 6) return theme;

	const lum = getLuminance(`#${hex}`);
	const isDarkTerminal = lum < 0.5;
	const isDarkTheme =
		getLuminance(theme.background.panel) < 0.5;

	// Terminal-adaptive backgrounds (gemini-cli approach).
	//
	// The root panel is always set to the *exact* terminal background
	// colour so the app seamlessly blends with the terminal (no gray
	// "patch").  All derived backgrounds (focus, selection, user‑message,
	// border) are blended *directly* over the raw terminal background,
	// avoiding cascaded colour drift.
	//
	// When the theme and terminal brightness disagree (e.g. light theme
	// on a dark terminal), the theme's foreground colours would be
	// illegible on the adapted panel.  In that case we swap the text
	// palette to the opposite brightness so content stays readable.
	const termBg = `#${hex}`;
	const blend = isDarkTerminal ? '#FFFFFF' : '#000000';

	const result: SemanticTheme = {
		...theme,
		background: {
			...theme.background,
			panel: termBg,
			focus: blendOverBackground(blend, termBg, 0.07),
			selection: blendOverBackground(
				isDarkTerminal ? '#58B6E8' : '#4078F2',
				termBg,
				0.15,
			),
			userMessage: blendOverBackground(blend, termBg, 0.12),
		},
		border: {
			...theme.border,
			default: blendOverBackground(blend, termBg, 0.20),
			panel: blendOverBackground(blend, termBg, 0.20),
		},
	};

	// When the theme and terminal brightness disagree, swap the text
	// palette so foreground colours remain readable on the (terminal-
	// matched) panel background.
	if (isDarkTerminal !== isDarkTheme) {
		result.text = isDarkTerminal
			? defaultDarkTheme.text
			: defaultLightTheme.text;
	}

	return result;
}

// Width math lives in utils/textWidth.ts (string-width based, grapheme-safe).
// Re-exported here for backwards compatibility with existing imports.
export {
	stripAnsi,
	visualWidth as getTerminalStringWidth,
	compactPath,
	truncateMiddle,
	truncateEnd,
	fitTerminalLine
} from '../utils/textWidth.js';
