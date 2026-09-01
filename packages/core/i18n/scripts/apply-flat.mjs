#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '../locales')
const authoredDir = join(here, 'authored')

function flatten(obj, prefix = '') {
	if (typeof obj === 'string') return prefix ? {[prefix]: obj} : {}
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k
		Object.assign(out, flatten(v, path))
	}
	return out
}

function unflatten(flat) {
	const root = {}
	for (const [path, value] of Object.entries(flat)) {
		let cur = root
		const parts = path.split('.')
		for (const p of parts.slice(0, -1)) cur = cur[p] ??= {}
		cur[parts.at(-1)] = value
	}
	return root
}

const locale = process.argv[2]
if (!locale) {
	console.error('usage: apply-flat.mjs <locale>')
	process.exit(1)
}

const en = flatten(JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')))
const authored = flatten(JSON.parse(readFileSync(join(authoredDir, `${locale}.json`), 'utf8')))
const missing = Object.keys(en).filter(k => !(k in authored) || !String(authored[k]).trim())
const extra = Object.keys(authored).filter(k => !(k in en))
if (missing.length || extra.length) {
	console.error(`parity fail missing=${missing.length} extra=${extra.length}`)
	for (const k of missing.slice(0, 30)) console.error(' missing', k)
	for (const k of extra.slice(0, 30)) console.error(' extra', k)
	process.exit(1)
}
const out = {}
for (const k of Object.keys(en)) out[k] = authored[k]
writeFileSync(join(localesDir, `${locale}.json`), JSON.stringify(unflatten(out), null, 2) + '\n')
const identical = Object.keys(en).filter(k => out[k] === en[k]).length
console.log(`wrote ${locale}.json identical-to-en=${identical}`)
