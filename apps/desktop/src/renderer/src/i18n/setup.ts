import {initReactI18next} from 'react-i18next';
import {
	createI18nFromBundles,
	localeBundles,
	resolveLocale,
	type Locale
} from '@fast-ide/i18n';
import {LOCALE_PREF_KEY, readLocalePref, systemTagFromNavigator} from '../localePref';

function initialLng(): Locale {
	try {
		return resolveLocale(
			readLocalePref(localStorage.getItem(LOCALE_PREF_KEY)),
			systemTagFromNavigator()
		);
	} catch {
		return resolveLocale('system', systemTagFromNavigator());
	}
}

export const i18n = createI18nFromBundles(initialLng(), localeBundles, instance =>
	instance.use(initReactI18next)
);
