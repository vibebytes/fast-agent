/**
 * Pure Open Tab open set + Tab Group derivation (ADR-0017).
 * Client-local chrome only — not Engine Meta / not Engine open-Project authority.
 * Tab Group is decoupled from Project; Project id is only the default grouping policy.
 *
 * Cross-restart identity: persist optional `sessionId` (Engine). Local `id` is reminted
 * on hydrate; restore remaps tabs by sessionId onto the new local task id.
 */

export type OpenTabKind = 'task' | 'chat';

export type OpenTab = {
	id: string;
	kind: OpenTabKind;
	/** Opaque grouping key from GroupingPolicy (v1: project id). */
	groupKey: string;
	title: string;
	/** Engine Session id — stable across App restart when present. */
	sessionId?: string | null;
};

export type OpenSet = {
	tabs: OpenTab[];
	activeTabId: string | null;
	expandedGroupKey: string | null;
};

/** Inputs for ensureOpen; projectId feeds the v1 policy and is not a Tab Group type. */
export type EnsureOpenInput = {
	id: string;
	kind: OpenTabKind;
	title: string;
	projectId: string;
	sessionId?: string | null;
};

export type GroupingPolicy = {
	groupKey: (input: EnsureOpenInput) => string;
};

/** Default first-ship policy: group by Project id (including Default Project). */
export const projectIdGrouping: GroupingPolicy = {
	groupKey: input => input.projectId
};

/** Serializable client chrome snapshot (prefs-style; never Engine Meta). */
export type OpenSetChrome = OpenSet;

/** Inventory row for restore / prune (local id + optional Engine sessionId). */
export type OpenSetInventoryRow = {
	id: string;
	sessionId?: string | null;
};

/**
 * Restore inventory: Set of local ids (legacy) or rows with sessionId for remap.
 */
export type OpenSetInventory = ReadonlySet<string> | ReadonlyArray<OpenSetInventoryRow>;

export type StripItem =
	| {type: 'tab'; tab: OpenTab}
	| {type: 'group'; groupKey: string; members: OpenTab[]; expanded: boolean};

export function emptyOpenSet(): OpenSet {
	return {tabs: [], activeTabId: null, expandedGroupKey: null};
}

function countInGroup(tabs: OpenTab[], groupKey: string): number {
	return tabs.filter(t => t.groupKey === groupKey).length;
}

function withExpandedForActive(set: OpenSet): OpenSet {
	const active = set.tabs.find(t => t.id === set.activeTabId);
	if (!active) return {...set, expandedGroupKey: null};
	if (countInGroup(set.tabs, active.groupKey) > 1) {
		return {...set, expandedGroupKey: active.groupKey};
	}
	return {...set, expandedGroupKey: null};
}

function trimmedSessionId(value: string | null | undefined): string | undefined {
	const s = value?.trim();
	return s ? s : undefined;
}

export function ensureOpen(set: OpenSet, input: EnsureOpenInput, policy: GroupingPolicy): OpenSet {
	const groupKey = policy.groupKey(input);
	const sid = trimmedSessionId(input.sessionId);
	const existing = set.tabs.findIndex(
		t => t.id === input.id || (sid !== undefined && t.sessionId === sid)
	);
	let tabs: OpenTab[];
	if (existing >= 0) {
		const prev = set.tabs[existing]!;
		const sessionId = sid ?? trimmedSessionId(prev.sessionId);
		tabs = set.tabs.map((t, i) =>
			i === existing
				? {
						id: input.id,
						kind: input.kind,
						groupKey,
						title: input.title,
						...(sessionId ? {sessionId} : {})
					}
				: t
		);
	} else {
		tabs = [
			...set.tabs,
			{
				id: input.id,
				kind: input.kind,
				groupKey,
				title: input.title,
				...(sid ? {sessionId: sid} : {})
			}
		];
	}
	return withExpandedForActive({
		tabs,
		activeTabId: input.id,
		expandedGroupKey: set.expandedGroupKey
	});
}

export function activate(set: OpenSet, tabId: string): OpenSet {
	if (!set.tabs.some(t => t.id === tabId)) return set;
	return withExpandedForActive({...set, activeTabId: tabId});
}

function neighborId(tabs: OpenTab[], closedId: string, closedGroup: string): string | null {
	const idx = tabs.findIndex(t => t.id === closedId);
	if (idx < 0) return null;
	const remaining = tabs.filter(t => t.id !== closedId);
	if (remaining.length === 0) return null;

	const score = (t: OpenTab): [number, number, number] => {
		const ti = tabs.findIndex(x => x.id === t.id);
		const same = t.groupKey === closedGroup ? 0 : 1;
		const dist = Math.abs(ti - idx);
		// Prefer right on equal distance (Chrome-like).
		const side = ti >= idx ? 0 : 1;
		return [same, dist, side];
	};

	return remaining.reduce((best, t) => {
		const a = score(t);
		const b = score(best);
		if (a[0] !== b[0]) return a[0] < b[0] ? t : best;
		if (a[1] !== b[1]) return a[1] < b[1] ? t : best;
		return a[2] < b[2] ? t : best;
	}).id;
}

