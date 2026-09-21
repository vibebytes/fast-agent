import type {ComposerGate, ProjectSnapshot, TaskSummary, TasksMeta} from '../env';
import {taskOrSessionMatch} from '../openSetFocus';
import {isUnresolvedModelDisplay} from '@fast-ide/session-view';
import type {TranscriptSlice, WorkspaceState} from '../workspaceStore';

export const IDLE_GATE: ComposerGate = {
	runState: 'idle',
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};

export const emptySlice = (): TranscriptSlice => ({
	entries: [],
	approvals: [],
	questions: [],
	questionBatches: [],
	subagents: [],
	contextInjections: [],
	codeChanges: [],
	liveProcs: [],
	liveTasks: [],
	childWork: []
});

export const EMPTY_TRANSCRIPT = emptySlice();
export const BODY_CACHE_MAX = 32;

export function sameTask(a: TaskSummary, b: TaskSummary): boolean {
	return (
		a.id === b.id &&
		a.title === b.title &&
		a.kind === b.kind &&
		a.sessionId === b.sessionId &&
		Boolean(a.active) === Boolean(b.active) &&
		(a.runState ?? null) === (b.runState ?? null) &&
		(a.lastModified ?? null) === (b.lastModified ?? null)
	);
}

export function reconcileTasks(prev: TaskSummary[], next: TaskSummary[]): TaskSummary[] {
	if (prev === next) return prev;
	const byId = new Map(prev.map(t => [t.id, t]));
	let identical = prev.length === next.length;
	const merged = next.map((t, i) => {
		const old = byId.get(t.id);
		const keep = old && sameTask(old, t) ? old : t;
		if (keep !== prev[i]) identical = false;
		return keep;
	});
	return identical ? prev : merged;
}

export function reconcileProjectTasks(
	prev: Record<string, TaskSummary[]>,
	next: Record<string, TaskSummary[]>
): Record<string, TaskSummary[]> {
	if (prev === next) return prev;
	const merged: Record<string, TaskSummary[]> = {};
	let identical = Object.keys(prev).length === Object.keys(next).length;
	for (const [id, list] of Object.entries(next)) {
		const kept = reconcileTasks(prev[id] ?? [], list);
		merged[id] = kept;
		if (kept !== prev[id]) identical = false;
	}
	return identical ? prev : merged;
}

export function sameProject(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
	return (
		a.id === b.id &&
		a.path === b.path &&
		a.status === b.status &&
		(a.error ?? null) === (b.error ?? null) &&
		Boolean(a.active) === Boolean(b.active) &&
		(a.cwd ?? null) === (b.cwd ?? null) &&
		(a.displayName ?? null) === (b.displayName ?? null)
	);
}

export function reconcileProjects(prev: ProjectSnapshot[], next: ProjectSnapshot[]): ProjectSnapshot[] {
	if (prev === next) return prev;
	const byId = new Map(prev.map(p => [p.id, p]));
	let identical = prev.length === next.length;
	const merged = next.map((p, i) => {
		const old = byId.get(p.id);
		const keep = old && sameProject(old, p) ? old : p;
		if (keep !== prev[i]) identical = false;
		return keep;
	});
	return identical ? prev : merged;
}

/** Content patches restate the gate every flush — keep identity when unchanged (P0-3). */
export function keepEqualGate(prev: ComposerGate, next: ComposerGate): ComposerGate {
	if (prev === next) return prev;
	const same =
		prev.runState === next.runState &&
		prev.canSubmitNow === next.canSubmitNow &&
		prev.canEnqueue === next.canEnqueue &&
		prev.canCancel === next.canCancel &&
		prev.composerLocked === next.composerLocked &&
		prev.lockReason === next.lockReason;
	return same ? prev : next;
}

