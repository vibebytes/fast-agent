import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {SlashCatalogEntry} from '@fast-ide/session-view';
import type {EngineKind} from '@fast-ide/session-view';
import type {TaskRecord} from './sessionContracts.js';
import {normalizeSlashBadge} from './hostSkillDiscovery.js';
import {hostT} from './hostT.js';

export interface SessionSlashCatalogDeps {
	getActiveTask: () => TaskRecord | null;
	engineKind: () => EngineKind;
	onChange: () => void;
	discoverHostSkills: () => SlashCatalogEntry[] | undefined;
}

/** Coding product slash names — Engine builtins; Host disk copies must not appear as personal. */
const PRODUCT_CODING_SKILL_NAMES = new Set([
	'brainstorm',
	'explore',
	'to-spec',
	'to-tickets',
	'implement',
	'findbugs',
	'review'
]);

function withNormalizedBadge(e: SlashCatalogEntry): SlashCatalogEntry {
	return e.badge ? {...e, badge: normalizeSlashBadge(e.badge)} : e;
}

/**
 * K18: composer slash catalog state (Bridge catalog + Host disk seed).
 * Controller exposes getters/setter only.
 */
export function createSessionSlashCatalog(deps: SessionSlashCatalogDeps) {
	let entries: SlashCatalogEntry[] = [];
	let hydrated = false;
	let bridgeArrived = false;

	/** Seed composer menu from disk when Bridge catalog has not arrived yet. */
	function seedHostSlashCatalog(): boolean {
		// After a non-empty Bridge catalog, Host disk skills are merged on every
		// commands_available — seed only before the first Bridge catalog arrives
		// (or after an explicit wipe).
		if (bridgeArrived && entries.length > 0) return false;
		const host = (deps.discoverHostSkills() ?? [])
			.filter(e => !PRODUCT_CODING_SKILL_NAMES.has(e.name.toLowerCase()))
			.map(withNormalizedBadge);
		if (host.length === 0) return false;
		entries = host;
		hydrated = true;
		deps.onChange();
		return true;
	}

	/** DSH Caps: empty Bridge catalog clears slash. Fast: keep Host disk seed. */
	function applyEmptySlashCatalog(): void {
		if (deps.getActiveTask()?.dshCaps?.slash) return;
		if (deps.engineKind() === 'dsh') return;
		seedHostSlashCatalog();
	}

	/** Catalog + host-seed skill names eligible for SkillSlash (excludes available:false). */
	function availableSkillNames(): string[] {
		const fromCatalog = entries.filter(e => e.available !== false).map(e => e.name);
		const fromHost = (deps.discoverHostSkills() ?? [])
			.filter(e => e.available !== false)
			.map(e => e.name);
		return [...fromCatalog, ...fromHost];
	}

	function enrichSkillCommandError(commandName: string | undefined, message: string): string {
		const name = (commandName ?? '').trim();
		if (!name || name === 'skill_view' || name === 'skills') return message;
		if (!message.includes('Unknown command:')) return message;
		// New Engine: `Unknown command: /x (Skill 'x' not found…)` — do not mislabel as missing SkillSlash.
		if (message.includes('(')) return message;
		const known =
			entries.some(e => e.name.toLowerCase() === name) ||
			(deps.discoverHostSkills()?.some(e => e.name.toLowerCase() === name) ?? false);
		if (!known) return message;
		return `${message}\n\n${hostT('errors.skill.engine_missing_skillslash', {name})}`;
	}

	/** commands_available: Bridge catalog wins for name collisions; Host disk skills merge in. */
	function mergeCommandsAvailable(commands: Extract<BridgeEvent, {type: 'commands_available'}>['commands']): void {
		const fromBridge = (commands ?? []).map(c =>
			withNormalizedBadge({
				name: c.name,
				description: c.description ?? '',
				usage: c.usage,
				available: c.available,
				availability: c.availability,
				...(c.badge ? {badge: c.badge} : {})
			})
		);
		if (fromBridge.length > 0) {
			// Keep Host disk skills (research/grilling/…) visible even when Bridge omits them.
			// Coding product names are Engine builtins — never let personal disk shadow them in the menu.
			const host = deps.discoverHostSkills() ?? [];
			const byName = new Map<string, SlashCatalogEntry>();
			for (const e of host) {
				if (PRODUCT_CODING_SKILL_NAMES.has(e.name.toLowerCase())) continue;
				byName.set(e.name.toLowerCase(), withNormalizedBadge(e));
			}
			for (const e of fromBridge) byName.set(e.name.toLowerCase(), e);
			// Stable order for menu (group sort still applies in renderer).
			entries = [...byName.values()].sort((a, b) =>
				a.name.localeCompare(b.name)
			);
			bridgeArrived = true;
		} else {
			applyEmptySlashCatalog();
		}
		hydrated = true;
	}

	function markHydrated(): void {
		hydrated = true;
	}

	/** External setter — the test (and only it) assigns controller.slashCatalog directly. */
	function replaceEntries(next: SlashCatalogEntry[]): void {
		entries = [...next];
	}

	function reset(): void {
		entries = [];
		hydrated = false;
		bridgeArrived = false;
	}

	return {
		get entries() {
			return entries;
		},
		get hydrated() {
			return hydrated;
		},
		get bridgeArrived() {
			return bridgeArrived;
		},
		seedHostSlashCatalog,
		applyEmptySlashCatalog,
		availableSkillNames,
		enrichSkillCommandError,
		mergeCommandsAvailable,
		markHydrated,
		replaceEntries,
		reset
	};
}
