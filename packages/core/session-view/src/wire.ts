/**
 * Desktop Bridge UI wire — single source for IPC data shapes and channel maps.
 * Domain Transcript / Gate types are re-used by name (no *Payload aliases).
 */
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {ComposerGate} from './composerGate.js';
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
} from './transcriptProjection.js';

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

export type GitFileChangeKind = 'modified' | 'added' | 'deleted';

export type GitFileChange = {
	/** Project-relative path with `/` separators. */
	path: string;
	kind: GitFileChangeKind;
};

export type GitStatus = {
	branch: string;
	dirty: boolean;
	/** Working-tree / index changes for file-tree decorations. */
	files: GitFileChange[];
};

export type DirEntry = {
	name: string;
	kind: 'dir' | 'file';
	relativePath: string;
	mtime?: number | null;
};

/** Bridge editor FS failure codes (`command_result.fs.code`). */
export type WorkspaceFsCode =
	| 'outside'
	| 'too-large'
	| 'binary'
	| 'conflict'
	| 'missing'
	| 'no-slot'
	| 'busy'
	| 'is-dir'
	| 'not-found'
	| 'not-dir'
	| 'denied'
	| 'invalid'
	| 'exists';

export type HostDirCode =
	| 'not-found'
	| 'not-dir'
	| 'denied'
	| 'invalid'
	| 'exists'
	| 'unknown-command'
	| 'timeout';

export type HostDirEntry = {
	name: string;
	path: string;
	kind: 'dir' | 'file';
};

export type HostDirResult =
	| {
			ok: true;
			path: string;
			home: string;
			entries: HostDirEntry[];
			truncated?: boolean;
	  }
	| {
			ok: false;
			error: string;
			code?: HostDirCode;
			/** Old engine unknown-command — dialog should drop the tree. Timeout uses `code` only. */
			fallback?: boolean;
			home?: string;
			entries: [];
	  };

export type HostDirCreateResult =
	| {ok: true; path: string; home: string; name: string}
	| {ok: false; error: string; code?: HostDirCode; fallback?: boolean; home?: string};

export type EdgeCapabilities = {
	canOpenLocalFolder: boolean;
	canCreateLocalProject: boolean;
	canOpenRemoteFolder: boolean;
};

export type EdgePublic = {
	id: string;
	name: string;
	ip: string;
	port: number;
};

export type EdgesList = {
	activeId: string;
	pendingEdgeId?: string | null;
	servers: EdgePublic[];
	capabilities: EdgeCapabilities;
	hostHome?: string;
	runActive?: boolean;
};

