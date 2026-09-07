/**
 * Dialogue-domain wire types used by session-view projections.
 * Domain Transcript / Gate types are re-used by name (no *Payload aliases).
 */
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {ComposerGate} from '../composerGate.js';
import type {
	GoalFlowView,
	LiveChildWork,
	LiveProc,
	LiveTask,
	PendingApproval,
	PendingQuestion,
	PendingQuestionBatch,
	TranscriptEntry,
	TranscriptSubagent
} from '../transcriptProjection.js';

export type ProjectStatus = 'starting' | 'ready' | 'error' | 'exited';

export type EngineHostStatus = 'starting' | 'ready' | 'reconnecting' | 'error' | 'exited';

export type ProjectSnapshot = {
	id: string;
	path: string;
	status: ProjectStatus;
	error?: string;
	cwd?: string;
	active: boolean;
	isDefault?: boolean;
	/** Engine-durable display name; UI falls back to path basename when blank. */
	displayName?: string | null;
	/** Slot path-hash after RegisterWorkspace — required before Bind/Attach. */
	workspaceId?: string | null;
};

/** Active Project chrome on `project:changed` (null when none). */
export type ProjectState = {
	id?: string;
	path: string;
	status: ProjectStatus;
	cwd?: string;
	error?: string;
	displayName?: string | null;
	/** Slot path-hash after RegisterWorkspace — required before Bind/Attach. */
	workspaceId?: string | null;
} | null;

export type TaskSummary = {
	id: string;
	title: string;
	kind?: 'task' | 'chat';
	sessionId?: string | null;
	active?: boolean;
	/** Per-task run status for chrome indicators (tab strip + sidebar dots). */
	runState?: 'running' | 'completed-unseen' | undefined;
	/** ISO timestamp — sidebar conversation order (newest first). */
	lastModified?: string;
};

/** Main-process wall times for one `task:select` (tab-switch diagnosis). */
export type TaskSelectTrace = {
	/** Total main handler time (resolve → select → publishFocus). */
	mainMs: number;
	/** `sessions.selectTask` only. */
	selectMs: number;
	/** `publishFocusChange` build + IPC send. */
	publishMs: number;
	/** Approx JSON byte size of the `workspace:focus` payload. */
	focusPayloadBytes: number;
};

/** File edit card / Code Changes list row (Bridge write-tool projection). */
export type CodeChange = {
	id: string;
	path: string;
	tool: string;
	status: 'running' | 'done' | 'error';
	diff?: string;
	summary?: string;
};

export type ModelCatalogEntry = {
	id: string;
	display: string;
	aliases: string[];
	current: boolean;
	/** Settings provider row id (`model_provider.id`). Composer groups by this. */
	providerId?: string;
	/** Settings provider display name. */
	providerName?: string;
	/** From models.yaml capability resolve; omit/false → hide Thinking. */
	supportsThinking?: boolean;
	/** Wire effort ladder; empty → hide Effort menu. */
	supportedEfforts?: string[];
	defaultEffort?: string;
};

/** Structured @ mention chip — Submit passthrough (no Mentions.resolve). */
export type MentionChip = {
	kind: string;
	locator: string;
	displayName?: string;
	ref?: string;
	entity?: string;
};

export type QueueItem = {
	id: string;
	text: string;
	/** Chips retained across enqueue → flush. */
	mentions?: MentionChip[];
};

/**
 * Tasks meta for `tasks:changed` pushes — no Transcript body.
 * Body arrives only via `transcript:patched` (live) or `task:list` (cold pull).
 * `activeTaskId` here is the **chrome subject** of this snapshot (whose gate/queue
 * are included), not a focus command — selection is owned only by `workspace:focus`.
 */
/** Slash palette entry from Bridge `commands_available` (skills + dynamic commands). */
export type SlashCatalogEntry = {
	name: string;
	description: string;
	usage?: string;
	available?: boolean;
	availability?: string;
	/** Optional scope / source badge id (`personal` | `builtin` | `project` | unknown passthrough). */
	badge?: string;
};

