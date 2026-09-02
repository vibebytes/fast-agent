/**
 * Parse Engine `/model` (empty) command_result text into a catalog.
 * Format from CommandLoop.handleModelCommand / LLMModelLookup.listEntries:
 *
 *   Current model: <display>
 *
 *   * name (alias1, alias2) | thinking=1 efforts=low,medium default=medium
 *     other-name | thinking=0 efforts= default=
 *
 *   Usage: /model <name|alias>
 */

import type {ModelCatalogEntry, ProviderRow} from '@fast-ide/session-view';
import {matchCatalogEntry} from '../../shared/modelMatch.js';

export type {ModelCatalogEntry};

/** Composer picker = Settings enabled models (same ListProviders rows). */
export function catalogFromProviders(
	providers: ProviderRow[],
	current?: string
): ModelCatalogEntry[] {
	const cur = (current ?? '').trim().toLowerCase();
	const entries: ModelCatalogEntry[] = [];
	for (const p of providers) {
		if (!p.enabled) continue;
		for (const m of p.models ?? []) {
			if (!m.enabled) continue;
			const id = `${p.id}/${m.modelId}`;
			const display = (m.displayName || m.modelId).trim() || m.modelId;
			const aliases = uniqueAliases(m.modelId, m.aliases, id, display);
			const keys = [id, display, m.modelId, ...aliases].map(s => s.toLowerCase());
			entries.push({
				id,
				display,
				aliases,
				current: cur.length > 0 && keys.includes(cur),
				providerId: p.id,
				providerName: p.name.trim() || p.id,
				supportsThinking: m.supportsThinking === true,
				supportedEfforts: m.supportedEfforts ?? [],
				...(m.defaultEffort ? {defaultEffort: m.defaultEffort} : {})
			});
		}
	}
	return entries;
}

/** First catalog row that matches a chrome id / display / alias. */
export function catalogEntryFor(
	entries: ModelCatalogEntry[],
	ref: string | undefined
): ModelCatalogEntry | undefined {
	const t = (ref ?? '').trim();
	if (!t) return undefined;
	return entries.find(e => matchCatalogEntry(e, t));
}

/**
 * Composer selected chrome must be a ListProviders row.
 * Keep the current pick when it is in the catalog; otherwise Settings-current or first enabled.
 */
export function resolveComposerChrome(
	entries: ModelCatalogEntry[],
	model: string,
	display: string
): ModelCatalogEntry | undefined {
	return (
		catalogEntryFor(entries, model) ??
		catalogEntryFor(entries, display) ??
		entries.find(e => e.current) ??
		entries[0]
	);
}

function uniqueAliases(
	modelId: string,
	raw: string[] | undefined,
	id: string,
	display: string
): string[] {
	const skip = new Set([id.toLowerCase(), display.toLowerCase(), 'default']);
	const out: string[] = [];
	for (const a of [modelId, ...(raw ?? [])]) {
		const t = a.trim();
		if (!t || skip.has(t.toLowerCase())) continue;
		if (out.some(x => x.toLowerCase() === t.toLowerCase())) continue;
		out.push(t);
	}
	return out;
}

export function parseModelCatalog(message: string): ModelCatalogEntry[] {
	const header = message.match(/^Current model:\s*(.+)\s*$/m);
	const headerCurrent = header?.[1]?.trim() ?? '';
	const headerIsPlaceholder =
		!headerCurrent || headerCurrent.toLowerCase() === 'default';

	const entries: ModelCatalogEntry[] = [];
	for (const raw of message.split(/\r?\n/)) {
		const line = raw.trimEnd();
		const match = line.match(
			/^([* ])\s+(\S.+?)(?:\s+\(([^)]*)\))?(?:\s+\|\s+thinking=([01])\s+efforts=([^\s]*)\s+default=(\S*))?\s*$/
		);
		if (!match) continue;
		const marker = match[1]!;
		const display = match[2]!.trim();
		if (!display || display.toLowerCase().startsWith('current model')) continue;
		if (display.toLowerCase().startsWith('usage:')) continue;
		const aliases = (match[3] ?? '')
			.split(',')
			.map(s => s.trim())
			.filter(Boolean)
			// Engine hides the internal `default` shortcut from menus; keep client consistent.
			.filter(a => a.toLowerCase() !== 'default');
		const supportsThinking = match[4] === '1';
		const supportedEfforts = (match[5] ?? '')
			.split(',')
			.map(s => s.trim())
			.filter(Boolean);
		const defaultEffort = (match[6] ?? '').trim() || undefined;
		const marked = marker === '*';
		const matchesHeader =
			!headerIsPlaceholder &&
			(display === headerCurrent ||
				aliases.some(a => a.toLowerCase() === headerCurrent.toLowerCase()));
		entries.push({
			id: display,
			display,
			aliases,
			current: marked || matchesHeader,
			supportsThinking,
			supportedEfforts,
			...(defaultEffort ? {defaultEffort} : {})
		});
	}

	// Header has a real display but no catalog row was marked — synthesize current.
	if (!headerIsPlaceholder && entries.length > 0 && !entries.some(e => e.current)) {
		const hit = entries.find(e => e.display === headerCurrent);
		if (hit) hit.current = true;
		else
			entries.unshift({
				id: headerCurrent,
				display: headerCurrent,
				aliases: [],
				current: true,
				supportsThinking: false,
				supportedEfforts: []
			});
	}
	return entries;
}

export function filterModelCatalog(entries: ModelCatalogEntry[], query: string): ModelCatalogEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return entries;
	return entries.filter(e => {
		if (e.display.toLowerCase().includes(q)) return true;
		if (e.id.toLowerCase().includes(q)) return true;
		return e.aliases.some(a => a.toLowerCase().includes(q));
	});
}

/** Pi-style clamp: keep current if supported, else prefer medium, else default/head. */
export function clampEffort(
	current: string | undefined,
	supported: string[],
	defaultEffort?: string
): string | undefined {
	if (!supported.length) return undefined;
	const cur = current?.trim().toLowerCase();
	if (cur && supported.some(e => e.toLowerCase() === cur)) return cur;
	const def = defaultEffort?.trim().toLowerCase();
	if (def && supported.some(e => e.toLowerCase() === def)) return def;
	if (supported.some(e => e.toLowerCase() === 'medium')) return 'medium';
	return supported[0]?.toLowerCase();
}
