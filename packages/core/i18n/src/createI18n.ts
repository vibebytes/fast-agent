import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type i18n} from 'i18next';
import {createI18nFromBundles} from './createI18nFromBundles.ts';
import {SUPPORTED, type Locale} from './locales.ts';
import type {LocaleBundles} from './bundles.ts';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '../locales');

function loadBundle(locale: Locale): Record<string, unknown> {
	return JSON.parse(readFileSync(join(localesDir, `${locale}.json`), 'utf8')) as Record<
		string,
		unknown
	>;
}

/** Node/CLI path — loads catalogs via fs (not for electron-vite bundles). */
export function createI18n(lng: Locale): i18n {
	const bundles = Object.fromEntries(
		SUPPORTED.map(locale => [locale, loadBundle(locale)])
	) as LocaleBundles;
	return createI18nFromBundles(lng, bundles);
}