export type TasksMeta = {
	tasks: TaskSummary[];
	chats: TaskSummary[];
	/** Hidden Default Project tasks for sidebar Tasks. */
	defaultTasks?: TaskSummary[];
	/** True after Meta hydrate for Default Project (empty list counts). */
	defaultTasksHydrated?: boolean;
	activeTaskId: string | null;
	activeKind: 'task' | 'chat' | null;
	gate: ComposerGate;
	model: string;
	modelDisplay: string;
	modelCatalog: ModelCatalogEntry[];
	/** Sticky Composer RunMode for the active Task (survives tab switches). */
	runMode?: 'agent' | 'plan' | 'ask' | 'yolo';
	/** Conversation engine Fast | DSH. */
	engineKind?: 'fast' | 'dsh';
	/** Registry-available engine ids for the Composer picker. */
	availableEngineIds?: string[];
	effort?: string;
	thinking?: boolean;
	/** Skills / dynamic slash targets from Engine Catalog. */
	slashCatalog: SlashCatalogEntry[];
	/** True after first `/skills` round-trip (`commands_available` or `command_result`). */
	slashCatalogHydrated?: boolean;
	queue: QueueItem[];
	queuePaused: boolean;
	/** DSH capability bits — Dock / Goal / steer look only at these, never engineKind. */
	dshCaps?: DshCaps;
	dshQueue?: DshQueueItem[];
	dshGoal?: DshGoalView | null;
	engineStatus?: EngineHostStatus | null;
	engineError?: string | null;
};

export type DshCaps = {
	queue: boolean;
	goal: boolean;
	budget: boolean;
	question: boolean;
	slash: boolean;
};

export type DshQueueItem = {
	id: string;
	placement: 'queued' | 'steering' | 'context';
	text: string;
};

export type DshGoalView = {
	operation: string;
	phase: string;
	title: string;
	text: string;
};

export function dshGoalFromEvent(e: {
	operation: string;
	phase: string;
	title: string;
	text: string;
}): DshGoalView {
	return {operation: e.operation, phase: e.phase, title: e.title, text: e.text};
}

/**
 * ②′ Goal card snapshot for the active Task — mirrors Bridge `goal_updated`.
 * awaiting_confirm → confirm card; started → busy banner; escalated → escalate card;
 * finished → completion card.
 */
export type GoalCardView = {
	goalId: string;
	phase: 'awaiting_confirm' | 'started' | 'paused' | 'escalated' | 'finished';
	status: string;
	/** Short display name (auto from statement at plan). */
	name?: string;
	statement?: string;
	acceptance?: string;
	workflowJson?: string;
	membersJson?: string;
	budgetJson?: string;
	loopAgentId?: string;
	resultSummary?: string;
	escalateActions?: string[];
	reason?: string;
	/** In-flight workflow node ids (parallel DAG cursors). */
	currentStepIds?: string[];
	activeRunIds?: string[];
	progressJson?: string;
	/** `infra` = control unreachable; `decision` = model asked for a human. */
	escalateKind?: 'infra' | 'decision';
};

/** Cold-start / invoke `task:list` — meta + Transcript body for the active Task. */
export type TasksSnapshot = TasksMeta & {
	/** Monotone publisher revision for the included active Task body. */
	bodyRevision?: number;
	transcript: TranscriptEntry[];
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	superseded?: Record<string, string>;
	codeChanges: CodeChange[];
	liveProcs?: LiveProc[];
	liveTasks?: LiveTask[];
	childWork?: LiveChildWork[];
	goalFlow?: GoalFlowView;
	goalCard?: GoalCardView | null;
};

/** Narrow Transcript body patch (ADR-0005 content path). */
export type TranscriptPatch = {
	taskId: string;
	bodyRevision?: number;
	entries: TranscriptEntry[];
	approvals: PendingApproval[];
	questions: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	superseded?: Record<string, string>;
	codeChanges: CodeChange[];
	gate: ComposerGate;
	/** Session-scoped live Procs for Composer drawer. */
	liveProcs?: LiveProc[];
	liveTasks?: LiveTask[];
	childWork?: LiveChildWork[];
	goalFlow?: GoalFlowView;
	goalCard?: GoalCardView | null;
};

/**
 * Incremental content flush (perf doc P0-1): only the changed entry tail crosses
 * IPC instead of the whole Transcript. Optional sections are present only when
 * they changed since the last publish; the renderer keeps its copy otherwise.
 * Full `transcript:patched` remains the snapshot/heal path.
 */
export type TranscriptTailPatch = {
	taskId: string;
	bodyRevision?: number;
	/** Index of the first changed entry; `entries` replaces the local tail from here. */
	from: number;
	/** Authoritative entries.length after the patch — merge sanity check. */
	total: number;
	entries: TranscriptEntry[];
	gate: ComposerGate;
	approvals?: PendingApproval[];
	questions?: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	superseded?: Record<string, string>;
	codeChanges?: CodeChange[];
	liveProcs?: LiveProc[];
	liveTasks?: LiveTask[];
	childWork?: LiveChildWork[];
	goalFlow?: GoalFlowView;
	goalCard?: GoalCardView | null;
};