/** Apply focus-owned fields from a TasksMeta / Focus packet. */
export function applyTasksMeta(state: WorkspaceState, meta: TasksMeta): WorkspaceState {
	return {
		...state,
		tasks: reconcileTasks(state.tasks, meta.tasks),
		chats: reconcileTasks(state.chats, meta.chats),
		defaultTasks: reconcileTasks(state.defaultTasks, meta.defaultTasks ?? []),
		defaultTasksHydrated:
			meta.defaultTasksHydrated !== undefined
				? meta.defaultTasksHydrated
				: state.defaultTasksHydrated,
		activeTaskId: meta.activeTaskId,
		activeKind: meta.activeKind,
		gate: meta.gate,
		model: meta.model,
		modelDisplay: meta.modelDisplay,
		modelCatalog: meta.modelCatalog,
		runMode: meta.runMode ?? 'agent',
		engineKind: meta.engineKind ?? state.engineKind ?? 'fast',
		availableEngineIds: meta.availableEngineIds ?? state.availableEngineIds ?? ['fast'],
		effort: meta.effort,
		thinking: meta.thinking,
		slashCatalog: meta.slashCatalog ?? [],
		slashCatalogHydrated:
			meta.slashCatalogHydrated !== undefined
				? meta.slashCatalogHydrated
				: state.slashCatalogHydrated,
		queue: meta.queue,
		queuePaused: meta.queuePaused,
		dshCaps: meta.dshCaps,
		dshQueue: meta.dshQueue ?? [],
		dshGoal: meta.dshGoal ?? null,
		engineStatus:
			meta.engineStatus !== undefined ? (meta.engineStatus ?? null) : state.engineStatus,
		engineError: meta.engineError !== undefined ? (meta.engineError ?? null) : state.engineError
	};
}

/** Alias / yaml stub before ListProviders resolve — must not stick in Composer. */
export function isPlaceholderModelDisplay(display: string | undefined): boolean {
	return isUnresolvedModelDisplay(display);
}

/**
 * Structural `tasks:changed`: lists + engine catalog only.
 * Never owns focus (`activeTaskId` / `activeKind`). Gate/queue stay focus-scoped;
 * model chrome may still upgrade off the "Default" stub when Engine resolves.
 */
export function applyTasksStructure(state: WorkspaceState, meta: TasksMeta): WorkspaceState {
	const activeTaskId = state.activeTaskId;
	const chromeForFocus = activeTaskId != null && meta.activeTaskId === activeTaskId;
	const applyModelChrome =
		chromeForFocus ||
		activeTaskId == null ||
		(isPlaceholderModelDisplay(state.modelDisplay) &&
			!isPlaceholderModelDisplay(meta.modelDisplay));
	return {
		...state,
		tasks: reconcileTasks(state.tasks, markActive(meta.tasks, activeTaskId)),
		chats: reconcileTasks(state.chats, markActive(meta.chats, activeTaskId)),
		defaultTasks: reconcileTasks(
			state.defaultTasks,
			markActive(meta.defaultTasks ?? [], activeTaskId)
		),
		defaultTasksHydrated:
			meta.defaultTasksHydrated !== undefined
				? meta.defaultTasksHydrated
				: state.defaultTasksHydrated,
		modelCatalog: meta.modelCatalog ?? state.modelCatalog,
		slashCatalog: meta.slashCatalog ?? state.slashCatalog,
		slashCatalogHydrated:
			meta.slashCatalogHydrated !== undefined
				? meta.slashCatalogHydrated
				: state.slashCatalogHydrated,
		availableEngineIds: meta.availableEngineIds ?? state.availableEngineIds ?? ['fast'],
		...(applyModelChrome
			? {
					model: meta.model,
					modelDisplay: meta.modelDisplay,
					runMode: meta.runMode ?? 'agent',
					engineKind: meta.engineKind ?? state.engineKind,
					effort: meta.effort,
					thinking: meta.thinking
				}
			: {}),
		...(chromeForFocus
			? {
					gate: meta.gate,
					queue: meta.queue,
					queuePaused: meta.queuePaused,
					dshCaps: meta.dshCaps,
					dshQueue: meta.dshQueue ?? [],
					dshGoal: meta.dshGoal ?? null
				}
			: {}),
		engineStatus:
			meta.engineStatus !== undefined ? (meta.engineStatus ?? null) : state.engineStatus,
		engineError: meta.engineError !== undefined ? (meta.engineError ?? null) : state.engineError
	};
}

