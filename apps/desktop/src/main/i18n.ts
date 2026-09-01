import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {app} from 'electron';
import {type i18n as I18n} from 'i18next';
import {
	createI18nFromBundles,
	localeBundles,
	resolveLocale,
	SUPPORTED,
	type LocalePref
} from '@fast-ide/i18n/browser';
import {setHostLocale} from './bridge/hostT.js';

const PREF_FILE = 'locale-pref.json';
const ALLOWED: readonly LocalePref[] = ['system', ...SUPPORTED];

function localePrefPath(): string {
	const dir = app.getPath('userData');
	if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
	return join(dir, PREF_FILE);
}

export function asLocalePref(raw: unknown): LocalePref {
	if (typeof raw === 'string' && (ALLOWED as readonly string[]).includes(raw)) {
		return raw as LocalePref;
	}
	return 'system';
}

/** Persisted main-side pref (survives cold start before renderer sync). */
export function loadLocalePref(): LocalePref {
	try {
		const data = JSON.parse(readFileSync(localePrefPath(), 'utf8')) as {pref?: unknown};
		return asLocalePref(data.pref);
	} catch {
		return 'system';
	}
}

export function saveLocalePref(pref: LocalePref): void {
	writeFileSync(localePrefPath(), JSON.stringify({pref}, null, 2));
}

let instance: I18n | null = null;

export function mainI18n(): I18n {
	if (!instance) {
		const lng = resolveLocale(loadLocalePref(), app.getLocale());
		instance = createI18nFromBundles(lng, localeBundles);
		void setHostLocale(lng);
	}
	return instance;
}

export async function applyLocalePref(pref: LocalePref): Promise<void> {
	const lng = resolveLocale(pref, app.getLocale());
	await mainI18n().changeLanguage(lng);
	await setHostLocale(lng);
}