export type ProjectsSnapshot = {
	projects: ProjectSnapshot[];
	activeProjectId: string | null;
	projectTasks?: Record<string, TaskSummary[]>;
	/** Per-project: Task list known (empty array counts). Absent/false = still loading. */
	projectTasksHydrated?: Record<string, boolean>;
	engineStatus?: EngineHostStatus | null;
	engineError?: string | null;
};

/**
 * Focus Change: one-shot chrome packet (ADR-0005). Slim since perf doc P1-6:
 * Transcript body fields are optional and normally absent — the renderer keeps
 * its per-task cache; cold bodies arrive via `task:list` pull or the next
 * transcript patch. `goalCard` stays (host truth for background goal updates).
 * No projectTasks — sidebar lists stay on projects:changed.
 */
export type WorkspaceFocus = {
	focusEpoch: number;
	projects: ProjectSnapshot[];
	activeProjectId: string | null;
	project: ProjectState;
	engineStatus?: EngineHostStatus | null;
	engineError?: string | null;
	tasks: TaskSummary[];
	chats: TaskSummary[];
	defaultTasks?: TaskSummary[];
	defaultTasksHydrated?: boolean;
	activeTaskId: string | null;
	/** Host body revision; renderer pulls only when its cached revision differs. */
	bodyRevision?: number;
	activeKind: 'task' | 'chat' | null;
	gate: ComposerGate;
	model: string;
	modelDisplay: string;
	modelCatalog: ModelCatalogEntry[];
	runMode?: 'agent' | 'plan' | 'ask' | 'yolo';
	engineKind?: 'fast' | 'dsh';
	/** Registry-available engine ids for the Composer picker. */
	availableEngineIds?: string[];
	effort?: string;
	thinking?: boolean;
	slashCatalog: SlashCatalogEntry[];
	slashCatalogHydrated?: boolean;
	queue: QueueItem[];
	queuePaused: boolean;
	dshCaps?: DshCaps;
	dshQueue?: DshQueueItem[];
	dshGoal?: DshGoalView | null;
	/** Legacy full-body focus — normally absent since P1-6 (renderer cache + pull own the body). */
	transcript?: TranscriptEntry[];
	superseded?: Record<string, string>;
	approvals?: PendingApproval[];
	questions?: PendingQuestion[];
	questionBatches?: PendingQuestionBatch[];
	subagents?: TranscriptSubagent[];
	codeChanges?: CodeChange[];
	liveProcs?: LiveProc[];
	liveTasks?: LiveTask[];
	childWork?: LiveChildWork[];
	goalFlow?: GoalFlowView;
	/** ②′ Goal card for the active Task — host truth on focus (renderer cache is stale across switches). */
	goalCard?: GoalCardView | null;
};

/** @deprecated Prefer WorkspaceFocus (`workspace:focus`). */
export type ProjectsFocus = {
	projects: ProjectSnapshot[];
	activeProjectId: string | null;
	engineStatus?: EngineHostStatus | null;
	engineError?: string | null;
};

export type BridgeEventEnvelope = {
	projectId: string;
	event: BridgeEvent;
};

export type BridgeErrorEnvelope = {
	projectId: string;
	/** Empty string clears sticky banner when no `code` (existing behavior). */
	message: string;
	/** Stable key under `errors.*` — e.g. `session.create_failed` (no `errors.` prefix). */
	code?: string;
	params?: Record<string, string | number>;
};

export type BridgeLogEnvelope = {
	projectId: string;
	message: string;
};

export type BridgeExitEnvelope = {
	projectId: string;
	code: number | null;
	signal: string | null;
};

export type ProjectGetResult = {
	path: string | null;
	projects: ProjectSnapshot[];
	activeProjectId: string | null;
	projectTasks?: Record<string, TaskSummary[]>;
	projectTasksHydrated?: Record<string, boolean>;
	engineStatus?: EngineHostStatus | null;
	engineError?: string | null;
	/** Host unix conn id — ignore `workspace_file_changed` origin=client with this id. */
	bridgeConnectionId?: string | null;
};

export type TaskMutationResult = {
	ok: boolean;
	notice?: string;
};

export type SendMessageResult = {
	ok: boolean;
	notice?: string;
	openModelPicker?: boolean;
};

/** One-shot settle signal for the completion sound (not OS notifications). */
export type CompletionCue = {
	taskId: string;
	success: boolean;
};

