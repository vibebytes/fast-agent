import {SUPPORTED, type LocalePref} from '@fast-ide/i18n';

export const LOCALE_PREF_KEY = 'fast-ide.localePref';

const ALLOWED: readonly LocalePref[] = ['system', ...SUPPORTED];

export function readLocalePref(raw: string | null): LocalePref {
	if (raw && (ALLOWED as readonly string[]).includes(raw)) return raw as LocalePref;
	return 'system';
}

export function systemTagFromNavigator(): string {
	return typeof navigator !== 'undefined' ? navigator.language : 'en';
}
