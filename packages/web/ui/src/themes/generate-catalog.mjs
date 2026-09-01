#!/usr/bin/env node
/** Regenerate catalog.ts from palette/*.json */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {CATEGORY} from './categories.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, 'palette');

const files = fs
	.readdirSync(dir)
	.filter(f => f.endsWith('.json') && f !== 'registry.json')
	.sort();

const themes = files.map(f => {
	const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	const light = j.cssVars.light;
	return {
		id: j.name,
		title: j.title,
		description: j.description || '',
		category: CATEGORY[j.name] || 'clean',
		cssVars: j.cssVars,
		swatches: [light.primary, light.accent, light.secondary, light.muted, light.background].filter(
			Boolean
		)
	};
});

const out =
	`/** Auto-generated from https://www.paletteui.xyz — do not edit by hand. */\n` +
	`export type PaletteCategory =\n` +
	`\t| 'clean'\n\t| 'bold'\n\t| 'warm'\n\t| 'cool'\n\t| 'playful'\n\t| 'seasonal'\n\t| 'retro'\n\t| 'space'\n\t| 'nature'\n\t| 'tv'\n\t| 'countries'\n\t| 'brands';\n\n` +
	`export type PaletteModeVars = Record<string, string>;\n\n` +
	`export type PaletteTheme = {\n` +
	`\tid: string;\n\ttitle: string;\n\tdescription: string;\n\tcategory: PaletteCategory;\n` +
	`\tcssVars: {light: PaletteModeVars; dark: PaletteModeVars};\n\tswatches: string[];\n};\n\n` +
	`export const PALETTE_CATEGORIES: {id: PaletteCategory | 'all'; label: string}[] = [\n` +
	`\t{id: 'all', label: 'All'},\n` +
	`\t{id: 'clean', label: 'Clean'},\n` +
	`\t{id: 'bold', label: 'Bold'},\n` +
	`\t{id: 'warm', label: 'Warm'},\n` +
	`\t{id: 'cool', label: 'Cool'},\n` +
	`\t{id: 'playful', label: 'Playful'},\n` +
	`\t{id: 'seasonal', label: 'Seasonal'},\n` +
	`\t{id: 'retro', label: 'Retro'},\n` +
	`\t{id: 'space', label: 'Space'},\n` +
	`\t{id: 'nature', label: 'Nature'},\n` +
	`\t{id: 'tv', label: 'TV & Film'},\n` +
	`\t{id: 'countries', label: 'Countries'},\n` +
	`\t{id: 'brands', label: 'Brands'},\n` +
	`];\n\n` +
	`export const PALETTE_THEMES: PaletteTheme[] = ${JSON.stringify(themes, null, '\t')};\n\n` +
	`export const DEFAULT_PALETTE_ID = 'codex';\n\n` +
	`export function getPaletteTheme(id: string): PaletteTheme {\n` +
	`\treturn PALETTE_THEMES.find(t => t.id === id) ?? PALETTE_THEMES.find(t => t.id === DEFAULT_PALETTE_ID)!;\n` +
	`}\n`;

fs.writeFileSync(path.join(__dirname, 'catalog.ts'), out);
console.log(`Wrote catalog.ts (${themes.length} themes)`);
