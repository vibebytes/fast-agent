/**
 * Renderer workspace store — single reducer for all IPC push/pull payloads
 * (Candidate K / ADR-0016). Chrome (sidebarUi, layout, theme) stays in React state.
 *
 * Push channels are authoritative; cold pulls only fill fields that have never
 * been written by a push (stale-pull race).
 */
import type {
	BridgeErrorEnvelope,
	CodeChange,
	ComposerGate,
	EngineHostStatus,
	LiveProc,
	LiveTask,
	ModelCatalogEntry,
	PendingApproval,
	PendingQuestion,
	PendingQuestionBatch,
	TranscriptSubagent,
	ProjectGetResult,
	ProjectSnapshot,
	GoalCardView,
	GoalFlowView,
	LiveChildWork,
	ProjectState,
	ProjectsSnapshot,
	QueueItem,
	DshCaps,
	DshQueueItem,
	DshGoalView,
	SlashCatalogEntry,
	TaskSummary,
	TasksMeta,
	TasksSnapshot,
	TranscriptEntry,
	TranscriptPatch,
	TranscriptTailPatch,
	WorkspaceFocus
} from './env';
import {taskOrSessionMatch} from './openSetFocus';
import {markTabFocusIpc, startTabFocus} from './performanceTrace';
import {isUnresolvedModelDisplay} from '../../shared/defaultModel';

export type TranscriptSlice = {
	entries: TranscriptEntry[];
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	/** P1b rerun provenance (victim runId → superseding turn id). */
	superseded?: Record<string, string>;
	/** Victim runIds whose rerun was a retry of a failed run. */
	codeChanges: CodeChange[];
	liveProcs?: LiveProc[];
	liveTasks?: LiveTask[];
	/** Unified child-workload rows (goal steps / subagents / fires). */
	childWork?: LiveChildWork[];
	/** Chat-flow Goal member status (L1 agent_call with goalId). */
	goalFlow?: GoalFlowView;
	/** ②′ Goal card for this Task (confirm / busy / escalate / completion). */
	goalCard?: GoalCardView | null;
};

const IDLE_GATE: ComposerGate = {
	runState: 'idle',
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};

const emptySlice = (): TranscriptSlice => ({
	entries: [],
	approvals: [],
	questions: [],
	questionBatches: [],
	subagents: [],
	codeChanges: [],
	liveProcs: [],
	liveTasks: [],
	childWork: []
});

/** Stable missing-task snapshot required by useSyncExternalStore. */
const EMPTY_TRANSCRIPT = emptySlice();
export const BODY_CACHE_MAX = 32;

/**
 * IPC publishes remake every TaskSummary object; reconcile against the previous
 * list so unchanged rows keep object identity and sidebar row memos hold (P1).
 */