export function close(set: OpenSet, tabId: string): OpenSet {
	const closed = set.tabs.find(t => t.id === tabId);
	if (!closed) return set;
	const wasActive = set.activeTabId === tabId;
	const nextActive = wasActive ? neighborId(set.tabs, tabId, closed.groupKey) : set.activeTabId;
	const tabs = set.tabs.filter(t => t.id !== tabId);
	let expandedGroupKey = set.expandedGroupKey;
	if (expandedGroupKey && countInGroup(tabs, expandedGroupKey) <= 1) {
		expandedGroupKey = null;
	}
	const next: OpenSet = {tabs, activeTabId: wasActive ? nextActive : set.activeTabId, expandedGroupKey};
	if (wasActive && next.activeTabId) return withExpandedForActive(next);
	if (!next.activeTabId) return {...next, expandedGroupKey: null};
	return next;
}

/** Group label expand/collapse only — never changes activeTabId. */
export function toggleGroupExpand(set: OpenSet, groupKey: string): OpenSet {
	if (countInGroup(set.tabs, groupKey) <= 1) return set;
	return {
		...set,
		expandedGroupKey: set.expandedGroupKey === groupKey ? null : groupKey
	};
}

/** Derive strip structure: bare Open Tab when count==1; Tab Group when count>1. */
export function stripItems(set: OpenSet): StripItem[] {
	const seen = new Set<string>();
	const items: StripItem[] = [];
	for (const tab of set.tabs) {
		if (seen.has(tab.groupKey)) continue;
		seen.add(tab.groupKey);
		const members = set.tabs.filter(t => t.groupKey === tab.groupKey);
		if (members.length === 1) {
			items.push({type: 'tab', tab: members[0]!});
		} else {
			items.push({
				type: 'group',
				groupKey: tab.groupKey,
				members,
				expanded: set.expandedGroupKey === tab.groupKey
			});
		}
	}
	return items;
}

export function serializeOpenSet(set: OpenSet): OpenSetChrome {
	return {
		tabs: set.tabs.map(t => ({...t})),
		activeTabId: set.activeTabId,
		expandedGroupKey: set.expandedGroupKey
	};
}

function inventoryIndexes(inventory: OpenSetInventory): {
	byId: Map<string, OpenSetInventoryRow>;
	bySessionId: Map<string, OpenSetInventoryRow>;
} {
	const byId = new Map<string, OpenSetInventoryRow>();
	const bySessionId = new Map<string, OpenSetInventoryRow>();
	if (Array.isArray(inventory)) {
		for (const row of inventory as ReadonlyArray<OpenSetInventoryRow>) {
			if (!row?.id) continue;
			byId.set(row.id, row);
			const sid = trimmedSessionId(row.sessionId);
			if (sid) bySessionId.set(sid, row);
		}
		return {byId, bySessionId};
	}
	for (const id of inventory as ReadonlySet<string>) {
		if (!id) continue;
		byId.set(id, {id});
	}
	return {byId, bySessionId};
}

function isTabShape(t: unknown): t is OpenTab {
	return (
		Boolean(t) &&
		typeof t === 'object' &&
		typeof (t as OpenTab).id === 'string' &&
		((t as OpenTab).kind === 'task' || (t as OpenTab).kind === 'chat') &&
		typeof (t as OpenTab).groupKey === 'string' &&
		typeof (t as OpenTab).title === 'string'
	);
}

/**
 * Restore client chrome.
 * Match by local id, or by persisted `sessionId` when hydrate reminted local ids.
 * Tabs without a matching inventory row are dropped (deleted sessions / optimistic-only).
 */
export function parseOpenSetChrome(
	chrome: OpenSetChrome | null | undefined,
	inventory: OpenSetInventory
): OpenSet {
	if (!chrome || !Array.isArray(chrome.tabs)) return emptyOpenSet();
	const {byId, bySessionId} = inventoryIndexes(inventory);

	const tabs: OpenTab[] = [];
	const seenLocal = new Set<string>();
	for (const raw of chrome.tabs) {
		if (!isTabShape(raw)) continue;
		const savedSid = trimmedSessionId(raw.sessionId);
		const row = byId.get(raw.id) ?? (savedSid ? bySessionId.get(savedSid) : undefined);
		if (!row || seenLocal.has(row.id)) continue;
		seenLocal.add(row.id);
		const sessionId = trimmedSessionId(row.sessionId) ?? savedSid;
		tabs.push({
			id: row.id,
			kind: raw.kind,
			groupKey: raw.groupKey,
			title: raw.title,
			...(sessionId ? {sessionId} : {})
		});
	}
	if (tabs.length === 0) return emptyOpenSet();

	let activeTabId: string | null = null;
	if (chrome.activeTabId) {
		const savedActive = chrome.tabs.find(t => isTabShape(t) && t.id === chrome.activeTabId);
		if (savedActive) {
			const savedSid = trimmedSessionId(savedActive.sessionId);
			const row =
				byId.get(savedActive.id) ?? (savedSid ? bySessionId.get(savedSid) : undefined);
			if (row && tabs.some(t => t.id === row.id)) activeTabId = row.id;
		}
		if (!activeTabId && tabs.some(t => t.id === chrome.activeTabId)) {
			activeTabId = chrome.activeTabId;
		}
	}
	if (!activeTabId) activeTabId = tabs[tabs.length - 1]!.id;

	const expandedGroupKey =
		chrome.expandedGroupKey && countInGroup(tabs, chrome.expandedGroupKey) > 1
			? chrome.expandedGroupKey
			: null;
	return {tabs, activeTabId, expandedGroupKey};
}
