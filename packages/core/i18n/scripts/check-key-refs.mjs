import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classify, scanRoots} from './keyRefs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../../apps');

/** Every app that renders i18n keys must be listed here, or its typos go unchecked. */
const ROOTS = [
  {name: 'mobile', dir: join(repo, 'mobile/src')},
  {name: 'desktop', dir: join(repo, 'desktop/src')}
];

/**
 * Engine/IPC method names that sit in the `settings.*` namespace the catalog also uses.
 * They are protocol strings, not copy - add new engine methods here when the check reports them.
 */
const IGNORE = new Set([
  'settings.describe',
  'settings.update',
  'settings.mutate',
  'settings.replace',
  'settings.openDocument'
]);

function flatten(obj, prefix = '') {
  if (typeof obj === 'string') return prefix ? {[prefix]: obj} : {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

const catalog = flatten(JSON.parse(readFileSync(join(here, '../locales/en.json'), 'utf8')));
const enKeys = new Set(Object.keys(catalog));
const referenced = scanRoots(ROOTS, enKeys);
const {missing, unknownDynamic} = classify(referenced, enKeys, IGNORE);

if (missing.length > 0 || unknownDynamic.length > 0) {
  console.error('i18n key-ref check failed:');
  if (unknownDynamic.length > 0) {
    console.error('Template keys whose prefix matches no key in locales/en.json:');
    for (const {key, files} of unknownDynamic) console.error(`  ${key}  ←  ${files.join(', ')}`);
  }
  if (missing.length > 0) {
    console.error('Referenced keys missing from locales/en.json:');
    for (const {key, files} of missing) console.error(`  ${key}  ←  ${files.join(', ')}`);
  }
  process.exit(1);
}

console.log(`key-ref OK (${referenced.size} keys across ${ROOTS.map((root) => root.name).join(' + ')}).`);
