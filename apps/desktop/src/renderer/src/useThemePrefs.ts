import {useEffect, useState} from 'react';
import {applyPalette} from '@fast-ide/ui/themes/applyPalette';
import {DEFAULT_PALETTE_ID, PALETTE_THEMES} from '@fast-ide/ui/themes/catalog';

type ThemePreference = 'light' | 'dark' | 'system';

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
	try {
		const raw = localStorage.getItem(key);
		if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
	} catch {
		/* ignore */
	}
	return fallback;
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
	if (pref === 'light' || pref === 'dark') return pref;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Theme / palette chrome (perf doc P2-14, extracted from App). */
export function useThemePrefs(): {
	theme: 'light' | 'dark';
	paletteId: string;
	setPaletteId: (id: string) => void;
} {
	const [themePref] = useState<ThemePreference>(() =>
		readStored('fast-ide.theme', 'system', ['light', 'dark', 'system'] as const)
	);
	const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme(themePref));
	const [paletteId, setPaletteId] = useState(() => {
		try {
			const raw = localStorage.getItem('fast-ide.palette');
			if (raw && PALETTE_THEMES.some(t => t.id === raw)) return raw;
		} catch {
			/* ignore */
		}
		return DEFAULT_PALETTE_ID;
	});

	useEffect(() => {
		localStorage.setItem('fast-ide.theme', themePref);
		const apply = () => setTheme(resolveTheme(themePref));
		apply();
		if (themePref !== 'system') return;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => apply();
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [themePref]);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
	}, [theme]);

	useEffect(() => {
		localStorage.setItem('fast-ide.palette', paletteId);
		applyPalette(paletteId, theme);
	}, [paletteId, theme]);

	return {theme, paletteId, setPaletteId};
}
