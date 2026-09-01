/**
 * Node-safe Host copy (no Electron). SessionController + other bridge code use this
 * for user-visible sentences; main syncs language via `setHostLocale`.
 */
import {
	createI18nFromBundles,
	localeBundles,
	type Locale
} from '@fast-ide/i18n/browser';

const i18n = createI18nFromBundles('en', localeBundles);

export function hostT(key: string, params?: Record<string, string | number>): string {
	return i18n.t(key, params);
}

export async function setHostLocale(locale: Locale): Promise<void> {
	await i18n.changeLanguage(locale);
}
