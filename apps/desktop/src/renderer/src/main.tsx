import {Profiler, StrictMode, type ProfilerOnRenderCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nextProvider} from 'react-i18next';
import {applyPalette} from '@fast-ide/ui/themes/applyPalette';
import {DEFAULT_PALETTE_ID, PALETTE_THEMES} from '@fast-ide/ui/themes/catalog';
import {Bootstrap} from './Bootstrap';
import {i18n} from './i18n/setup';
import {markTabProfile} from './performanceTrace';
import '@fast-ide/ui/globals.css';

/** Whole-app commit attribution: `app − (transcript-panes + composer)` = chrome cost. */
const profileApp: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
	markTabProfile({subtree: id, phase, actualMs: actualDuration});
};

/** Apply persisted palette before first paint to avoid theme flash. */
try {
	const stored = localStorage.getItem('fast-ide.palette');
	const paletteId =
		stored && PALETTE_THEMES.some(t => t.id === stored) ? stored : DEFAULT_PALETTE_ID;
	const pref = localStorage.getItem('fast-ide.theme') ?? 'system';
	const mode =
		pref === 'dark' || pref === 'light'
			? pref
			: window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light';
	document.documentElement.classList.toggle('dark', mode === 'dark');
	applyPalette(paletteId, mode);
} catch {
	/* ignore */
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Profiler id="app" onRender={profileApp}>
			<I18nextProvider i18n={i18n}>
				<Bootstrap />
			</I18nextProvider>
		</Profiler>
	</StrictMode>
);
