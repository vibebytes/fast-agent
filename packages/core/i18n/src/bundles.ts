import type {Locale} from './locales.ts';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import ptBR from '../locales/pt-BR.json';
import ru from '../locales/ru.json';
import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';

/** Static catalog map — safe for electron-vite / Vite bundlers (no fs). */
export type LocaleBundles = Record<Locale, Record<string, unknown>>;

export const localeBundles: LocaleBundles = {
	en,
	'zh-CN': zhCN,
	ja,
	'pt-BR': ptBR,
	es,
	de,
	'zh-TW': zhTW,
	fr,
	ko,
	ru
};
