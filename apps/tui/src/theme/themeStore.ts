/**
 * Theme persistence and user-defined themes.
 *
 * - `~/.fast/ui-settings.json` stores `{ "theme": "<name>" }`.
 * - `~/.fast/themes/<name>.json` defines custom themes: a partial SemanticTheme
 *   deep-merged over a built-in base (default `default-dark`, override with
 *   `"extends": "<built-in name>"`). The file name (minus .json) is the
 *   theme name shown in /theme.
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {SemanticTheme, ThemeName} from './semanticTheme.js';
import {hasTheme, registerTheme, resolveTheme} from './semanticTheme.js';

const settingsPath = () => path.join(homedir(), '.fast', 'ui-settings.json');
const themesDir = () => path.join(homedir(), '.fast', 'themes');

export function loadSavedThemeName(): ThemeName | undefined {
	try {
		const raw = readFileSync(settingsPath(), 'utf8');
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && typeof (parsed as {theme?: unknown}).theme === 'string') {
			return (parsed as {theme: string}).theme;
		}
	} catch {
		// Missing/corrupt settings: fall back to defaults.
	}
	return undefined;
}

export function saveThemeName(name: ThemeName): void {
	try {
		let settings: Record<string, unknown> = {};
		if (existsSync(settingsPath())) {
			try {
				const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'));
				if (parsed && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
			} catch {
				// Corrupt file: rewrite from scratch.
			}
		}
		settings['theme'] = name;
		mkdirSync(path.dirname(settingsPath()), {recursive: true});
		writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
	} catch {
		// Persistence is best-effort; never break the UI over it.
	}
}

export type RendererMode = 'inline' | 'fullscreen';

export function loadSavedRendererMode(): RendererMode | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'));
		const renderer = (parsed as {renderer?: unknown} | null)?.renderer;
		if (renderer === 'inline' || renderer === 'fullscreen') return renderer;
	} catch {
		// Missing/corrupt settings: fall back to defaults.
	}
	return undefined;
}

export function saveRendererMode(mode: RendererMode): void {
	try {
		let settings: Record<string, unknown> = {};
		if (existsSync(settingsPath())) {
			try {
				const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'));
				if (parsed && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
			} catch {
				// Corrupt file: rewrite from scratch.
			}
		}
		settings['renderer'] = mode;
		mkdirSync(path.dirname(settingsPath()), {recursive: true});
		writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
	} catch {
		// Persistence is best-effort; never break the UI over it.
	}
}

type DeepPartial<T> = {[K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K]};

export function mergeTheme(base: SemanticTheme, patch: DeepPartial<SemanticTheme> & {extends?: string}): SemanticTheme {
	return {
		text: {...base.text, ...patch.text},
		status: {...base.status, ...patch.status},
		border: {...base.border, ...patch.border},
		background: {...base.background, ...patch.background},
		diff: {...base.diff, ...patch.diff},
		tool: {...base.tool, ...patch.tool},
		dialog: {...base.dialog, ...patch.dialog},
		spinner: Array.isArray(patch.spinner) && patch.spinner.length > 0 ? patch.spinner : base.spinner,
		dim: typeof patch.dim === 'boolean' ? patch.dim : base.dim,
		noColor: typeof patch.noColor === 'boolean' ? patch.noColor : base.noColor
	};
}

/** Register every `~/.fast/themes/*.json` custom theme. Returns loaded names. */
export function loadCustomThemes(): ThemeName[] {
	const loaded: ThemeName[] = [];
	let files: string[];
	try {
		files = readdirSync(themesDir()).filter(file => file.endsWith('.json'));
	} catch {
		return loaded;
	}

	for (const file of files) {
		const name = file.slice(0, -'.json'.length);
		if (name.length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(readFileSync(path.join(themesDir(), file), 'utf8'));
			if (!parsed || typeof parsed !== 'object') continue;
			const patch = parsed as DeepPartial<SemanticTheme> & {extends?: string};
			const base = typeof patch.extends === 'string' && hasTheme(patch.extends)
				? resolveTheme(patch.extends)
				: resolveTheme('default-dark');
			registerTheme(name, mergeTheme(base, patch));
			loaded.push(name);
		} catch {
			// Skip malformed theme files; built-ins always remain available.
		}
	}

	return loaded;
}