function sameTask(a: TaskSummary, b: TaskSummary): boolean {
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

function reconcileTasks(prev: TaskSummary[], next: TaskSummary[]): TaskSummary[] {
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

function reconcileProjectTasks(
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

function sameProject(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
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

function reconcileProjects(prev: ProjectSnapshot[], next: ProjectSnapshot[]): ProjectSnapshot[] {
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
function keepEqualGate(prev: ComposerGate, next: ComposerGate): ComposerGate {
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

export type WorkspaceState = {
	projects: ProjectSnapshot[];
	projectTasks: Record<string, TaskSummary[]>;
	/** Per-project Task list known (empty array after hydrate counts). */
	projectTasksHydrated: Record<string, boolean>;
	activeProjectId: string | null;
	project: ProjectState;

	tasks: TaskSummary[];
	chats: TaskSummary[];
	defaultTasks: TaskSummary[];
	/** False until Meta hydrate for Default Project (empty counts). */
	defaultTasksHydrated: boolean;
	activeTaskId: string | null;
	activeKind: 'task' | 'chat' | null;
	gate: ComposerGate;
	model: string;
	modelDisplay: string;
	modelCatalog: ModelCatalogEntry[];
	runMode: 'agent' | 'plan' | 'ask' | 'yolo';
	engineKind: 'fast' | 'dsh';
	availableEngineIds: string[];
	effort?: string;
	thinking?: boolean;
	slashCatalog: SlashCatalogEntry[];
	slashCatalogHydrated: boolean;
	queue: QueueItem[];
	queuePaused: boolean;
	dshCaps?: DshCaps;
	dshQueue: DshQueueItem[];
	dshGoal?: DshGoalView | null;

	/** Per-Task Transcript body (ADR-0006). */
	byTaskId: Record<string, TranscriptSlice>;
	/** Task ids whose body is authoritative (push, or a revisioned body pull). */
	bodyFromPush: Record<string, true>;
	/** Host revision represented by each cached body. */
	bodyRevision: Record<string, number>;
	/** Revision advertised by the current slim Focus Change. */
	activeBodyRevision: number | null;
	/** True after any `tasks:changed` push (not a cold pull). */
	tasksMetaFromPush: boolean;
	/** True after `projects:changed` or `workspace:focus`. */
	projectsFromPush: boolean;
	/** True after `project:changed` or focus. */
	projectFromPush: boolean;

	/** Monotone Focus Change epoch (optimistic + authoritative). */
	focusEpoch: number;

	engineStatus: EngineHostStatus | null;
	engineError: string | null;
	/** Sticky banner; prefer `code` + `t(\`errors.${code}\`)` when present. */
	bridgeError: {
		message: string;
		code?: string;
		params?: Record<string, string | number>;
	} | null;
};

/** Workspace fields that are safe to subscribe as non-transcript chrome. */
export type WorkspaceChromeSnapshot = Omit<
	WorkspaceState,
	'byTaskId' | 'bodyFromPush' | 'bodyRevision' | 'activeBodyRevision'
>;

export type WorkspaceEvent =
	| {type: 'tasks:changed'; payload: TasksMeta}
	| {type: 'tasks:pull'; payload: TasksSnapshot}
	| {type: 'transcript:patched'; payload: TranscriptPatch}
	| {type: 'transcript:tailPatched'; payload: TranscriptTailPatch}
	| {type: 'projects:changed'; payload: ProjectsSnapshot}
	| {type: 'workspace:focus'; payload: WorkspaceFocus}
	| {type: 'focus:optimistic'; payload: {taskId: string; focusEpoch: number}}
	/** Chrome-only clear (e.g. last Open Tab closed). Does not Detach Engine Sessions. */
	| {type: 'focus:clear'; payload: {focusEpoch: number}}
	| {type: 'focus:rollback'; payload: {failedEpoch: number; snapshot: WorkspaceState}}
	| {type: 'project:changed'; payload: ProjectState}
	| {type: 'projects:pull'; payload: ProjectGetResult}
	| {type: 'bridge:error'; payload: BridgeErrorEnvelope};

export function initialWorkspaceState(): WorkspaceState {
	return {
		projects: [],
		projectTasks: {},
		projectTasksHydrated: {},
		activeProjectId: null,
		project: null,
		tasks: [],
		chats: [],
		defaultTasks: [],
		defaultTasksHydrated: false,
		activeTaskId: null,
		activeKind: null,
		gate: IDLE_GATE,
		model: 'default',
		modelDisplay: '',
		modelCatalog: [],
		runMode: 'agent',
		engineKind: 'fast',
		availableEngineIds: ['fast'],
		effort: undefined,
		thinking: undefined,
		slashCatalog: [],
		slashCatalogHydrated: false,
		queue: [],
		queuePaused: false,
		dshQueue: [],
		dshGoal: null,
		byTaskId: {},
		bodyFromPush: {},
		bodyRevision: {},
		activeBodyRevision: null,
		tasksMetaFromPush: false,
		projectsFromPush: false,
		projectFromPush: false,
		focusEpoch: 0,
		engineStatus: null,
		engineError: null,
		bridgeError: null
	};
}

/** Apply focus-owned fields from a TasksMeta / Focus packet. */
function applyTasksMeta(state: WorkspaceState, meta: TasksMeta): WorkspaceState {
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
		engineKind: meta.engineKind ?? 'fast',
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
function isPlaceholderModelDisplay(display: string | undefined): boolean {
	return isUnresolvedModelDisplay(display);
}

/**
 * Structural `tasks:changed`: lists + engine/catalog only.
 * Never owns focus (`activeTaskId` / `activeKind`). Gate/queue stay focus-scoped;
 * model chrome may still upgrade off the "Default" stub when Engine resolves.
 */
function applyTasksStructure(state: WorkspaceState, meta: TasksMeta): WorkspaceState {
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
		...(applyModelChrome
			? {
					model: meta.model,
					modelDisplay: meta.modelDisplay,
					runMode: meta.runMode ?? 'agent',
					engineKind: meta.engineKind ?? 'fast',
					availableEngineIds: meta.availableEngineIds ?? state.availableEngineIds ?? ['fast'],
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

function applyBody(
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

function markActive(list: TaskSummary[], activeId: string | null): TaskSummary[] {
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

function markProjectsActive(
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

function findTaskContext(
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

/** Snapshot before optimistic focus; used for rollback on selectTask failure. */
export function beginOptimisticFocus(
	state: WorkspaceState,
	taskId: string
): {snapshot: WorkspaceState; focusEpoch: number; event: WorkspaceEvent} | null {
	const ctx = findTaskContext(state, taskId);
	if (!ctx) return null;
	const focusEpoch = state.focusEpoch + 1;
	return {
		snapshot: state,
		focusEpoch,
		event: {type: 'focus:optimistic', payload: {taskId: ctx.task.id, focusEpoch}}
	};
}

export function reduceWorkspace(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
	switch (event.type) {
		case 'tasks:changed': {
			return {
				...applyTasksStructure(state, event.payload),
				tasksMetaFromPush: true
			};
		}
		case 'tasks:pull': {
			const snap = event.payload;
			let next = state;
		if (!state.tasksMetaFromPush) {
			next = applyTasksStructure(next, snap);
		} else if (
			state.modelCatalog.length === 0 &&
			(snap.modelCatalog?.length ?? 0) > 0
		) {
			// Restore often pushes empty chrome before ListProviders; cold pull must still heal.
			next = {
				...next,
				modelCatalog: snap.modelCatalog,
				model: snap.model,
				modelDisplay: snap.modelDisplay,
				...(snap.runMode ? {runMode: snap.runMode} : {}),
				...(snap.engineKind ? {engineKind: snap.engineKind} : {}),
				...(snap.effort !== undefined ? {effort: snap.effort} : {}),
				...(snap.thinking !== undefined ? {thinking: snap.thinking} : {})
			};
		}
			const taskId = snap.activeTaskId;
			const cachedRevision = taskId ? state.bodyRevision[taskId] : undefined;
			const pullIsNewer =
				snap.bodyRevision !== undefined &&
				(cachedRevision === undefined || snap.bodyRevision > cachedRevision);
			if (taskId && (!state.bodyFromPush[taskId] || pullIsNewer)) {
				next = applyBody(
					next,
					taskId,
					{
						entries: snap.transcript,
						approvals: snap.approvals,
						questions: snap.questions,
						questionBatches: snap.questionBatches ?? [],
						subagents: snap.subagents ?? [],
						superseded: snap.superseded ?? {},
						codeChanges: snap.codeChanges,
						liveProcs: snap.liveProcs ?? [],
						liveTasks: snap.liveTasks ?? [],
						childWork: snap.childWork ?? [],
						goalFlow: snap.goalFlow,
						goalCard: snap.goalCard ?? null
					},
					snap.bodyRevision !== undefined,
					snap.bodyRevision
				);
			}
			return next;
		}
		case 'transcript:patched': {
			const {payload} = event;
			if (
				payload.bodyRevision !== undefined &&
				(state.bodyRevision[payload.taskId] ?? 0) > payload.bodyRevision
			) {
				return state;
			}
			const next = applyBody(
				state,
				payload.taskId,
				{
					entries: payload.entries,
					approvals: payload.approvals,
					questions: payload.questions,
					questionBatches: payload.questionBatches ?? [],
					subagents: payload.subagents ?? [],
					superseded: payload.superseded ?? {},
					codeChanges: payload.codeChanges,
					liveProcs: payload.liveProcs ?? [],
					liveTasks: payload.liveTasks ?? [],
					childWork: payload.childWork ?? [],
					goalFlow: payload.goalFlow,
					goalCard: payload.goalCard ?? null
				},
				true,
				payload.bodyRevision
			);
			// Content path never owns focus; gate only for the focused Task.
			if (payload.taskId !== state.activeTaskId) return next;
			return {...next, gate: keepEqualGate(state.gate, payload.gate)};
		}
		case 'transcript:tailPatched': {
			const {payload} = event;
			if (
				payload.bodyRevision !== undefined &&
				(state.bodyRevision[payload.taskId] ?? 0) > payload.bodyRevision
			) {
				return state;
			}
			const existing = state.byTaskId[payload.taskId];
			// No local base (cold task) or desynced base: ignore — the next full
			// transcript:patched / focus / snapshot publish heals the body.
			if (!existing) return state;
			if (payload.from > existing.entries.length) return state;
			const entries = existing.entries.slice(0, payload.from).concat(payload.entries);
			if (entries.length !== payload.total) return state;
			const slice: TranscriptSlice = {
				entries,
				approvals: payload.approvals ?? existing.approvals,
				questions: payload.questions ?? existing.questions,
				questionBatches: payload.questionBatches ?? existing.questionBatches ?? [],
				subagents: payload.subagents ?? existing.subagents ?? [],
				superseded: payload.superseded ?? existing.superseded ?? {},
				codeChanges: payload.codeChanges ?? existing.codeChanges,
				liveProcs: payload.liveProcs ?? existing.liveProcs ?? [],
				liveTasks: payload.liveTasks ?? existing.liveTasks ?? [],
				childWork: payload.childWork ?? existing.childWork ?? [],
				goalFlow: payload.goalFlow !== undefined ? payload.goalFlow : existing.goalFlow,
				goalCard: payload.goalCard !== undefined ? payload.goalCard : (existing.goalCard ?? null)
			};
			const next = applyBody(
				state,
				payload.taskId,
				slice,
				true,
				payload.bodyRevision
			);
			if (payload.taskId !== state.activeTaskId) return next;
			return {...next, gate: keepEqualGate(state.gate, payload.gate)};
		}
		case 'projects:changed': {
			const p = event.payload;
			const hydrated = {...state.projectTasksHydrated};
			if (p.projectTasksHydrated) {
				Object.assign(hydrated, p.projectTasksHydrated);
			} else if (p.projectTasks) {
				for (const id of Object.keys(p.projectTasks)) {
					hydrated[id] = true;
				}
			}
			// Focus owns activeProjectId — structure only remakes list `active` flags.
			const activeProjectId = state.activeProjectId;
			return {
				...state,
				projects: reconcileProjects(
					state.projects,
					markProjectsActive(p.projects, activeProjectId)
				),
				activeProjectId,
				projectTasks: p.projectTasks
					? reconcileProjectTasks(state.projectTasks, p.projectTasks)
					: state.projectTasks,
				projectTasksHydrated: hydrated,
				engineStatus: p.engineStatus !== undefined ? (p.engineStatus ?? null) : state.engineStatus,
				engineError: p.engineError !== undefined ? (p.engineError ?? null) : state.engineError,
				projectsFromPush: true
			};
		}
		case 'workspace:focus': {
			const p = event.payload;
			if (p.focusEpoch < state.focusEpoch) {
				return state;
			}
			let next: WorkspaceState = {
				...state,
				focusEpoch: p.focusEpoch,
				projects: reconcileProjects(state.projects, p.projects),
				activeProjectId: p.activeProjectId,
				project: p.project,
				engineStatus: p.engineStatus !== undefined ? (p.engineStatus ?? null) : state.engineStatus,
				engineError: p.engineError !== undefined ? (p.engineError ?? null) : state.engineError,
				projectsFromPush: true,
				projectFromPush: true,
				tasksMetaFromPush: true,
				activeBodyRevision: p.bodyRevision ?? null
			};
			next = applyTasksMeta(next, {
				tasks: p.tasks,
				chats: p.chats,
				defaultTasks: p.defaultTasks,
				defaultTasksHydrated: p.defaultTasksHydrated,
				activeTaskId: p.activeTaskId,
				activeKind: p.activeKind,
				gate: p.gate,
				model: p.model,
				modelDisplay: p.modelDisplay,
				modelCatalog: p.modelCatalog,
				runMode: p.runMode,
				engineKind: p.engineKind,
				effort: p.effort,
				thinking: p.thinking,
				slashCatalog: p.slashCatalog ?? [],
				slashCatalogHydrated: p.slashCatalogHydrated,
				queue: p.queue,
				queuePaused: p.queuePaused,
				dshCaps: p.dshCaps,
				dshQueue: p.dshQueue ?? [],
				dshGoal: p.dshGoal ?? null,
				engineStatus: p.engineStatus,
				engineError: p.engineError
			});
			if (p.activeTaskId) {
				const existing = state.byTaskId[p.activeTaskId];
				if (p.transcript !== undefined) {
					// Legacy full-body focus (still valid wire shape).
					const incoming = {
						entries: p.transcript,
						approvals: p.approvals ?? [],
						questions: p.questions ?? [],
						questionBatches: p.questionBatches ?? [],
						subagents: p.subagents ?? [],
						superseded: p.superseded ?? {},
						codeChanges: p.codeChanges ?? [],
						liveProcs: p.liveProcs ?? [],
						liveTasks: p.liveTasks ?? [],
						childWork: p.childWork ?? [],
						goalFlow: p.goalFlow,
						// Host truth on focus — background goal_updated never patched this renderer cache.
						goalCard: p.goalCard ?? null
					};
					// Attach-time focus often ships transcript:[] before session_restored.
					// A later empty focus must not blank a body already filled by patch.
					const keepExisting =
						Boolean(existing?.entries.length) && incoming.entries.length === 0;
					next = applyBody(
						next,
						p.activeTaskId,
						keepExisting && existing ? {...existing, goalCard: p.goalCard ?? null} : incoming,
						true,
						p.bodyRevision
					);
				} else if (existing) {
					// Slim focus (P1-6): body stays renderer-cached; goalCard is host truth.
					// Keep the slice identity when goalCard is unchanged — per-task
					// derived caches (timeline/sections) key on it across revisits.
					const goalCard = p.goalCard ?? null;
					next = applyBody(
						next,
						p.activeTaskId,
						existing.goalCard === goalCard ? existing : {...existing, goalCard},
						false
					);
				} else if (p.goalCard != null) {
					// No cached body yet — surface goal chrome without claiming a body push,
					// so the cold `task:list` pull can still fill entries.
					next = applyBody(
						next,
						p.activeTaskId,
						{...emptySlice(), goalCard: p.goalCard},
						false
					);
				}
			}
			return next;
		}
		case 'focus:clear': {
			const {focusEpoch} = event.payload;
			if (focusEpoch < state.focusEpoch) return state;
			return {
				...state,
				focusEpoch,
				activeTaskId: null,
				activeKind: null,
				activeBodyRevision: null,
				gate: IDLE_GATE,
				queue: [],
				queuePaused: false,
				dshCaps: undefined,
				dshQueue: [],
				dshGoal: null,
				tasks: markActive(state.tasks, null),
				chats: markActive(state.chats, null),
				defaultTasks: markActive(state.defaultTasks, null)
			};
		}
		case 'focus:optimistic': {
			const {taskId, focusEpoch} = event.payload;
			if (focusEpoch < state.focusEpoch) return state;
			const ctx = findTaskContext(state, taskId);
			if (!ctx) return state;

			const kind = ctx.task.kind ?? 'task';
			let next: WorkspaceState = {
				...state,
				focusEpoch,
				activeTaskId: taskId,
				activeKind: kind,
				activeBodyRevision: null,
				gate: IDLE_GATE,
				queue: [],
				queuePaused: false,
				dshCaps: undefined,
				dshQueue: [],
				dshGoal: null
			};

			if (ctx.source === 'project' && ctx.projectId) {
				const list = state.projectTasks[ctx.projectId] ?? [];
				next = {
					...next,
					activeProjectId: ctx.projectId,
					projects: markProjectsActive(state.projects, ctx.projectId),
					tasks: markActive(list, taskId),
					chats: markActive(
						state.activeProjectId === ctx.projectId ? state.chats : [],
						taskId
					),
					project: (() => {
						const snap = state.projects.find(p => p.id === ctx.projectId);
						if (!snap) return state.project;
						return {
							id: snap.id,
							path: snap.path,
							status: snap.status,
							error: snap.error,
							cwd: snap.cwd ?? snap.path
						};
					})()
				};
			} else if (ctx.source === 'default') {
				next = {
					...next,
					defaultTasks: markActive(state.defaultTasks, taskId),
					tasks: markActive(state.defaultTasks, taskId)
				};
			} else if (ctx.source === 'chat') {
				next = {
					...next,
					chats: markActive(state.chats, taskId),
					tasks: markActive(state.tasks, taskId)
				};
			} else {
				next = {
					...next,
					tasks: markActive(state.tasks, taskId)
				};
			}

			const body = state.byTaskId[taskId] ?? emptySlice();
			return applyBody(next, taskId, body, false);
		}
		case 'focus:rollback': {
			const {failedEpoch, snapshot} = event.payload;
			// A rejected A→B select may resolve after a later B→C select succeeded.
			// Never let that late rejection move focus backwards or lower the epoch.
			if (state.focusEpoch !== failedEpoch) return state;
			const activeTaskId = snapshot.activeTaskId;
			const activeProjectId = snapshot.activeProjectId;
			const tasks = activeProjectId
				? state.projectTasks[activeProjectId] ?? snapshot.tasks
				: snapshot.tasks;
			const projectSnap = state.projects.find(p => p.id === activeProjectId);
			return {
				...state,
				focusEpoch: failedEpoch,
				activeProjectId,
				activeTaskId,
				activeKind: snapshot.activeKind,
				projects: markProjectsActive(state.projects, activeProjectId),
				project: projectSnap
					? {
							id: projectSnap.id,
							path: projectSnap.path,
							status: projectSnap.status,
							error: projectSnap.error,
							cwd: projectSnap.cwd ?? projectSnap.path
						}
					: snapshot.project,
				tasks: markActive(tasks, activeTaskId),
				chats: markActive(snapshot.chats, activeTaskId),
				defaultTasks: markActive(state.defaultTasks, activeTaskId),
				gate: snapshot.gate,
				queue: snapshot.queue,
				queuePaused: snapshot.queuePaused,
				dshCaps: snapshot.dshCaps,
				dshQueue: snapshot.dshQueue ?? [],
				dshGoal: snapshot.dshGoal ?? null,
				activeBodyRevision: snapshot.activeBodyRevision
			};
		}
		case 'project:changed': {
			return {
				...state,
				project: event.payload,
				projectFromPush: true
			};
		}
		case 'projects:pull': {
			const p = event.payload;
			if (state.projectsFromPush && state.projectFromPush) {
				return state;
			}
			let next = state;
			if (!state.projectsFromPush) {
				const hydrated = {...state.projectTasksHydrated};
				if (p.projectTasksHydrated) {
					Object.assign(hydrated, p.projectTasksHydrated);
				} else if (p.projectTasks) {
					for (const id of Object.keys(p.projectTasks)) {
						hydrated[id] = true;
					}
				}
				const activeProjectId = state.activeProjectId;
				next = {
					...next,
					projects: reconcileProjects(
						state.projects,
						markProjectsActive(p.projects, activeProjectId)
					),
					activeProjectId,
					projectTasks: p.projectTasks
						? reconcileProjectTasks(next.projectTasks, p.projectTasks)
						: next.projectTasks,
					projectTasksHydrated: hydrated,
					engineStatus:
						p.engineStatus !== undefined ? (p.engineStatus ?? null) : next.engineStatus,
					engineError: p.engineError !== undefined ? (p.engineError ?? null) : next.engineError
				};
			}
			return next;
		}
		case 'bridge:error': {
			// Empty message + no code clears sticky banner (prior create_failed after success).
			const msg = event.payload.message?.trim() ?? '';
			const code = event.payload.code?.trim() || undefined;
			if (!msg && !code) return {...state, bridgeError: null};
			return {
				...state,
				bridgeError: {
					message: msg,
					...(code ? {code} : {}),
					...(event.payload.params ? {params: event.payload.params} : {})
				}
			};
		}
		default:
			return state;
	}
}

export function activeTranscript(state: WorkspaceState): TranscriptSlice {
	if (!state.activeTaskId) return EMPTY_TRANSCRIPT;
	return state.byTaskId[state.activeTaskId] ?? EMPTY_TRANSCRIPT;
}

export function transcriptForTask(state: WorkspaceState, taskId: string): TranscriptSlice {
	return state.byTaskId[taskId] ?? EMPTY_TRANSCRIPT;
}

/** Whether the active Task cache cannot satisfy the latest slim Focus Change. */
export function bodyNeedsPull(state: WorkspaceState, taskId: string | null): boolean {
	if (!taskId) return false;
	const body = state.byTaskId[taskId] ?? EMPTY_TRANSCRIPT;
	const cachedRevision = state.bodyRevision[taskId];
	const focusedRevision =
		state.activeTaskId === taskId ? state.activeBodyRevision : null;
	return (
		(focusedRevision != null && cachedRevision !== focusedRevision) ||
		(!state.bodyFromPush[taskId] && body.entries.length === 0)
	);
}

function chromeSnapshot(state: WorkspaceState): WorkspaceChromeSnapshot {
	const snapshot = {...state} as Partial<WorkspaceState>;
	delete snapshot.byTaskId;
	delete snapshot.bodyFromPush;
	delete snapshot.bodyRevision;
	delete snapshot.activeBodyRevision;
	return snapshot as WorkspaceChromeSnapshot;
}

function chromeChanged(prev: WorkspaceState, next: WorkspaceState): boolean {
	for (const key of Object.keys(next) as Array<keyof WorkspaceState>) {
		if (
			key === 'byTaskId' ||
			key === 'bodyFromPush' ||
			key === 'bodyRevision' ||
			key === 'activeBodyRevision'
		) {
			continue;
		}
		if (!Object.is(prev[key], next[key])) return true;
	}
	return false;
}

function changedTranscriptTaskIds(
	prev: WorkspaceState,
	next: WorkspaceState
): string[] {
	if (prev.byTaskId === next.byTaskId) return [];
	const ids = new Set([...Object.keys(prev.byTaskId), ...Object.keys(next.byTaskId)]);
	return [...ids].filter(id => prev.byTaskId[id] !== next.byTaskId[id]);
}

export function createWorkspaceStore(initial: WorkspaceState = initialWorkspaceState()) {
	let state = initial;
	let version = 0;
	let chrome = chromeSnapshot(initial);
	let chromeVersion = 0;
	const transcriptVersions = new Map<string, number>();
	const listeners = new Set<() => void>();
	const chromeListeners = new Set<() => void>();
	const transcriptListeners = new Map<string, Set<() => void>>();

	const emit = (targets: ReadonlySet<() => void>) => {
		for (const listener of targets) listener();
	};

	const emitAll = () => {
		version += 1;
		emit(listeners);
	};

	return {
		getState(): WorkspaceState {
			return state;
		},
		getVersion(): number {
			return version;
		},
		getChromeSnapshot(): WorkspaceChromeSnapshot {
			return chrome;
		},
		getChromeVersion(): number {
			return chromeVersion;
		},
		getTranscript(taskId: string | null): TranscriptSlice {
			return taskId ? (state.byTaskId[taskId] ?? EMPTY_TRANSCRIPT) : EMPTY_TRANSCRIPT;
		},
		getTranscriptVersion(taskId: string | null): number {
			return taskId ? (transcriptVersions.get(taskId) ?? 0) : 0;
		},
		dispatch(event: WorkspaceEvent): void {
			const prev = state;
			const next = reduceWorkspace(prev, event);
			const changedTasks = changedTranscriptTaskIds(prev, next);
			const didChangeChrome = chromeChanged(prev, next);
			state = next;

			for (const taskId of changedTasks) {
				transcriptVersions.set(taskId, (transcriptVersions.get(taskId) ?? 0) + 1);
			}
			for (const taskId of transcriptVersions.keys()) {
				if (!next.byTaskId[taskId] && !transcriptListeners.has(taskId)) {
					transcriptVersions.delete(taskId);
				}
			}
			if (didChangeChrome) {
				chrome = chromeSnapshot(next);
				chromeVersion += 1;
			}

			emitAll();
			for (const taskId of changedTasks) {
				const targets = transcriptListeners.get(taskId);
				if (targets) emit(targets);
			}
			if (didChangeChrome) emit(chromeListeners);
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		subscribeChrome(listener: () => void): () => void {
			chromeListeners.add(listener);
			return () => {
				chromeListeners.delete(listener);
			};
		},
		subscribeTranscript(taskId: string | null, listener: () => void): () => void {
			if (!taskId) return () => {};
			const targets = transcriptListeners.get(taskId) ?? new Set<() => void>();
			targets.add(listener);
			transcriptListeners.set(taskId, targets);
			return () => {
				targets.delete(listener);
				if (targets.size === 0) transcriptListeners.delete(taskId);
			};
		}
	};
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

/** Optimistic focus + invoke; rolls back store on select failure. Returns whether select stuck. */
/** Open Tab working-set Bind+Attach (no focus / no store mutation). */
export async function ensureTasksLiveOptimistic(
	taskIds: string[]
): Promise<{ok: string[]; skipped: string[]}> {
	if (taskIds.length === 0) return {ok: [], skipped: []};
	return window.fastIde.ensureTasksLive(taskIds);
}

export async function selectTaskOptimistic(
	store: WorkspaceStore,
	taskId: string
): Promise<boolean> {
	const fromTaskId = store.getState().activeTaskId;
	const spanId = startTabFocus({taskId, fromTaskId});
	const ipcT0 = performance.now();
	const prep = beginOptimisticFocus(store.getState(), taskId);
	if (!prep) {
		const result = await window.fastIde.selectTask(taskId);
		const ok = Boolean(result);
		markTabFocusIpc({
			id: spanId,
			ok,
			durationMs: performance.now() - ipcT0,
			main: result?.trace
		});
		return ok;
	}
	store.dispatch(prep.event);
	const result = await window.fastIde.selectTask(taskId, prep.focusEpoch);
	if (!result) {
		store.dispatch({
			type: 'focus:rollback',
			payload: {failedEpoch: prep.focusEpoch, snapshot: prep.snapshot}
		});
		markTabFocusIpc({
			id: spanId,
			ok: false,
			focusEpoch: prep.focusEpoch,
			durationMs: performance.now() - ipcT0
		});
		return false;
	}
	markTabFocusIpc({
		id: spanId,
		ok: true,
		focusEpoch: prep.focusEpoch,
		durationMs: performance.now() - ipcT0,
		main: result.trace
	});
	return true;
}

/** Clear renderer focus when the Open Tab open set becomes empty (no Engine Detach). */
export function clearTaskFocusOptimistic(store: WorkspaceStore): void {
	const state = store.getState();
	if (!state.activeTaskId) return;
	store.dispatch({
		type: 'focus:clear',
		payload: {focusEpoch: state.focusEpoch + 1}
	});
}

