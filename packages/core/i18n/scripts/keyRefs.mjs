import {readdirSync, readFileSync} from 'node:fs';
import {extname, join} from 'node:path';

const KEY_PREFIX = /(?:mobile|settings|shell)\.[A-Za-z0-9.]+/;
const QUOTED_KEY = /['"]((?:mobile|settings|shell)\.[A-Za-z0-9.]+)['"]/g;
const DYNAMIC_PREFIX = /`((?:mobile|settings|shell)\.[A-Za-z0-9.]*)\$\{/g;

/** Runtime value lists for template keys whose values are not derivable from the catalog. */
export const DYNAMIC = {
  'mobile.connection.': ['idle', 'connecting', 'hello', 'open', 'closed'],
  'mobile.history.': ['today', 'yesterday', 'week', 'older'],
  'mobile.brief.verb.': ['shell', 'file', 'search', 'git', 'agent', 'system'],
  'mobile.copy.': ['urlScheme', 'urlInvalid', 'tlsModuleMissing', 'cannotConnect', 'timeout', 'helloOk']
};

const isKey = (key) => KEY_PREFIX.test(key) && !key.endsWith('.');

export function refsInText(text, enKeys, dynamic = DYNAMIC) {
  const refs = [];
  for (const match of text.matchAll(QUOTED_KEY)) refs.push(match[1]);
  for (const match of text.matchAll(DYNAMIC_PREFIX)) {
    const prefix = match[1];
    const suffixes = dynamic[prefix];
    if (suffixes) {
      for (const suffix of suffixes) refs.push(`${prefix}${suffix}`);
      continue;
    }
    const derived = [...enKeys].filter((key) => key.startsWith(prefix));
    if (derived.length === 0) refs.push(`${prefix}<dynamic>`);
    else refs.push(...derived);
  }
  return refs.filter(isKey);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (/\.(ts|tsx)$/.test(extname(entry.name))) files.push(path);
  }
  return files;
}

export function scanRoots(roots, enKeys, dynamic = DYNAMIC) {
  const referenced = new Map();
  for (const {name, dir} of roots) {
    for (const file of walk(dir)) {
      const rel = `${name}/${file.slice(dir.length + 1)}`;
      for (const key of refsInText(readFileSync(file, 'utf8'), enKeys, dynamic)) {
        const list = referenced.get(key) ?? [];
        if (!list.includes(rel)) list.push(rel);
        referenced.set(key, list);
      }
    }
  }
  return referenced;
}

export function classify(referenced, enKeys, ignore = new Set()) {
  const missing = [];
  const unknownDynamic = [];
  for (const [key, files] of [...referenced.entries()].sort()) {
    if (ignore.has(key)) continue;
    if (key.endsWith('<dynamic>')) unknownDynamic.push({key, files});
    else if (!enKeys.has(key)) missing.push({key, files});
  }
  return {missing, unknownDynamic};
}