export type EdgeDetail = EdgePublic & {
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeUpsertInput = {
	id?: string;
	name: string;
	ip: string;
	port: number;
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeTestInput = {
	ip: string;
	port: number;
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeFailure = {
	ok: false;
	code: string;
	message: string;
	fingerprint?: string;
	display?: string;
};

export type EdgeOk = {ok: true; fingerprint?: string};

export type EdgeSelectResult = EdgeOk | EdgeFailure;
export type EdgeTestResult = EdgeOk | EdgeFailure;

/** Pairing export for the mobile app (S7.2): LAN WebSocket URL + token. */
export type MobilePairingInfo = {
	/** False when the bridge is off (`FAST_MOBILE_BRIDGE=0`) or not started. */
	available: boolean;
	host: string;
	port: number;
	/** `ws://<host>:<port>/bridge` */
	serverUrl: string;
	token: string;
};
export type EdgeDeleteResult = EdgeOk | EdgeFailure;
export type EdgeUpsertResult = {ok: true; id: string} | EdgeFailure;

export type ListWorkspaceDirResult =
	| {
			ok: true;
			relativePath: string;
			entries: DirEntry[];
			/** Host capped the listing (default 5000); tree shows a hint. */
			truncated?: boolean;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
			entries: [];
	  };

/** @deprecated Prefer ListWorkspaceDirResult — alias kept for transitional imports. */
export type ListDirResult = ListWorkspaceDirResult;

export type GetWorkspaceFileResult =
	| {
			ok: true;
			relativePath: string;
			content: string;
			mtime: number;
			bytes?: number;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
	  };

/** @deprecated Prefer GetWorkspaceFileResult. */
export type ReadFileResult = GetWorkspaceFileResult;

export type SaveWorkspaceFileResult =
	| {
			ok: true;
			relativePath?: string;
			mtime: number;
			bytes: number;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
			/** Disk mtime cursor after conflict (must replace the tab's savedMtimeMs). */
			mtime?: number;
	  };

export type ReadMediaResult =
	| {
			ok: true;
			relativePath: string;
			mimeType: string;
			dataUrl: string;
	  }
	| {
			ok: false;
			error: string;
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

/** Renderer ← main push channels. */
export type PushChannels = {
	'projects:changed': ProjectsSnapshot;
	'workspace:focus': WorkspaceFocus;
	'project:changed': ProjectState;
	'tasks:changed': TasksMeta;
	'transcript:patched': TranscriptPatch;
	'transcript:tailPatched': TranscriptTailPatch;
	'bridge:event': BridgeEventEnvelope;
	'bridge:error': BridgeErrorEnvelope;
	'bridge:log': BridgeLogEnvelope;
	'bridge:exit': BridgeExitEnvelope;
	/** Cold-start landing gate: Meta applied; shell may mount. */
	'workspace:restored': Record<string, never>;
	/** Cold-start landing gate: timeout / spawn failure; shell mounts with Engine error. */
	'workspace:restoreFailed': {reason: string};
	/** Settings-center namespace changed (PatchSettings) — renderer invalidates useSettings. */
	'settings:changed': {scope: string; scopeId: string; namespace: string};
	/** Model provider row changed — renderer invalidates useProviders. */
	'providers:changed': {providerId: string};
	/** Skill package changed — renderer invalidates useSkills. */
	'skills:changed': {skillName: string};
	/** L0 engine sidecar install log line. */
	'engines:installLog': {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number};
	/** Agent turn / Goal settled — renderer may play the completion chime. */
	'completion:cue': CompletionCue;
	/** Remote edge catalog / active / pending changed. */
	'edges:changed': EdgesList;
};

/** One-shot settle signal for the completion sound (not OS notifications). */
export type CompletionCue = {
	taskId: string;
	success: boolean;
};

/** Teams UI row — ListTeams / CreateTeam / UpdateTeam / GetTeam / Archive*. */
export type TeamRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	workspaceId?: string | null;
	originGoalId?: string | null;
	verifierAgentId?: string | null;
	defaultWorkflowSpec?: string | null;
	description?: string | null;
	members?: Array<{name: string; teamRole: string; agentId: string}>;
	createdAt?: string | null;
};

/** Agents UI row — ListAgents / CreateAgent / UpdateAgent / GetAgent / CloneAgent / Archive*. */
export type AgentRow = {
	id: string;
	name: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	teamId?: string | null;
	teamRole?: string | null;
	model?: string | null;
	taskBrief?: string | null;
	declarationJson?: string | null;
	latestRunId?: string | null;
	createdAt?: string | null;
};

export type AmbientRule = {
	id: string;
	scope: string;
	projectId?: string | null;
	text: string;
	enabled: boolean;
	createdAt?: string | null;
};

/** One settings namespace document (GetSettings / PatchSettings; settings-center-storage.md). */
export type SettingsDoc = {
	scope: string;
	scopeId: string;
	namespace: string;
	payload: unknown;
	schemaVersion: number;
	updatedAt?: string | null;
	/** Only on scope=effective reads: global | project | merged. */
	source?: string | null;
};

export type SettingsScope = 'global' | 'project' | 'effective';

/** Model row inside a provider's models_json (ListProviders DTO). */
export type ProviderModel = {
	modelId: string;
	displayName: string;
	aliases?: string[];
	supportsThinking?: boolean;
	supportedEfforts?: string[];
	defaultEffort?: string;
	maxTokens?: number;
	enabled: boolean;
	source: string;
};

/** Settings-center provider row — never includes ciphertext (List/Upsert/…Provider). */
export type ProviderRow = {
	id: string;
	kind: string;
	vendor: string;
	name: string;
	baseUrl?: string | null;
	status?: string | null;
	statusDetail?: string | null;
	last4?: string | null;
	modelCount: number;
	enabledModelCount: number;
	enabled: boolean;
	meta?: unknown;
	models?: ProviderModel[];
	updatedAt?: string | null;
};

/** OpenRouter (etc.) search candidate (SearchProviderModels). */
export type SearchModelRow = {
	modelId: string;
	displayName: string;
	contextLength?: number | null;
	vendorHint?: string | null;
};

/** UpsertProvider host args (presetKey seeds catalog; seedModels for custom). */
export type UpsertProviderInput = {
	name: string;
	id?: string;
	presetKey?: string;
	baseUrl?: string;
	kind?: string;
	metaJson?: string;
	credential?: string;
	seedModelsJson?: string;
};

/** PatchProviderModels op — enable / rename / add / remove. */
export type ProviderModelPatch = {
	op: 'enable' | 'rename' | 'add' | 'remove' | string;
	modelId: string;
	enabled?: boolean;
	displayName?: string;
	aliases?: string[];
	supportsThinking?: boolean;
	supportedEfforts?: string[];
	defaultEffort?: string;
};

/** Settings-center installed skill row (List/Create/SetSkillEnabled). */
export type SkillRow = {
	name: string;
	description: string;
	scope: string;
	source: string;
	marketId?: string | null;
	enabled: boolean;
	location?: string | null;
	dirName?: string | null;
};

/** Skills.sh market search row (SearchSkillMarket). */
export type MarketSkillRow = {
	id: string;
	skillId: string;
	name: string;
	source: string;
	installs: number;
	isInstalled: boolean;
	description?: string;
	author?: string;
};

/** CreateSkill host args. */
export type CreateSkillInput = {
	name: string;
	scope: string;
	template?: string;
};

/** How the daemon recorded a path's move; `renamed` rows carry both paths as one decision. */
export type ReviewKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** Where a change stands. Only `pending` is still the user's to decide. */
export type ReviewChangeState = {
	kind: 'pending' | 'reverted' | 'kept' | 'conflict';
	/** Why an undo cannot run cleanly — shown as-is; the daemon writes it for a reader. */
	reason?: string;
};

/**
 * One side of a diff, or `null` when the path did not exist there.
 *
 * `omitted` is not a rendering hint: `missing` means the store no longer has the bytes, so this path
 * cannot be undone either, and the UI has to say that rather than keep offering a diff.
 */
export type ReviewSide = {
	id: string;
	text?: string;
	bytes?: number;
	omitted?: 'binary' | 'too-large' | 'missing';
} | null;

/** A review row without its file contents — what the drawer lists. */
export type ReviewChange = {
	id: string;
	checkpointId: string;
	path: string;
	kind: ReviewKind;
	state: ReviewChangeState;
	groupId?: string | null;
};

/** One row plus the three sides a diff needs, fetched only for the file being looked at. */
export type ReviewChangeDetail = ReviewChange & {
	before: ReviewSide;
	after: ReviewSide;
	/** What is on disk now — differs from `after` once the user has edited on top. */
	current: ReviewSide;
};

/**
 * A planned undo, before anything is written.
 *
 * The three path lists are the whole point of the two-phase shape: `forcePaths` needs a second
 * confirmation, `excludedPaths` cannot be undone at all, and `mergedPaths` will fold in edits made
 * after the agent's rather than discard them.
 */
export type ReviewPreview = {
	id: string;
	revision: number;
	target: {kind: 'timeline' | 'whole' | 'pending' | 'changes'; checkpointId?: string | null};
	changes: Array<{path: string; kind: ReviewKind; previousPath?: string | null}>;
	conflicts: Array<{path: string; reason: string}>;
	excludedPaths: string[];
	forcePaths: string[];
	mergedPaths: string[];
	/**
	 * Background commands still running in this checkout. Restoring rewrites files underneath them, so
	 * the user is warned before confirming; it never blocks the undo.
	 */
	activeShells?: string[];
};

export type ReviewRestored = {restoreId: string; revision: number};

/**
 * The review list for one checkout.
 *
 * `revision` is passed back on every decision so the daemon can refuse one made against a list that
 * has since moved; `available: false` means checkpoints are off and nothing here can be undone.
 */
export type ReviewList = {
	revision: number;
	changes: ReviewChange[];
	available: boolean;
	/**
	 * Where each checkpoint sits in the conversation, so a transcript row can offer "restore to this
	 * message". Matched by `runId`, which is what a transcript row is keyed by.
	 */
	checkpoints?: ReviewAnchor[];
};

export type ReviewAnchor = {
	id: string;
	runId: string;
	messageId?: string | null;
	/** Epoch millis the checkpoint was opened. */
	at: number;
};

/** A refusal the client can act on: resync to `revision`, or re-preview after `movedPaths`. */
export type ReviewRefusal = {
	ok: false;
	notice: string;
	revision?: number;
	conflicts?: Array<{path: string; reason: string}>;
	movedPaths?: string[];
	/** Checkpoints are off; retrying will not help. */
	unavailable?: boolean;
	/** The snapshot is gone: this restore point is expired and must stop being offered. */
	expired?: boolean;
};

/** One line of a server-computed hunk; `kind` is `context`, `add` or `del`. */
export type HunkLine = {
	kind: 'context' | 'add' | 'del';
	oldLine?: number | null;
	newLine?: number | null;
	text: string;
};

/**
 * A git-style hunk over one file's net agent effect. `oldStart`/`oldLines` address the before
 * snapshot, `newStart`/`newLines` the after snapshot — the coordinates a unified diff header would
 * carry, so an editor can place overlays without re-deriving anything.
 */
export type DiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: HunkLine[];
};

/**
 * The whole-file agent effect for one path, computed by the daemon (review-diff-batch-hunks §三).
 *
 * `broken` means the blob chain could not be validated — show a notice, never a plausible-looking
 * wrong diff. `blocked` carries the reason no hunks were produced (too large, not text).
 */
export type FileReviewDiff = {
	path: string;
	changeIds: string[];
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
	afterBlobId?: string | null;
	broken: boolean;
	blocked?: string | null;
};

/** One checkout's batched review diff at a revision. */
export type ReviewDiffSnapshot = {
	revision: number;
	files: FileReviewDiff[];
	/** Paths to drop from the previous snapshot; only set when `partial` is true. */
	removedPaths?: string[];
	/**
	 * When true, `files` is a delta against the snapshot the client already holds: merge, then
	 * drop `removedPaths`. When false or omitted, replace the whole map.
	 */
	partial?: boolean;
};

export type EngineWireRow = {
	id: string;
	kind: 'builtin' | 'extension';
	adapter: 'ready' | 'disabled' | 'failed';
	program: 'builtin' | 'installed' | 'missing' | 'installing';
	process: 'none' | 'stopped' | 'running';
	processDetail?: string;
	isDefault: boolean;
	inRegistry: boolean;
	actions: string[];
	installLog?: Array<{stream: 'stdout' | 'stderr'; text: string; seq: number}>;
};

/** Renderer → main invoke channels. */
export type InvokeChannels = {
	'workspace:checkRestore': {
		args: [];
		result: {done: boolean; failed: boolean; reason?: string};
	};
	'project:open': {args: []; result: string | null};
	'project:openRemote': {args: [path: string]; result: string | null};
	'project:createBlank': {args: [name?: string]; result: string | null};
	'project:get': {args: []; result: ProjectGetResult};
	'project:gitStatus': {args: [force?: boolean]; result: GitStatus | null};
	'project:focus': {args: [projectId: string]; result: boolean};
	'project:close': {args: [projectId: string]; result: boolean};
	'project:showInFolder': {args: [projectId: string]; result: boolean};
	'task:showProjectInFolder': {args: [taskId: string]; result: boolean};
	/** Files pane menu — reveal a workspace-relative entry in the OS file manager. */
	'workspace:showInFolder': {args: [relativePath: string]; result: boolean};
	listWorkspaceDir: {args: [relativePath?: string]; result: ListWorkspaceDirResult};
	'host:listDir': {args: [path?: string]; result: HostDirResult};
	'host:createDir': {args: [parent: string, name: string]; result: HostDirCreateResult};
	'edges:list': {args: []; result: EdgesList};
	'edges:get': {args: [id: string]; result: EdgeDetail | null};
	'edges:upsert': {args: [input: EdgeUpsertInput]; result: EdgeUpsertResult};
	'edges:delete': {args: [id: string]; result: EdgeDeleteResult};
	'edges:select': {args: [id: string]; result: EdgeSelectResult};
	'edges:test': {args: [input: EdgeTestInput]; result: EdgeTestResult};
	/** Mobile bridge pairing export — LAN address + token for the phone to scan. */
	'mobile:pairingInfo': {args: []; result: MobilePairingInfo};
	getWorkspaceFile: {args: [relativePath: string]; result: GetWorkspaceFileResult};
	saveWorkspaceFile: {
		args: [relativePath: string, content: string, mtime?: number, bytes?: number];
		result: SaveWorkspaceFileResult;
	};
	'fs:readMedia': {args: [relativePath: string]; result: ReadMediaResult};
	'task:create': {
		args: [title?: string, projectId?: string];
		result: TaskSummary | null;
	};
	'chat:create': {args: [title?: string]; result: TaskSummary | null};
	'pet:getVisible': {args: []; result: boolean};
	'pet:setVisible': {args: [visible: boolean]; result: boolean};
	/** OS locale tag from Electron `app.getLocale()`. */
	'locale:getSystem': {args: []; result: string};
	/** Apply locale preference in main (tray / pet menus). */
	'locale:set': {args: [payload: {pref: string}]; result: boolean};
	'task:select': {
		args: [taskId: string, focusEpoch?: number];
		result: (TaskSummary & {trace?: TaskSelectTrace}) | null;
	};
	/** Open Tab working-set Bind+Attach without changing focus (option B). */
	'task:ensureLive': {
		args: [taskIds: string[]];
		result: {ok: string[]; skipped: string[]};
	};
	/** LivingTask rail: focus open Project by Meta id + select by Engine sessionId. */
	'task:openLiving': {
		args: [sessionId: string, metaProjectId?: string | null];
		result:
			| {ok: true; taskId: string; title: string; kind?: string; sessionId?: string | null}
			| {ok: false; notice: string};
	};
	'task:rename': {args: [taskId: string, title: string]; result: TaskMutationResult};
	/** Soft-delete Session (`UpdateSessionStatus` deleted) or discard unbound create. */
	'task:delete': {
		args: [taskId: string, sessionId?: string | null];
		result: TaskMutationResult;
	};
	'task:send': {
		args: [text: string, mentions?: MentionChip[], expectedTaskId?: string | null];
		result: SendMessageResult;
	};
	/** UI Build → PlanBuild (plan_build user + Build Dock). */
	'task:buildPlan': {args: [planId: string, name?: string]; result: SendMessageResult};
	/** Debounced Mentions prefix suggest (Bridge MentionSuggest). */
	'mention:suggest': {
		args: [prefix: string, requestId: string, kinds?: string[]];
		result: boolean;
	};
	'task:list': {args: []; result: TasksSnapshot};
	'task:approve': {
		args: [approvalId: string, approved: boolean, reason?: string];
		result: boolean;
	};
	/** ②′ Goal card actions — the only Goal gate surface. Optional goalId for LivingTask rail. */
	'goal:confirm': {args: [patchJson?: string]; result: boolean};
	'goal:pause': {args: [goalId?: string]; result: boolean};
	'goal:cancel': {args: [goalId?: string]; result: boolean};
	'goal:resume': {args: [goalId?: string]; result: boolean};
	'goal:steer': {args: [note: string, goalId?: string]; result: boolean};
	'goal:escalate': {args: [action: 'resume' | 'fail']; result: boolean};
	'goal:dismiss': {args: []; result: boolean};
	'task:answer': {args: [questionId: string, answer: string]; result: boolean};
	'task:answerBatch': {
		args: [
			rpcId: string,
			payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
		];
		result: boolean;
	};
	'task:cancel': {args: [reason?: string]; result: boolean};
	'task:rerun': {args: [runId: string]; result: boolean};
	'task:killProc': {args: [procId: string, reason?: string, sessionId?: string]; result: boolean};
	'task:requestOlderHistory': {args: []; result: boolean};
	'model:list': {args: []; result: boolean};
	'model:select': {args: [modelId: string]; result: boolean};
	'mode:set': {args: [mode: string, expectedTaskId?: string | null]; result: boolean};
	'engineKind:set': {args: [kind: string, expectedTaskId?: string | null]; result: boolean};
	'model:settings': {
		args: [
			settings: {
				platform: string;
				model: string;
				effort?: string;
				thinking?: boolean;
			}
		];
		result: boolean;
	};
	/** Refresh slash Skills via Bridge `/skills` (silent list → `commands_available`). */
	'slash:list': {args: []; result: boolean};
	'queue:remove': {args: [itemId: string]; result: boolean};
	'queue:clear': {args: []; result: boolean};
	'queue:reorder': {args: [fromIndex: number, toIndex: number]; result: boolean};
	'queue:edit': {args: [itemId: string, text: string]; result: boolean};
	'queue:pause': {args: [paused: boolean]; result: boolean};
	'queue:interrupt': {args: [itemId: string]; result: boolean};
	'dsh:steer': {args: [text: string]; result: boolean};
	'dshGoal:act': {args: [action: 'pause' | 'resume' | 'complete' | 'clear']; result: boolean};
	/** Re-start Engine after restore failure or disconnect (in-shell Retry). */
	'engine:retry': {args: []; result: boolean};
	/** Unix dead-letter ring + parse failure counts for the About diagnostics copy. */
	'engine:diagnostics': {
		args: [];
		result: {parseFailures: number; deadLetters: readonly string[]};
	};
	/** Persist Project display name via Bridge SetProjectDisplayName. */
	'project:rename': {args: [projectId: string, displayName: string]; result: TaskMutationResult};
	/** Ambient Rules (Meta) for Context pane. */
	'rules:list': {
		args: [projectId: string];
		result: {ok: true; rules: AmbientRule[]; replace: true} | {ok: false; notice: string};
	};
	'rules:add': {
		args: [projectId: string, text: string];
		result:
			| {ok: true; rules: AmbientRule[]; replace: boolean}
			| {ok: false; notice: string};
	};
	'rules:remove': {
		args: [projectId: string, ruleId: string];
		result: TaskMutationResult;
	};
	/** Settings-center documents (Engine DB via Bridge). */
	'settings:get': {
		args: [scope: SettingsScope, scopeId?: string];
		result: {ok: true; settings: SettingsDoc[]} | {ok: false; notice: string};
	};
	'settings:patch': {
		args: [scope: 'global' | 'project', namespace: string, patch: unknown, scopeId?: string];
		result: {ok: true; setting: SettingsDoc} | {ok: false; notice: string};
	};
	/** Settings-center model providers (Engine Meta via Bridge). */
	'providers:list': {
		args: [];
		result: {ok: true; providers: ProviderRow[]} | {ok: false; notice: string};
	};
	'providers:upsert': {
		args: [input: UpsertProviderInput];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:delete': {
		args: [id: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'providers:setEnabled': {
		args: [id: string, enabled: boolean];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:test': {
		args: [id: string];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:patchModels': {
		args: [id: string, patch: ProviderModelPatch[]];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:searchModels': {
		args: [id: string, query: string];
		result: {ok: true; searchModels: SearchModelRow[]} | {ok: false; notice: string};
	};
	/** Settings-center skills (disk SoT + Skills.sh market via Bridge). */
	'skills:list': {
		args: [];
		result: {ok: true; skills: SkillRow[]} | {ok: false; notice: string};
	};
	'skills:create': {
		args: [input: CreateSkillInput];
		result: {ok: true; skill: SkillRow} | {ok: false; notice: string};
	};
	'skills:delete': {
		args: [name: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'skills:setEnabled': {
		args: [name: string, scope: string, enabled: boolean];
		result: {ok: true; skill: SkillRow} | {ok: false; notice: string};
	};
	'skills:searchMarket': {
		args: [query: string];
		result:
			| {ok: true; marketSkills: MarketSkillRow[]; message?: string}
			| {ok: false; notice: string};
	};
	'skills:installMarket': {
		args: [source: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'skills:uninstallMarket': {
		args: [name: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	/** Extension admin (settings write; host principal). */
	'extensions:list': {
		args: [];
		result:
			| {
					ok: true;
					extensions: Array<{
						id: string;
						phase: 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';
						hotUnload: boolean;
						fault?: string;
						restartHint?: string;
					}>;
					ledger: Array<{id: string; mark: string}>;
			  }
			| {ok: false; notice: string};
	};
	'extensions:status': {
		args: [id: string];
		result:
			| {
					ok: true;
					extension: {
						id: string;
						phase: 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';
						hotUnload: boolean;
						fault?: string;
						restartHint?: string;
					} | null;
			  }
			| {ok: false; notice: string};
	};
	'extensions:install': {
		args: [dir: string];
		result: {ok: true; id: string} | {ok: false; notice: string};
	};
	'extensions:uninstall': {
		args: [id: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'extensions:pickDir': {
		args: [];
		result: string | null;
	};
	'engines:list': {
		args: [];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:enable': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:disable': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:start': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:stop': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:setDefault': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:install': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:uninstall': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:cancelInstall': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'rules:setEnabled': {
		args: [projectId: string, ruleId: string, enabled: boolean];
		result: TaskMutationResult;
	};
	'schedule:list': {
		/** Omit projectId for cross-project ScheduledJob list. */
		args: [projectId?: string | null];
		result:
			| {
					ok: true;
					jobs: Array<{
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						projectDisplayName?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	'schedule:listLiving': {
		args: [];
		result:
			| {
					ok: true;
					projects: Array<{projectId: string; displayName?: string; sessions?: unknown[]}>;
			  }
			| {ok: false; notice: string};
	};
	'schedule:pause': {args: [id: string]; result: TaskMutationResult};
	'schedule:resume': {args: [id: string]; result: TaskMutationResult};
	'schedule:cancel': {args: [id: string]; result: TaskMutationResult};
	'schedule:fireNow': {args: [id: string]; result: TaskMutationResult};
	'schedule:updateCron': {
		args: [id: string, cronExpr: string, timezone?: string];
		result: TaskMutationResult;
	};
	'schedule:listRuns': {
		args: [id: string];
		result:
			| {
					ok: true;
					runs: Array<{
						id: string;
						jobId: string;
						sessionId: string;
						status: string;
						startedAt?: string | null;
						finishedAt?: string | null;
						summary?: string | null;
						error?: string | null;
						runId?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	/**
	 * Create ScheduledJob (Teams Schedule→Goal template, etc.).
	 * projectId = folder id (Hub maps Meta); sessionId required for session_loop;
	 * platform may omit sessionId (Meta mints automation) but needs projectId.
	 */
	'schedule:create': {
		args: [
			input: {
				kind: string;
				cronExpr: string;
				timezone?: string;
				recurring?: boolean;
				targetKind: string;
				targetRef?: string;
				promptText?: string;
				targetArgsJson?: string;
				maxFires?: number;
				title?: string;
				fireImmediately?: boolean;
				sessionId?: string;
				projectId?: string;
			}
		];
		result:
			| {
					ok: true;
					job: {
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						projectDisplayName?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
	/** Teams UI — omit projectId for cross-project lists. */
	'teams:list': {
		args: [projectId?: string | null];
		result: {ok: true; teams: TeamRow[]} | {ok: false; notice: string};
	};
	'teams:listGoals': {
		args: [projectId?: string | null, status?: string | null];
		result:
			| {
					ok: true;
					goals: Array<{
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						acceptance?: string | null;
						originSessionId?: string | null;
						controlSessionId?: string | null;
						teamId?: string | null;
						projectId?: string | null;
						projectDisplayName?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						/** @deprecated wire dual-read — prefer currentStepIds */
						currentStepId?: string | string[] | null;
						/** @deprecated wire dual-read — prefer activeRunIds */
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
						createdAt?: string | null;
						resultSummary?: string | null;
						escalateActions?: string[];
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						loopAgentId?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	'teams:listAgents': {
		args: [projectId?: string | null, opts?: {includeArchived?: boolean}];
		result: {ok: true; agents: AgentRow[]} | {ok: false; notice: string};
	};
	'teams:getGoal': {
		args: [goalId: string];
		result:
			| {
					ok: true;
					goal: {
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						projectId?: string | null;
						projectDisplayName?: string | null;
						teamId?: string | null;
						originSessionId?: string | null;
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						/** @deprecated wire dual-read — prefer currentStepIds */
						currentStepId?: string | string[] | null;
						/** @deprecated wire dual-read — prefer activeRunIds */
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
	/** Teams CRUD — args match Bridge CreateTeam / UpdateTeam fields (projectId = folder id; Hub maps Meta). */
	'teams:create': {
		args: [
			input: {
				name: string;
				projectId: string;
				description?: string;
				workspaceId?: string;
				members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			}
		];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:update': {
		args: [
			input: {
				teamId: string;
				name?: string;
				description?: string;
				members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			}
		];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:archive': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:unarchive': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:get': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:createAgent': {
		args: [
			input: {
				name: string;
				projectId: string;
				model?: string;
				teamRole?: string;
				teamId?: string;
				taskBrief?: string;
			}
		];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:updateAgent': {
		args: [
			input: {
				agentId: string;
				name?: string;
				model?: string;
				teamRole?: string;
				teamId?: string;
				taskBrief?: string;
				systemPrompt?: string;
				maxTurns?: number;
			}
		];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:archiveAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:unarchiveAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:cloneAgent': {
		args: [input: {sourceId: string; teamId: string; name?: string}];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:getAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:delete': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:saveAs': {
		args: [input: {sourceTeamId: string; name?: string}];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:promote': {
		args: [input: {teamId: string; name?: string}];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:deleteAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:stopAgentRun': {
		args: [agentId: string];
		result: {ok: true; notice?: string} | {ok: false; notice: string};
	};
	/**
	 * Agent change review for one Project's checkout. Every channel names the Project rather than a
	 * path, so the renderer cannot ask the daemon to write outside it.
	 */
	'review:list': {
		args: [projectId: string, checkpointId?: string | null, sessionId?: string | null];
		result: {ok: true; list: ReviewList} | ReviewRefusal;
	};
	/** File contents for one row — kept off the list so blobs load only for the file being viewed. */
	'review:change': {
		args: [projectId: string, changeId: string];
		result: {ok: true; change: ReviewChangeDetail} | ReviewRefusal;
	};
	/**
	 * The whole pending agent effect in one answer: per path, hunks of first.before → last.after.
	 * One round trip replaces the per-row detail storm the card stream used to make.
	 */
	'review:diff': {
		args: [projectId: string, sinceRevision?: number];
		result: {ok: true; diff: ReviewDiffSnapshot} | ReviewRefusal;
	};
	/**
	 * One path's net effect with the batch hunk-line cap lifted (too-many-changes fallback).
	 * The path selects among this checkout's undecided review rows.
	 */
	'review:fileDiff': {
		args: [projectId: string, path: string];
		result: {ok: true; file: FileReviewDiff} | ReviewRefusal;
	};
	/** Accept the agent's edits. `revision` is the list the user decided against. */
	'review:keep': {
		args: [projectId: string, changeIds: string[], revision: number];
		result: {ok: true} | ReviewRefusal;
	};
	/** Plan an undo. Writes nothing, so it is safe to call to populate a confirmation. */
	'review:preview': {
		args: [
			projectId: string,
			input: {
				target: 'timeline' | 'whole' | 'pending' | 'changes';
				revision: number;
				checkpointId?: string;
				changeIds?: string[];
			}
		];
		result: {ok: true; preview: ReviewPreview} | ReviewRefusal;
	};
	/** Write a plan. `force` overwrites exactly the paths the preview listed in `forcePaths`. */
	'review:apply': {
		args: [projectId: string, previewId: string, force?: boolean];
		result: {ok: true; restored: ReviewRestored} | ReviewRefusal;
	};
	/** Put back what an undo took away. */
	'review:redo': {
		args: [projectId: string, restoreId: string];
		result: {ok: true; restored: ReviewRestored} | ReviewRefusal;
	};
	'teams:deleteGoal': {
		args: [goalId: string];
		result:
			| {
					ok: true;
					goal: {
						id: string;
						status: string;
						name?: string | null;
						projectId?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
	/** Generic DSH unary hop. Error keeps DSH `{ code, message, ... }`. */
	'dsh:call': {
		args: [method: string, payload?: Record<string, unknown>, sessionId?: string];
		result: DshCallResult;
	};
	'dsh:models': {
		args: [sessionId?: string];
		result: DshModelsResult;
	};
	'dsh:selectModel': {
		args: [input: DshSelection & {sessionId?: string}];
		result: DshCallResult;
	};
	'dsh:skills': {
		args: [sessionId: string];
		result: DshSkillsResult;
	};
	'dsh:settings': {
		args: [op: DshSettingsOp];
		result: DshCallResult;
	};
};

export type DshError = {
	code: string;
	message?: string;
	[key: string]: unknown;
};

export type DshCallResult =
	| {ok: true; method: string; value: unknown}
	| {ok: false; error: DshError};

export type DshSelection = {
	provider: string;
	model: string;
	reasoningEffort?: string;
};

export type DshModelGroup = {
	id: string;
	name: string;
	models: Array<{
		id: string;
		name: string;
		description?: string;
		reasoning?: {efforts: Array<{id: string; name: string; description?: string}>; defaultEffort?: string};
	}>;
};

export type DshModelFailure = {id: string; name: string; message: string};

export type DshModelsValue = {
	current: DshSelection;
	routable: boolean;
	groups: DshModelGroup[];
	failures: DshModelFailure[];
};

export type DshModelsResult = {ok: true; value: DshModelsValue} | {ok: false; error: DshError};

export type DshSkillsResult = {ok: true; value: SlashCatalogEntry[]} | {ok: false; error: DshError};

export type DshSettingsPathOp =
	| {op: 'set'; path: string[]; value: unknown}
	| {op: 'unset'; path: string[]};

/** Settings-page facade ops. Method names live only in `bridge/dsh/settings.ts`. */
export type DshSettingsOp =
	| {op: 'describe'}
	| {op: 'update'; ns: string; patch: Record<string, unknown>; expectedRevision?: number}
	| {op: 'mutate'; ns: string; ops: DshSettingsPathOp[]; expectedRevision?: number}
	| {op: 'replace'; ns: string; section: Record<string, unknown>; expectedRevision?: number}
	| {op: 'openDocument'}
	| {op: 'credentialsDescribe'; refs: string[]}
	| {op: 'credentialsSet'; ref: string; value: string}
	| {op: 'credentialsUnset'; ref: string}
	| {op: 'llmModels'}
	| {op: 'llmProviders'}
	| {op: 'llmDiscoverModels'; input: Record<string, unknown>}
	| {op: 'agentPresetList'}
	| {op: 'agentPresetSelect'; sessionId: string; agentPreset: string}
	| {op: 'agentPresetRead'; agentPreset: string}
	| {op: 'agentPresetCopy'; from: string; agentPreset: string; name?: string}
	| {op: 'agentPresetOpenDocument'; agentPreset: string}
	| {op: 'agentPresetRemove'; agentPreset: string}
	| {op: 'sessionList'}
	| {op: 'pluginInventoryList'};

export type PushChannel = keyof PushChannels;
export type InvokeChannel = keyof InvokeChannels;

export type UiSend = <C extends PushChannel>(channel: C, payload: PushChannels[C]) => void;

export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];
