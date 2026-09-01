import {useCallback, useEffect, useRef, useState, type MutableRefObject} from 'react';
import {emptyOpenSet, toggleGroupExpand, type OpenSet} from './openSet';
import {loadOpenSetChrome, saveOpenSetChrome} from './openSetChrome';
import type {OpenSetInventoryRow} from './openSet';
import {
	closeOpenTab,
	dropOpenTabIds,
	ensureOpenTask,
	openTabLiveTaskIds,
	pruneOpenSet,
	resolveTaskOpenRef,
	syncOpenTabTitles,
	type TaskOpenRef
} from './openSetFocus';
import {
	clearTaskFocusOptimistic,
	ensureTasksLiveOptimistic,
	selectTaskOptimistic,
	type WorkspaceStore
} from './workspaceStore';
import type {EngineHostStatus} from './env';

type OpenRefSource = Parameters<typeof resolveTaskOpenRef>[0];

/**
 * Open Tab chrome lifecycle (perf doc P2-14, extracted from App): cold restore,
 * inventory pruning, title sync, focus-ensure, close/drop/toggle. Selection side
 * effects go through the Workspace Store (optimistic focus); App keeps only the
 * strip-item projections and the Teams-aware open action.
 */
export function useOpenSetChrome(input: {
	store: WorkspaceStore;
	/** Local task ids — gate cold restore until inventory is known. */
	inventoryIds: Set<string>;
	/** Rows with sessionId for cold restore remap after hydrate remints local ids. */
	inventoryRows: OpenSetInventoryRow[];
	openRefSource: OpenRefSource;
	activeTaskId: string | null;
	projectsFromPush: boolean;
	defaultTasksHydrated: boolean;
	/** Engine host status — Open Tab Bind/Attach reconcile runs when ready. */
	engineStatus: EngineHostStatus | null;
	/**
	 * Changes when any Project gains/loses slot `workspaceId` (Register accepted).
	 * Must re-run reconcile — engine ready alone is too early for Bind.
	 */
	slotReadyKey: string;
}): {
	openSet: OpenSet;
	openSetRef: MutableRefObject<OpenSet>;
	openSetReady: boolean;
	commitOpenSet: (next: OpenSet) => void;
	applyOpenSetChange: (next: OpenSet) => void;
	dropOpenTabs: (taskIds: string[]) => void;
	closeOpenTabChrome: (tabId: string) => void;
	toggleTabGroup: (groupKey: string) => void;
} {
	const {
		store,
		inventoryIds,
		inventoryRows,
		openRefSource,
		activeTaskId,
		projectsFromPush,
		defaultTasksHydrated,
		engineStatus,
		slotReadyKey
	} = input;

	const [openSet, setOpenSet] = useState<OpenSet>(() => emptyOpenSet());
	const openSetRef = useRef(openSet);
	openSetRef.current = openSet;
	const [openSetReady, setOpenSetReady] = useState(false);

	const commitOpenSet = useCallback((next: OpenSet) => {
		openSetRef.current = next;
		setOpenSet(next);
		saveOpenSetChrome(next);
	}, []);

	const applyOpenSetChange = useCallback(
		(next: OpenSet) => {
			const prevActive = openSetRef.current.activeTabId;
			commitOpenSet(next);
			if (next.activeTabId === prevActive) return;
			if (next.activeTabId) void selectTaskOptimistic(store, next.activeTabId);
			else clearTaskFocusOptimistic(store);
		},
		[store, commitOpenSet]
	);

	/** Cold restore client-local open-set chrome (not Engine Meta / Workspace Restore). */
	useEffect(() => {
		if (openSetReady) return;
		if (!defaultTasksHydrated) return;
		// Wait for Engine project inventory before pruning prefs, so we do not wipe tabs early.
		if (!projectsFromPush && inventoryIds.size === 0) return;
		const loaded = loadOpenSetChrome(inventoryRows);
		commitOpenSet(loaded);
		setOpenSetReady(true);
		if (loaded.activeTabId) {
			void selectTaskOptimistic(store, loaded.activeTabId);
		}
	}, [
		openSetReady,
		defaultTasksHydrated,
		inventoryIds,
		inventoryRows,
		projectsFromPush,
		commitOpenSet,
		store
	]);

	/**
	 * Option B: Open Tab is the Bind/Attach working set after Register / reconnect.
	 * Wait for slotReadyKey (workspaceId), not only engine ready — Bind before
	 * Register leaves background tabs unbound with no retry.
	 */
	useEffect(() => {
		if (!openSetReady) return;
		if (engineStatus !== 'ready') return;
		if (!slotReadyKey) return;
		const ids = openTabLiveTaskIds(openSetRef.current);
		if (ids.length === 0) return;
		void ensureTasksLiveOptimistic(ids);
	}, [openSetReady, engineStatus, slotReadyKey, openSet.tabs, inventoryIds]);

	/** Inventory shrink (e.g. Project left Engine open set) → drop vanished Open Tabs. */
	useEffect(() => {
		if (!openSetReady) return;
		const cur = openSetRef.current;
		const next = pruneOpenSet(cur, inventoryRows);
		const same =
			next.tabs.length === cur.tabs.length &&
			next.tabs.every(
				(t, i) =>
					t.id === cur.tabs[i]?.id &&
					(t.sessionId ?? '') === (cur.tabs[i]?.sessionId ?? '')
			) &&
			next.activeTabId === cur.activeTabId &&
			next.expandedGroupKey === cur.expandedGroupKey;
		if (same) return;
		applyOpenSetChange(next);
	}, [openSetReady, inventoryRows, applyOpenSetChange]);

	useEffect(() => {
		if (!openSetReady) return;
		const refs = new Map<string, TaskOpenRef>();
		for (const id of openSet.tabs.map(t => t.id)) {
			const ref = resolveTaskOpenRef(openRefSource, id);
			if (ref) refs.set(id, ref);
		}
		if (refs.size === 0) return;
		const synced = syncOpenTabTitles(openSetRef.current, refs);
		if (synced !== openSetRef.current) commitOpenSet(synced);
	}, [openSetReady, openRefSource, openSet.tabs, commitOpenSet]);

	/** Engine Focus Change (createTask / select) → ensure Open Tab — after chrome hydrate. */
	useEffect(() => {
		if (!openSetReady) return;
		if (!activeTaskId) return;
		const ref = resolveTaskOpenRef(openRefSource, activeTaskId);
		if (!ref) return;
		const cur = openSetRef.current;
		if (cur.activeTabId === activeTaskId && cur.tabs.some(t => t.id === activeTaskId)) return;
		commitOpenSet(ensureOpenTask(cur, ref));
	}, [openSetReady, activeTaskId, openRefSource, commitOpenSet]);

	const dropOpenTabs = useCallback(
		(taskIds: string[]) => {
			if (taskIds.length === 0) return;
			applyOpenSetChange(dropOpenTabIds(openSetRef.current, new Set(taskIds)));
		},
		[applyOpenSetChange]
	);

	const closeOpenTabChrome = useCallback(
		(tabId: string) => {
			const {set: next, focusTaskId} = closeOpenTab(openSetRef.current, tabId);
			commitOpenSet(next);
			if (focusTaskId) {
				void selectTaskOptimistic(store, focusTaskId);
			} else {
				clearTaskFocusOptimistic(store);
			}
		},
		[store, commitOpenSet]
	);

	const toggleTabGroup = useCallback(
		(groupKey: string) => {
			commitOpenSet(toggleGroupExpand(openSetRef.current, groupKey));
		},
		[commitOpenSet]
	);

	return {
		openSet,
		openSetRef,
		openSetReady,
		commitOpenSet,
		applyOpenSetChange,
		dropOpenTabs,
		closeOpenTabChrome,
		toggleTabGroup
	};
}