export function applyBody(
	state: WorkspaceState,
	taskId: string,
	slice: TranscriptSlice,
	fromPush: boolean,
	revision?: number
): WorkspaceState {
	const byTaskId = {...state.byTaskId};
	// Object insertion order is our tiny LRU: reinsert the touched Task at the
	// end, then evict an inactive Task. Copies stay O(BODY_CACHE_MAX), not O(all
	// Tasks ever opened).
	delete byTaskId[taskId];
	byTaskId[taskId] = slice;
	const evicted: string[] = [];
	let overflow = Object.keys(byTaskId).length - BODY_CACHE_MAX;
	for (const id of Object.keys(byTaskId)) {
		if (overflow <= 0) break;
		if (id === taskId || id === state.activeTaskId) continue;
		delete byTaskId[id];
		evicted.push(id);
		overflow -= 1;
	}
	let bodyFromPush = state.bodyFromPush;
	if ((fromPush && !bodyFromPush[taskId]) || evicted.length > 0) {
		bodyFromPush = {...bodyFromPush};
		if (fromPush) bodyFromPush[taskId] = true;
		for (const id of evicted) delete bodyFromPush[id];
	}
	let bodyRevision = state.bodyRevision;
	if (
		(revision !== undefined && bodyRevision[taskId] !== revision) ||
		evicted.some(id => bodyRevision[id] !== undefined)
	) {
		bodyRevision = {...bodyRevision};
		if (revision !== undefined) bodyRevision[taskId] = revision;
		for (const id of evicted) delete bodyRevision[id];
	}
	return {
		...state,
		byTaskId,
		bodyFromPush,
		bodyRevision,
		activeBodyRevision:
			revision !== undefined && state.activeTaskId === taskId
				? revision
				: state.activeBodyRevision
	};
}

export function markActive(list: TaskSummary[], activeId: string | null): TaskSummary[] {
	// Preserve object identity when the flag is unchanged — sidebar row memos
	// depend on untouched rows keeping their references (P1).
	let changed = false;
	const next = list.map(t => {
		const active = t.id === activeId;
		if (Boolean(t.active) === active) return t;
		changed = true;
		return {...t, active};
	});
	return changed ? next : list;
}

export function markProjectsActive(
	list: ProjectSnapshot[],
	activeProjectId: string | null
): ProjectSnapshot[] {
	let changed = false;
	const next = list.map(p => {
		const active = p.id === activeProjectId;
		if (Boolean(p.active) === active) return p;
		changed = true;
		return {...p, active};
	});
	return changed ? next : list;
}

export function findTaskContext(
	state: WorkspaceState,
	taskId: string
): {
	task: TaskSummary;
	projectId: string | null;
	source: 'project' | 'default' | 'chat' | 'tasks';
} | null {
	for (const [projectId, list] of Object.entries(state.projectTasks)) {
		const task = list.find(t => taskOrSessionMatch(t, taskId));
		if (task) return {task, projectId, source: 'project'};
	}
	const def = state.defaultTasks.find(t => taskOrSessionMatch(t, taskId));
	if (def) return {task: def, projectId: null, source: 'default'};
	const chat = state.chats.find(t => taskOrSessionMatch(t, taskId));
	if (chat) return {task: chat, projectId: state.activeProjectId, source: 'chat'};
	const task = state.tasks.find(t => taskOrSessionMatch(t, taskId));
	if (task) return {task, projectId: state.activeProjectId, source: 'tasks'};
	return null;
}
