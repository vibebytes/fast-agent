import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const LOCALES = [
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
];

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '../locales');

function flattenCatalog(obj, prefix = '') {
	if (typeof obj === 'string') {
		return prefix ? {[prefix]: obj} : {};
	}
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
		return {};
	}
	const out = {};
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		Object.assign(out, flattenCatalog(value, path));
	}
	return out;
}

function placeholders(value) {
	return new Set([...value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(m => m[1]));
}

function loadLocale(locale) {
	return JSON.parse(readFileSync(join(localesDir, `${locale}.json`), 'utf8'));
}

const catalogs = Object.fromEntries(LOCALES.map(locale => [locale, flattenCatalog(loadLocale(locale))]));
const enKeys = new Set(Object.keys(catalogs.en));
const errors = [];

for (const locale of LOCALES) {
	if (locale === 'en') continue;
	const flat = catalogs[locale];
	const keys = new Set(Object.keys(flat));

	for (const key of enKeys) {
		if (!keys.has(key)) {
			errors.push(`[${locale}] missing key: ${key}`);
			continue;
		}
		const value = flat[key];
		if (typeof value !== 'string' || value.trim().length === 0) {
			errors.push(`[${locale}] empty value: ${key}`);
			continue;
		}
		const enPh = placeholders(catalogs.en[key]);
		const locPh = placeholders(value);
		for (const ph of enPh) {
			if (!locPh.has(ph)) {
				errors.push(`[${locale}] missing placeholder {{${ph}}} in ${key}`);
			}
		}
	}

	for (const key of keys) {
		if (!enKeys.has(key)) {
			errors.push(`[${locale}] extra key not in en: ${key}`);
		}
	}
}

if (errors.length > 0) {
	console.error('Catalog parity check failed:');
	for (const line of errors) console.error(`  ${line}`);
	process.exit(1);
}

console.log(`Catalog parity OK (${LOCALES.length} locales, ${enKeys.size} keys).`);
