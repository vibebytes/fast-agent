import {readdirSync, readFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const enPath = join(here, '../locales/en.json');
const mobileSrc = join(here, '../../../../apps/mobile/src');

const KEY_PREFIX = /(?:mobile|settings|shell)\.[A-Za-z0-9.]+/;
const QUOTED_KEY = /['"]((?:mobile|settings|shell)\.[A-Za-z0-9.]+)['"]/g;
const DYNAMIC_PREFIX = /`((?:mobile|settings|shell)\.[A-Za-z0-9.]*)\$\{/g;

/** Suffixes used by template keys in apps/mobile (keep in sync with ConnectionState / buckets / Copy). */
const DYNAMIC = {
  'mobile.connection.': ['idle', 'connecting', 'hello', 'open', 'closed'],
  'mobile.history.': ['today', 'yesterday', 'week', 'older'],
  'mobile.copy.': ['urlScheme', 'urlInvalid', 'tlsModuleMissing', 'cannotConnect', 'timeout', 'helloOk']
};

function flatten(obj, prefix = '') {
  if (typeof obj === 'string') return prefix ? {[prefix]: obj} : {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (/\.(ts|tsx)$/.test(extname(entry.name))) files.push(path);
  }
  return files;
}

const catalog = flatten(JSON.parse(readFileSync(enPath, 'utf8')));
const enKeys = new Set(Object.keys(catalog));
const referenced = new Map();

function add(key, file) {
  if (!KEY_PREFIX.test(key) || key.endsWith('.')) return;
  const list = referenced.get(key) ?? [];
  list.push(file);
  referenced.set(key, list);
}

for (const file of walk(mobileSrc)) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(mobileSrc.length + 1);
  for (const match of text.matchAll(QUOTED_KEY)) add(match[1], rel);
  for (const match of text.matchAll(DYNAMIC_PREFIX)) {
    const prefix = match[1];
    const suffixes = DYNAMIC[prefix];
    if (!suffixes) {
      add(`${prefix}<dynamic>`, rel);
      continue;
    }
    for (const suffix of suffixes) add(`${prefix}${suffix}`, rel);
  }
}

const missing = [];
const unknownDynamic = [];
for (const [key, files] of [...referenced.entries()].sort()) {
  if (key.endsWith('<dynamic>')) {
    unknownDynamic.push(`  ${key} (${files.join(', ')})`);
    continue;
  }
  if (!enKeys.has(key)) missing.push(`  ${key}  ←  ${files.join(', ')}`);
}

if (unknownDynamic.length > 0 || missing.length > 0) {
  console.error('Mobile i18n key-ref check failed:');
  if (unknownDynamic.length > 0) {
    console.error('Unknown dynamic prefixes (add them to DYNAMIC in check-key-refs.mjs):');
    for (const line of unknownDynamic) console.error(line);
  }
  if (missing.length > 0) {
    console.error('Referenced keys missing from locales/en.json:');
    for (const line of missing) console.error(line);
  }
  process.exit(1);
}

console.log(`Mobile key-ref OK (${referenced.size} keys from ${walk(mobileSrc).length} files).`);
