/**
 * Host-side skill L0 scan for the composer slash menu.
 * Bridge `/skills` remains authoritative when it responds; this keeps the menu
 * usable when Engine is old, hung on H2, or slow to emit `commands_available`.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {SlashCatalogEntry} from '@fast-ide/session-view';

/** Wire/internal badge ids — UI translates via `slash.badge.${id}`. */
export type SlashBadgeId = 'personal' | 'builtin' | 'project';

const SLASH_BADGE_ALIASES: Record<string, SlashBadgeId> = {
	personal: 'personal',
	'个人': 'personal',
	builtin: 'builtin',
	'built-in': 'builtin',
	'内置': 'builtin',
	project: 'project',
	'项目': 'project'
};

/** Map legacy zh/en badge labels → stable ids; unknown values pass through. */
export function normalizeSlashBadge(raw: string): string {
	const key = raw.trim();
	if (!key) return key;
	return SLASH_BADGE_ALIASES[key] ?? SLASH_BADGE_ALIASES[key.toLowerCase()] ?? key;
}

function parseSkillMd(path: string): {name: string; description: string} | null {
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return null;
	}
	if (!raw.startsWith('---')) return null;
	const end = raw.indexOf('\n---', 3);
	if (end < 0) return null;
	const fm = raw.slice(3, end);
	const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
	if (!name) return null;
	return {name, description};
}

function scanRoot(root: string, badge: string, into: Map<string, SlashCatalogEntry>): void {
	if (!existsSync(root)) return;
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return;
	}
	for (const name of entries) {
		const skillMd = join(root, name, 'SKILL.md');
		if (!existsSync(skillMd)) continue;
		const parsed = parseSkillMd(skillMd);
		if (!parsed) continue;
		// Case-insensitive keys — matches SessionController merge / Engine NameMerge habit.
		into.set(parsed.name.toLowerCase(), {
			name: parsed.name,
			description: parsed.description,
			usage: `/${parsed.name}`,
			available: true,
			availability: 'ready',
			badge
		});
	}
}

const CACHE_TTL_MS = 5_000;
let cacheKey = '';
let cacheAt = 0;
let cacheEntries: SlashCatalogEntry[] = [];

/** Project skills override user skills on the same name (Catalog precedence). */
export function discoverHostSlashSkills(projectRoot?: string | null): SlashCatalogEntry[] {
	const key = projectRoot?.trim() || '';
	const now = Date.now();
	if (key === cacheKey && now - cacheAt < CACHE_TTL_MS) return cacheEntries;

	const byName = new Map<string, SlashCatalogEntry>();
	// Align with Engine SkillDiscoveryCtx.defaultUserRoots.
	scanRoot(join(homedir(), '.agents', 'skills'), 'personal', byName);
	scanRoot(join(homedir(), '.fast', 'skills'), 'personal', byName);
	if (key) {
		scanRoot(join(key, '.agents', 'skills'), 'project', byName);
	}
	cacheEntries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	cacheKey = key;
	cacheAt = now;
	return cacheEntries;
}

/** True when SKILL.md exists under user/project skills roots (Host menu source). */
export function hostSkillExists(name: string, projectRoot?: string | null): boolean {
	const n = name.trim().toLowerCase();
	if (!n) return false;
	return discoverHostSlashSkills(projectRoot).some(s => s.name.toLowerCase() === n);
}
