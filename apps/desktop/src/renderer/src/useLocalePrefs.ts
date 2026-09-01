import {useCallback, useEffect, useState} from 'react';
import {resolveLocale, type Locale, type LocalePref} from '@fast-ide/i18n';
import {i18n} from './i18n/setup';
import {LOCALE_PREF_KEY, readLocalePref, systemTagFromNavigator} from './localePref';

export {readLocalePref, systemTagFromNavigator, LOCALE_PREF_KEY} from './localePref';

function storedLocalePref(): LocalePref {
	try {
		return readLocalePref(localStorage.getItem(LOCALE_PREF_KEY));
	} catch {
		return 'system';
	}
}

/** Locale preference (localStorage + system languagechange). */
export function useLocalePrefs(): {
	localePref: LocalePref;
	locale: Locale;
	setLocalePref: (pref: LocalePref) => void;
} {
	const [localePref, setLocalePrefState] = useState<LocalePref>(storedLocalePref);
	const [locale, setLocale] = useState<Locale>(() =>
		resolveLocale(localePref, systemTagFromNavigator())
	);

	const apply = useCallback((pref: LocalePref) => {
		const resolved = resolveLocale(pref, systemTagFromNavigator());
		setLocale(resolved);
		void i18n.changeLanguage(resolved);
	}, []);

	const setLocalePref = useCallback((pref: LocalePref) => {
		setLocalePrefState(pref);
		try {
			localStorage.setItem(LOCALE_PREF_KEY, pref);
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		apply(localePref);
		void window.fastIde.setLocalePref(localePref);
		if (localePref !== 'system') return;
		const onChange = () => {
			apply('system');
			void window.fastIde.setLocalePref('system');
		};
		window.addEventListener('languagechange', onChange);
		return () => window.removeEventListener('languagechange', onChange);
	}, [localePref, apply]);

	return {localePref, locale, setLocalePref};
}
