import {getPaletteTheme, type PaletteModeVars} from './catalog';

/** Light-mode step: sidebar sits slightly below background (Codex-like plane). */
export const SIDEBAR_LIGHT_SINK_L = 0.02;

const MANAGED_KEYS = [
	'background',
	'foreground',
	'card',
	'card-foreground',
	'popover',
	'popover-foreground',
	'primary',
	'primary-foreground',
	'secondary',
	'secondary-foreground',
	'muted',
	'muted-foreground',
	'accent',
	'accent-foreground',
	'destructive',
	'border',
	'input',
	'ring',
	'chart-1',
	'chart-2',
	'chart-3',
	'chart-4',
	'chart-5',
	'sidebar',
	'sidebar-foreground',
	'sidebar-primary',
	'sidebar-primary-foreground',
	'sidebar-accent',
	'sidebar-accent-foreground',
	'sidebar-border',
	'sidebar-ring'
] as const;

/**
 * Lower OKLCH lightness by `delta` (relative plane step). Non-oklch values pass through.
 */
export function sinkOklchLightness(color: string, delta = SIDEBAR_LIGHT_SINK_L): string {
	const m = /^oklch\(\s*([0-9]*\.?[0-9]+)/i.exec(color.trim());
	if (!m) return color;
	const next = Math.max(0, Number(m[1]) - delta);
	// Preserve trailing channels / alpha as written.
	return color.replace(/^oklch\(\s*[0-9]*\.?[0-9]+/i, `oklch(${formatL(next)}`);
}

function formatL(n: number): string {
	const s = n.toFixed(4).replace(/\.?0+$/, '');
	return s.length > 0 ? s : '0';
}

/**
 * Resolve `--sidebar` for a palette mode.
 * Light + missing sidebar: sink from background (then card). Dark: keep prior fallback (no sink).
 */
export function resolveSidebarColor(
	vars: PaletteModeVars,
	mode: 'light' | 'dark'
): string | undefined {
	if (vars.sidebar) return vars.sidebar;
	if (mode === 'light') {
		const base = vars.background ?? vars.card;
		return base ? sinkOklchLightness(base) : undefined;
	}
	return vars.card ?? vars.background;
}

export function withSidebar(
	vars: PaletteModeVars,
	mode: 'light' | 'dark' = 'light'
): PaletteModeVars {
	const sidebar = resolveSidebarColor(vars, mode);
	const mutedOrSecondary = vars.muted ?? vars.secondary;
	// Light: keep Clear row pills — sink muted so hover/selected stay visible on sunk sidebar.
	const sidebarAccent =
		vars['sidebar-accent'] ??
		(mode === 'light' && mutedOrSecondary
			? sinkOklchLightness(mutedOrSecondary, 0.05)
			: mutedOrSecondary);
	return {
		...vars,
		...(sidebar ? {sidebar} : {}),
		'sidebar-foreground': vars['sidebar-foreground'] ?? vars['card-foreground'] ?? vars.foreground,
		'sidebar-primary': vars['sidebar-primary'] ?? vars.primary,
		'sidebar-primary-foreground':
			vars['sidebar-primary-foreground'] ?? vars['primary-foreground'],
		...(sidebarAccent ? {'sidebar-accent': sidebarAccent} : {}),
		'sidebar-accent-foreground':
			vars['sidebar-accent-foreground'] ?? vars['muted-foreground'] ?? vars.foreground,
		'sidebar-border': vars['sidebar-border'] ?? vars.border,
		'sidebar-ring': vars['sidebar-ring'] ?? vars.ring
	};
}

/** Apply Palette/UI cssVars for the active light/dark mode onto `:root`. */
export function applyPalette(paletteId: string, mode: 'light' | 'dark'): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const theme = getPaletteTheme(paletteId);
	const vars = withSidebar(theme.cssVars[mode] ?? theme.cssVars.light, mode);

	root.dataset.palette = theme.id;

	for (const key of MANAGED_KEYS) {
		const value = vars[key];
		if (value) root.style.setProperty(`--${key}`, value);
		else root.style.removeProperty(`--${key}`);
	}
}

export function clearPaletteOverrides(): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	delete root.dataset.palette;
	for (const key of MANAGED_KEYS) {
		root.style.removeProperty(`--${key}`);
	}
}
