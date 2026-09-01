/** Browser-safe surface — excludes Node `createI18n` (fs). */
export {
	LOCALE_NATIVE_NAME,
	SUPPORTED,
	type Locale,
	type LocalePref
} from './locales.ts';
export {normalizeLocale, resolveLocale} from './resolve.ts';
export {localeBundles, type LocaleBundles} from './bundles.ts';
export {createI18nFromBundles} from './createI18nFromBundles.ts';
export {flattenCatalog} from './catalog.ts';
