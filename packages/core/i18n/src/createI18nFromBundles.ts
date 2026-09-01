import i18next, {type i18n} from 'i18next';
import {localeBundles, type LocaleBundles} from './bundles.ts';
import type {Locale} from './locales.ts';

/** Bundler-safe i18n factory shared by desktop main + renderer. */
export function createI18nFromBundles(
	lng: Locale,
	bundles: LocaleBundles = localeBundles,
	configure?: (instance: i18n) => i18n
): i18n {
	let instance = i18next.createInstance();
	if (configure) instance = configure(instance);
	void instance.init({
		lng,
		fallbackLng: 'en',
		resources: Object.fromEntries(
			Object.entries(bundles).map(([k, v]) => [k, {translation: v}])
		),
		interpolation: {escapeValue: false}
	});
	return instance;
}
