import type {SlashCatalogEntry} from './wire.js';

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

export function withNormalizedBadge(e: SlashCatalogEntry): SlashCatalogEntry {
	return e.badge ? {...e, badge: normalizeSlashBadge(e.badge)} : e;
}

export type BridgeCommandInfo = {
	name: string;
	description?: string | null;
	usage?: string | null;
	available?: boolean | null;
	availability?: string | null;
	badge?: string | null;
};

export function slashCatalogFromBridgeCommands(
	commands: BridgeCommandInfo[] | null | undefined
): SlashCatalogEntry[] {
	return (commands ?? []).map(c =>
		withNormalizedBadge({
			name: c.name,
			description: c.description ?? '',
			usage: c.usage ?? undefined,
			available: c.available ?? undefined,
			availability: c.availability ?? undefined,
			...(c.badge ? {badge: c.badge} : {})
		})
	);
}

/** Bridge `/skills` wins per name (case-insensitive); host disk copies fill gaps, minus product skills. */
export function mergeSlashCatalogs(
	fromBridge: SlashCatalogEntry[],
	host: SlashCatalogEntry[],
	isProductSkill: (name: string) => boolean
): SlashCatalogEntry[] {
	const byName = new Map<string, SlashCatalogEntry>();
	for (const e of host) {
		if (isProductSkill(e.name)) continue;
		byName.set(e.name.toLowerCase(), withNormalizedBadge(e));
	}
	for (const e of fromBridge) byName.set(e.name.toLowerCase(), e);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
