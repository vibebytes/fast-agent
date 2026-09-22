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
	ContextInjectionView,
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
	ChildTranscriptView,
	CompactingView,
	ContextPruneView,
	UsageView,
	TaskSummary,
	TaskBodySnapshot,
	TasksMeta,
	TasksSnapshot,
	TranscriptEntry,
	TranscriptPatch,
	TranscriptTailPatch,
	WorkspaceFocus
} from './env';
import {markTabFocusIpc, startTabFocus} from './performanceTrace';
import {EMPTY_TRANSCRIPT, IDLE_GATE, findTaskContext} from './workspace/reconcile';
import {reduceWorkspace} from './workspace/reduce';

export type TranscriptSlice = {
	entries: TranscriptEntry[];
	/** Turn token/cost footer (last turn's tokens + session cost). */
	usage?: UsageView;
	/** Context prune boundary rows (older pruned turns are hidden). */
	contextPrunes?: ContextPruneView[];
	/** Stage-B compaction in flight for the active run. */
	compacting?: CompactingView;
	/** Child loop transcripts keyed by child call id. */
	childTranscripts?: Record<string, ChildTranscriptView>;
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	/** Engine-injected context rows (recall / plugin snapshot) — never user bubbles. */
	contextInjections?: ContextInjectionView[];
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

export {BODY_CACHE_MAX} from './workspace/reconcile';
export {reduceWorkspace} from './workspace/reduce';

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
	| {type: 'body:pulled'; payload: TaskBodySnapshot}
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

