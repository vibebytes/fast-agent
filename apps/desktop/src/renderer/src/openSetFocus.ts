/**
 * Open Tab ↔ Focus Change wiring helpers (ADR-0017).
 * Session Pane selection follows the open set; close never Archives or Detaches.
 */
import {
	close,
	ensureOpen,
	parseOpenSetChrome,
	projectIdGrouping,
	serializeOpenSet,
	type EnsureOpenInput,
	type OpenSet,
	type OpenSetInventory,
	type OpenSetInventoryRow,
	type OpenTabKind
} from './openSet.js';
import {projectDisplayName} from './sidebarModel.js';
import type {ProjectSnapshot} from './env.js';

export const DEFAULT_OPEN_TAB_PROJECT_ID = '__default__';

/** Sidebar Default Project section title — Tab Group label for default open tabs. */
export const DEFAULT_TAB_GROUP_LABEL = 'Tasks';

export type TaskOpenRef = {
	id: string;
	title: string;
	kind?: OpenTabKind | string | null;
	/** Folder Project id when known; omit / null → Default Project grouping. */
	projectId?: string | null;
	/** Engine Session id when known — persisted on the Open Tab for cold restore. */
	sessionId?: string | null;
};

/** Build ensureOpen input for a Task/Chat inventory row. */
export function taskOpenInput(ref: TaskOpenRef): EnsureOpenInput {
	const kind: OpenTabKind = ref.kind === 'chat' ? 'chat' : 'task';
	const sessionId = ref.sessionId?.trim() || undefined;
	return {
		id: ref.id,
		kind,
		title: ref.title,
		projectId: ref.projectId ?? DEFAULT_OPEN_TAB_PROJECT_ID,
		...(sessionId ? {sessionId} : {})
	};
}

/** Sidebar select / New task / tab click: ensure Open Tab + activate (Focus Change is host IPC). */
export function ensureOpenTask(set: OpenSet, ref: TaskOpenRef): OpenSet {
	return ensureOpen(set, taskOpenInput(ref), projectIdGrouping);
}

/**
 * Close Open Tab only (not Archive / not Detach).
 * Returns next open set and the Task id that should receive Focus Change, or null when empty.
 */
export function closeOpenTab(
	set: OpenSet,
	tabId: string
): {set: OpenSet; focusTaskId: string | null} {
	const next = close(set, tabId);
	return {set: next, focusTaskId: next.activeTabId};
}

type TaskRow = {
	id: string;
	title: string;
	kind?: string | null;
	sessionId?: string | null;
};

/** Match local Task id or Engine sessionId (LivingTask / schedule click). */
export function taskOrSessionMatch(
	t: {id: string; sessionId?: string | null},
	taskOrSessionId: string
): boolean {
	return t.id === taskOrSessionId || t.sessionId === taskOrSessionId;
}

/** Resolve a Task/Chat row from workspace inventory for Open Tab ensure.
 *  Accepts local Task id or Engine sessionId (LivingTask / schedule click). */
export function resolveTaskOpenRef(
	state: {
		projectTasks: Record<string, TaskRow[]>;
		defaultTasks: TaskRow[];
		chats: TaskRow[];
		tasks: TaskRow[];
		activeProjectId: string | null;
	},
	taskId: string
): TaskOpenRef | null {
	const withSession = (
		base: Omit<TaskOpenRef, 'sessionId'>,
		sessionId?: string | null
	): TaskOpenRef => {
		const sid = sessionId?.trim();
		return sid ? {...base, sessionId: sid} : base;
	};

	for (const [projectId, list] of Object.entries(state.projectTasks)) {
		const task = list.find(t => taskOrSessionMatch(t, taskId));
		if (task) {
			return withSession(
				{id: task.id, title: task.title, kind: task.kind, projectId},
				task.sessionId
			);
		}
	}
	const def = state.defaultTasks.find(t => taskOrSessionMatch(t, taskId));
	if (def) {
		return withSession(
			{
				id: def.id,
				title: def.title,
				kind: def.kind,
				projectId: DEFAULT_OPEN_TAB_PROJECT_ID
			},
			def.sessionId
		);
	}
	const chat = state.chats.find(t => taskOrSessionMatch(t, taskId));
	if (chat) {
		return withSession(
			{
				id: chat.id,
				title: chat.title,
				kind: 'chat',
				projectId: state.activeProjectId ?? DEFAULT_OPEN_TAB_PROJECT_ID
			},
			chat.sessionId
		);
	}
	const task = state.tasks.find(t => taskOrSessionMatch(t, taskId));
	if (task) {
		return withSession(
			{
				id: task.id,
				title: task.title,
				kind: task.kind,
				projectId: state.activeProjectId ?? DEFAULT_OPEN_TAB_PROJECT_ID
			},
			task.sessionId
		);
	}
	return null;
}

/**
 * Tab Group label for a grouping key (v1: project id).
 * Default Project → "Tasks"; folder Projects → Engine displayName (basename fallback).
 */
