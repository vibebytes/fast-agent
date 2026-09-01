/**
 * Composer slash palette — Commands + skill groups (platform / coding / external).
 * Skills come from Bridge `commands_available`.
 * Send-path allowlist uses Bridge fixed names ∪ Catalog skills (see `@fastllm/bridge-protocol`).
 *
 * Group order (docs/features/builtin-skills-catalog.md):
 *   命令 → 通用 → Coding → 外部
 */

import {
	formatUserSkillDisplayLine,
	isBridgeFixedCommand,
	isIdeLocalSlash,
	parseSlashInput,
	parseUserSkillDisplay,
	resolveSlashRoute,
	type SlashRoute
} from '@fastllm/bridge-protocol';
import type {SlashCatalogEntry} from '@fast-ide/session-view';

export type {SlashCatalogEntry, SlashRoute};
export {formatUserSkillDisplayLine, parseSlashInput, parseUserSkillDisplay, resolveSlashRoute};
// parseSkillInjectedMessage: import from @fastllm/bridge-protocol in tests / callers that need it.

export type SlashItemKind = 'command' | 'skill';

export type SlashItem = {
	name: string;
	/** Display title in the menu / chip (defaults to name). */
	label: string;
	description: string;
	kind: SlashItemKind;
	/** Optional trailing badge from Catalog scope. */
	badge?: string;
};

/** Host-handled slash commands shown in the Commands group (not a second engine registry). */
export const HOST_SLASH_COMMANDS: SlashItem[] = [
	{name: 'help', label: 'help', description: 'Show available slash commands', kind: 'command'},
	{name: 'clear', label: 'clear', description: 'Clear conversation and session', kind: 'command'},
	{name: 'model', label: 'model', description: 'Show or switch model', kind: 'command'},
	{name: 'mode', label: 'mode', description: 'Set RunMode: /mode agent|plan|ask|yolo', kind: 'command'}
	// plan / agent / team are SkillSlash (builtin); exit-plan is never exposed in IDE
];

/** Platform / 通用 — product order (builtin + external same names). */
export const PLATFORM_SKILL_NAMES = [
	'plan',
	'goal',
	'loop',
	'team',
	'agent',
	'research',
	'grilling',
	'distill'
] as const;

/** Coding pipeline product names only (all should be Engine builtins / badge builtin). */
export const CODING_SKILL_NAMES = [
	'brainstorm',
	'explore',
	'to-spec',
	'to-tickets',
	'implement',
	'findbugs',
	'review'
] as const;

const PLATFORM_RANK: Map<string, number> = new Map(
	PLATFORM_SKILL_NAMES.map((n, i) => [n, i])
);
const CODING_RANK: Map<string, number> = new Map(
	CODING_SKILL_NAMES.map((n, i) => [n, i])
);

/** Names that must not appear as Catalog skills (fixed commands win on collision). */
function reservedSlashName(name: string): boolean {
	const n = name.trim().toLowerCase();
	return isIdeLocalSlash(n) || isBridgeFixedCommand(n);
}

export function skillsFromCatalog(entries: SlashCatalogEntry[]): SlashItem[] {
	return entries
		.filter(e => e.available !== false && !reservedSlashName(e.name))
		.map(e => ({
			name: e.name,
			label: e.name,
			description: e.description || e.usage || '',
			kind: 'skill' as const,
			...(e.badge ? {badge: e.badge} : {})
		}));
}

export type SlashMenuGroups = {
	commands: SlashItem[];
	platform: SlashItem[];
	coding: SlashItem[];
	external: SlashItem[];
};

function skillBucket(name: string): 'platform' | 'coding' | 'external' {
	const n = name.toLowerCase();
	if (PLATFORM_RANK.has(n)) return 'platform';
	if (CODING_RANK.has(n)) return 'coding';
	return 'external';
}

function byNameTableOrder(rank: Map<string, number>, a: SlashItem, b: SlashItem): number {
	const ra = rank.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
	const rb = rank.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
	if (ra !== rb) return ra - rb;
	return a.name.localeCompare(b.name);
}

/** Filter menu by the query after `/` (empty query → all). */
export function filterSlashMenu(
	query: string,
	skills: SlashItem[],
	commands: SlashItem[] = HOST_SLASH_COMMANDS
): SlashMenuGroups {
	const q = query.trim().toLowerCase();
	/** Commands: name/label prefix only — mode's description contains plan/ask/agent and false-hits. */
	const matchCommand = (item: SlashItem) => {
		if (!q) return true;
		const name = item.name.toLowerCase();
		const label = item.label.toLowerCase();
		return name.startsWith(q) || label.startsWith(q);
	};
	const matchSkill = (item: SlashItem) => {
		if (!q) return true;
		const name = item.name.toLowerCase();
		const label = item.label.toLowerCase();
		if (name.startsWith(q) || label.startsWith(q)) return true;
		// Description: token-prefix only, and only for longer queries.
		// Avoid `/exp` ⊂ "Explore the codebase…" falsely hitting `plan` while typing `/explore`.
		if (q.length >= 5) {
			const tokens = item.description
				.toLowerCase()
				.split(/[^a-z0-9\u4e00-\u9fff]+/)
				.filter(Boolean);
			if (tokens.some(t => t.startsWith(q))) return true;
		}
		return false;
	};

	const platform: SlashItem[] = [];
	const coding: SlashItem[] = [];
	const external: SlashItem[] = [];
	for (const s of skills.filter(matchSkill)) {
		const bucket = skillBucket(s.name);
		if (bucket === 'platform') platform.push(s);
		else if (bucket === 'coding') coding.push(s);
		else external.push(s);
	}
	platform.sort((a, b) => byNameTableOrder(PLATFORM_RANK, a, b));
	coding.sort((a, b) => byNameTableOrder(CODING_RANK, a, b));
	external.sort((a, b) => a.name.localeCompare(b.name));

	return {
		commands: commands.filter(matchCommand),
		platform,
		coding,
		external
	};
}

/** Commands first, then platform → coding → external. */
export function flattenSlashMenu(groups: SlashMenuGroups): SlashItem[] {
	return [...groups.commands, ...groups.platform, ...groups.coding, ...groups.external];
}

/** Detect in-progress slash query: `/` or `/partial` with no trailing args yet. */
export function slashQuery(draft: string): string | null {
	if (!draft.startsWith('/')) return null;
	if (/\s/.test(draft)) return null;
	return draft.slice(1);
}

export function formatSlashSubmit(name: string, args: string): string {
	const a = args.trim();
	return a ? `/${name} ${a}` : `/${name}`;
}

/** Human title for chip / transcript: `improve-codebase-architecture` → `Improve Codebase Architecture`. */
export function slashTitle(name: string): string {
	return name
		.split(/[-_]+/)
		.filter(Boolean)
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/** Exact name match in a flat menu (case-insensitive). */
export function exactSlashMatch(query: string, items: SlashItem[]): SlashItem | undefined {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	return items.find(i => i.name.toLowerCase() === q);
}
