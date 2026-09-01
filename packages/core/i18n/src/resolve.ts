import {SUPPORTED, type Locale, type LocalePref} from './locales.ts';

export function normalizeLocale(tag: string): Locale {
	const raw = tag.trim().replace('_', '-');
	const lower = raw.toLowerCase();
	if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn') return 'zh-CN';
	if (lower.startsWith('zh-hant') || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo')
		return 'zh-TW';
	if (lower === 'pt' || lower.startsWith('pt-')) return 'pt-BR';
	const primary = lower.split('-')[0] ?? lower;
	const map: Record<string, Locale> = {
		en: 'en',
		ja: 'ja',
		es: 'es',
		de: 'de',
		fr: 'fr',
		ko: 'ko',
		ru: 'ru'
	};
	return map[primary] ?? 'en';
}

export function resolveLocale(pref: LocalePref, systemTag: string): Locale {
	if (pref !== 'system' && (SUPPORTED as readonly string[]).includes(pref)) return pref;
	return normalizeLocale(systemTag);
}