export function tabGroupLabel(groupKey: string, projects: ProjectSnapshot[]): string {
	if (groupKey === DEFAULT_OPEN_TAB_PROJECT_ID) return DEFAULT_TAB_GROUP_LABEL;
	const project = projects.find(p => p.id === groupKey);
	if (!project) return groupKey;
	return projectDisplayName(project);
}

/** Map each open-set groupKey to its strip label. */
export function tabGroupLabels(
	groupKeys: Iterable<string>,
	projects: ProjectSnapshot[]
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of groupKeys) {
		out[key] = tabGroupLabel(key, projects);
	}
	return out;
}

/** Sync titles / kinds / sessionId from inventory without changing open order or activation. */
export function syncOpenTabTitles(set: OpenSet, refs: ReadonlyMap<string, TaskOpenRef>): OpenSet {
	let changed = false;
	const tabs = set.tabs.map(tab => {
		const ref = refs.get(tab.id);
		if (!ref) return tab;
		const kind: OpenTabKind = ref.kind === 'chat' ? 'chat' : tab.kind;
		const title = ref.title;
		const groupKey = ref.projectId ?? DEFAULT_OPEN_TAB_PROJECT_ID;
		const sessionId = ref.sessionId?.trim() || tab.sessionId || undefined;
		const prevSid = tab.sessionId?.trim() || undefined;
		const nextSid = sessionId?.trim() || undefined;
		if (
			title === tab.title &&
			kind === tab.kind &&
			groupKey === tab.groupKey &&
			prevSid === nextSid
		) {
			return tab;
		}
		changed = true;
		return {
			...tab,
			title,
			kind,
			groupKey,
			...(nextSid ? {sessionId: nextSid} : {sessionId: undefined})
		};
	});
	return changed ? {...set, tabs} : set;
}

/** Drop Open Tabs by id (Archive / explicit invalidate). Neighbor rules via close. */
export function dropOpenTabIds(set: OpenSet, ids: ReadonlySet<string>): OpenSet {
	if (ids.size === 0) return set;
	let next = set;
	for (const tab of set.tabs) {
		if (ids.has(tab.id)) next = close(next, tab.id);
	}
	return next;
}

/** Drop Open Tabs whose groupKey left the Engine open Projects set (not Default). */
export function dropOpenTabsByGroupKeys(set: OpenSet, groupKeys: ReadonlySet<string>): OpenSet {
	if (groupKeys.size === 0) return set;
	const ids = new Set(set.tabs.filter(t => groupKeys.has(t.groupKey)).map(t => t.id));
	return dropOpenTabIds(set, ids);
}

/**
 * Keep only Open Tabs that still resolve in inventory (by local id or sessionId).
 * Used for cold restore prune and Engine inventory shrink.
 */
export function pruneOpenSet(set: OpenSet, inventory: OpenSetInventory): OpenSet {
	return parseOpenSetChrome(serializeOpenSet(set), inventory);
}

/** Collect Task/Chat ids currently present in workspace inventory. */
export function inventoryTaskIds(state: {
	projectTasks: Record<string, Array<{id: string}>>;
	defaultTasks: Array<{id: string}>;
	chats: Array<{id: string}>;
	tasks: Array<{id: string}>;
}): Set<string> {
	const ids = new Set<string>();
	for (const list of Object.values(state.projectTasks)) {
		for (const t of list) ids.add(t.id);
	}
	for (const t of state.defaultTasks) ids.add(t.id);
	for (const t of state.chats) ids.add(t.id);
	for (const t of state.tasks) ids.add(t.id);
	return ids;
}

/** Inventory rows for Open Tab restore (local id + sessionId). */
export function inventoryTaskRows(state: {
	projectTasks: Record<string, Array<{id: string; sessionId?: string | null}>>;
	defaultTasks: Array<{id: string; sessionId?: string | null}>;
	chats: Array<{id: string; sessionId?: string | null}>;
	tasks: Array<{id: string; sessionId?: string | null}>;
}): OpenSetInventoryRow[] {
	const out: OpenSetInventoryRow[] = [];
	const seen = new Set<string>();
	const push = (id: string, sessionId?: string | null) => {
		if (!id || seen.has(id)) return;
		seen.add(id);
		const sid = sessionId?.trim();
		out.push(sid ? {id, sessionId: sid} : {id});
	};
	for (const list of Object.values(state.projectTasks)) {
		for (const t of list) push(t.id, t.sessionId);
	}
	for (const t of state.defaultTasks) push(t.id, t.sessionId);
	for (const t of state.chats) push(t.id, t.sessionId);
	for (const t of state.tasks) push(t.id, t.sessionId);
	return out;
}

/**
 * Open Tab working set for Bind+Attach reconcile (option B).
 * Inventory stubs outside this list must not be batch-bound on Register.
 */
export function openTabLiveTaskIds(set: OpenSet): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tab of set.tabs) {
		const id = tab.id?.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}
