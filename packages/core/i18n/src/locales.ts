export type Locale =
	| 'en'
	| 'zh-CN'
	| 'ja'
	| 'pt-BR'
	| 'es'
	| 'de'
	| 'zh-TW'
	| 'fr'
	| 'ko'
	| 'ru';

export type LocalePref = 'system' | Locale;

export const SUPPORTED: readonly Locale[] = [
	'en',
	'zh-CN',
	'ja',
	'pt-BR',
	'es',
	'de',
	'zh-TW',
	'fr',
	'ko',
	'ru'
] as const;

export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
	en: 'English',
	'zh-CN': '简体中文',
	ja: '日本語',
	'pt-BR': 'Português (Brasil)',
	es: 'Español',
	de: 'Deutsch',
	'zh-TW': '繁體中文',
	fr: 'Français',
	ko: '한국어',
	ru: 'Русский'
};
