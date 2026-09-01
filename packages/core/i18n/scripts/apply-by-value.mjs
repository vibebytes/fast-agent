#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs'
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
	console.error('usage: apply-by-value.mjs <locale>')
	process.exit(1)
}

const en = flatten(JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')))
const map = JSON.parse(readFileSync(join(authoredDir, `${locale}.by-value.json`), 'utf8'))
const missingValues = [...new Set(Object.values(en))].filter(v => !(v in map) || !String(map[v]).trim())
if (missingValues.length) {
	console.error(`missing ${missingValues.length} unique values`)
	for (const v of missingValues.slice(0, 40)) console.error(' -', JSON.stringify(v))
	process.exit(1)
}

const out = {}
for (const [k, v] of Object.entries(en)) out[k] = map[v]
writeFileSync(join(localesDir, `${locale}.json`), JSON.stringify(unflatten(out), null, 2) + '\n')
const identical = Object.keys(en).filter(k => out[k] === en[k]).length
console.log(`wrote ${locale}.json keys=${Object.keys(en).length} identical-to-en=${identical}`)
