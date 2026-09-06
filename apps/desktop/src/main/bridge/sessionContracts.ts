import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {pickIdList} from '@fastllm/bridge-protocol';
import type {MentionChip} from '@fast-ide/session-view';
import {
	composerGate,
	goalKeepsBusy,
	type CodeChangesState,
	type CompletionCue,
	type ComposerGate,
	type DshCaps,
	type DshGoalView,
	type DshQueueItem,
	type GoalCardView,
	type QueueItem,
	type SlashCatalogEntry,
	type TranscriptState
} from '@fast-ide/session-view';
import type {ModelCatalogEntry} from './modelCatalog.js';

export type HostEventSinkResult = {stop: true; task: TaskRecord | null} | {stop: false};

export type TaskRecord = {
	id: string;
	title: string;
	kind: 'task' | 'chat';
	sessionId: string | null;
	/**
	 * Conversation recency (ISO). Advances on send / newer Meta `updatedAt`.
	 * Renderer sidebar sorts project tasks by this (desc); projects stay name-sorted.
	 */
	lastModified?: string;
	/**
	 * Frozen create / first-hydrate key. Host `listTasks` still sorts by this
	 * (desc) so a New row cannot drop when Engine Instant looks older.
	 */
	listOrder: number;
	lastEventSeq: number;
	transcript: TranscriptState;
	codeChanges: CodeChangesState;
	pendingNew: boolean;
	pendingAttach: boolean;
	/**
	 * True once CreateSession was sent for this optimistic row.
	 * Prevents CreateProject/Register `retryPendingNew` from double-firing CreateSession
	 * (second accepted → Hub「创建失败」while the first session already chats).
	 */
	createRequested: boolean;
	/** UI-only: New control sets this; cleared on input_accepted or successful rename. */
	autoTitlePending: boolean;
	queue: QueueItem[];
	queuePaused: boolean;
	dshCaps?: DshCaps;
	dshQueue?: DshQueueItem[];
	dshGoal?: DshGoalView;
	/** Last selected model for this Task (IDE chrome; survives tab switches). */
	model: string;
	modelDisplay: string;
	/** Sticky Composer Mode / sampling (IDE chrome; mirrors session sticky). */
	runMode: 'agent' | 'plan' | 'ask' | 'yolo';
	/** Conversation engine: Fast (default) or DSH. */
	engineKind: 'fast' | 'dsh';
	effort?: string;
	thinking?: boolean;
	/**
	 * ②′ Goal card — driven only by Bridge `goal_updated` pushes:
	 * awaiting_confirm → confirm card; started → busy banner;
	 * escalated → escalate card; finished → completion card.
	 */
	goalCard?: GoalCardView;
};

/** Keep previous when both next plural and singular are nullish. */
export function mergeIdList(
	prev: string[] | undefined,
	plural?: string | string[] | null,
	singular?: string | string[] | null
): string[] | undefined {
	if (plural == null && singular == null) return prev;
	return pickIdList(plural, singular);
}

export type SessionListInfo = {
	id: string;
	title?: string | null;
	summary?: string | null;
	lastModified: string;
	messageCount: number;
	cwd?: string | null;
	isCurrent?: boolean | null;
	/** Sticky session.run_mode from Engine sessions_list. */
	runMode?: string | null;
	/** Sticky session.engine_kind from Engine sessions_list (`dsh` or omitted). */
	engineKind?: string | null;
	/** Sticky session.model_settings from Engine sessions_list. */
	modelSettings?: {
		platform: string;
		model: string;
		effort?: string;
		thinking?: boolean;
	} | null;
};

/** Map a RerunRun rejection detail to a stable error code (renderer i18n key suffix). */
export function rerunErrorCode(message?: string): string {
	const detail = (message ?? '').trim();
	if (detail.includes('rerun_target_active')) return 'rerun.target_active';
	if (detail.includes('session_busy')) return 'rerun.session_busy';
	if (detail.includes('rerun_target_stale')) return 'rerun.target_stale';
	if (detail.includes('rerun_unsupported')) return 'rerun.unsupported';
	return 'rerun.rejected';
}

export type SessionControllerDeps = {
	clientId: string;
	send: (command: BridgeCommand) => boolean;
	now?: () => number;
	createId?: () => string;
	/** Fired when transcript/queue locks change outside Bridge events (e.g. cancel timeout). */
	onChange?: () => void;
	/** Client-side Cancel Settlement watchdog; must be ≥ Engine hard timeout. */
	cancelSettlementTimeoutMs?: number;
	/** Host lease scan period. `0` disables the interval (tests call `tickRunLeases`). */
	leaseScanIntervalMs?: number;
	/** Registered workspace hash for BindSessionWorkspace (slot / I/O). */
	workspaceId?: () => string | undefined;
	/** Meta project id for CreateSession (sidebar identity). */
	projectId?: () => string | undefined;
	/** Ask Hub to RegisterWorkspace when slot is needed for I/O. */
	requestRegister?: () => void;
	/**
	 * Host disk L0 for slash menu when Bridge `/skills` is slow/unavailable.
	 * Bridge `commands_available` merges with Host disk skills (Bridge wins on same name).
	 */
	discoverHostSkills?: () => SlashCatalogEntry[];
};

export function taskRunActive(task: TaskRecord): boolean {
	return (
		composerGate(task.transcript, false).runState !== 'idle' || goalKeepsBusy(task.goalCard)
	);
}

/** IPC / user-intent facet (index.ts). */
export type AnswerBatchPayload =
	| {answers: Array<{id: string; selected: string[]; custom?: string}>}
	| {cancelled: true};

/** IPC / user-intent facet (index.ts). */
export type TaskCommands = {
	createTask(title: string): TaskRecord;
	createChat(title: string): TaskRecord;
	selectTask(taskId: string): TaskRecord | null;
	renameTask(taskId: string, title: string): boolean;
	/** Soft-delete Session (`UpdateSessionStatus` deleted) or discard unbound optimistic create. */
	deleteTask(taskId: string): Promise<{ok: boolean; notice?: string}>;
	sendMessage(
		text: string,
		mentions?: MentionChip[],
		expectedTaskId?: string | null
	): boolean;
	/** UI Build → PlanBuild Submit (`message_type=plan_build`). */
	buildPlan(planId: string, name?: string): boolean;
	/** Bridge MentionSuggest — results via mention_suggestions event. */
	requestMentionSuggest(prefix: string, requestId: string, kinds?: string[]): boolean;
	requestModelList(): boolean;
	/** Replace Composer catalog with Settings enabled models (not Engine /model yaml). */
	applyProviderCatalog(entries: ModelCatalogEntry[]): void;
	/** Silent `/skills` → fill `slashCatalog` from `commands_available`. */
	requestSlashCatalog(): boolean;
	selectModel(modelId: string): boolean;
	/** Sticky RunMode via Bridge SetMode (agent/plan/ask/yolo). */
	setRunMode(mode: string, expectedTaskId?: string | null): boolean;
	/** Sticky engine Fast | DSH via SetEngineKind (existing session) or CreateSession (new). */
	setEngineKind(kind: string, expectedTaskId?: string | null): boolean;
	/** Sticky model_settings (platform/model/effort/thinking). */
	setModelSettings(settings: {
		platform: string;
		model: string;
		effort?: string;
		thinking?: boolean;
	}): boolean;
	removeQueueItem(itemId: string): boolean;
	clearQueue(): boolean;
	reorderQueue(fromIndex: number, toIndex: number): boolean;
	editQueueItem(itemId: string, text: string): boolean;
	setQueuePaused(paused: boolean): boolean;
	/** Queue row「插话」→ InterruptWithMessage (+ remove item). */
	interruptQueueItem(itemId: string): boolean;
	dshSteer(text: string): boolean;
	dshGoalAct(action: 'pause' | 'resume' | 'complete' | 'clear'): boolean;
	decideApproval(approvalId: string, approved: boolean, reason?: string): boolean;
	answerQuestion(questionId: string, answer: string): boolean;
	answerQuestionBatch(rpcId: string, payload: AnswerBatchPayload): boolean;
	/** ②′ card actions — the only Goal gate surface (chat text is never intercepted). */
	confirmGoal(patchJson?: string): boolean;
	/** Optional goalId for LivingTask rail (cross-session); omit = active Goal card. */
	pauseGoal(goalId?: string): boolean;
	cancelGoal(goalId?: string): boolean;
	resumeGoal(goalId?: string): boolean;
	steerGoal(note: string, goalId?: string): boolean;
	escalateGoal(action: 'resume' | 'fail'): boolean;
	dismissGoalCard(): boolean;
	cancelRun(reason?: string): boolean;
	rerunRun(runId: string): boolean;
	killProc(procId: string, reason?: string, sessionId?: string): boolean;
	requestOlderHistory(): boolean;
	consumeHelpNotice(): string | null;
	consumeCompletionCue(): CompletionCue | null;
	consumeOpenModelPicker(): boolean;
};

/** Bridge lifecycle facet (WorkspaceHub). */
export type SessionLifecycle = {
	handleEvent(event: BridgeEvent): TaskRecord | null;
	hydrateFromSessionsList(sessions: SessionListInfo[]): void;
	/**
	 * @param engineBoundHash Path-hash from CreateSession/NewSession command_result when
	 *   Engine already bound in adoptCreatedSession — skip redundant Bind.
	 */
	acceptNewSession(sessionId: string, taskId: string, engineBoundHash?: string): TaskRecord | null;
	/** Remove unbound optimistic create row (create fail / missing correlation). */
	failPendingCreate(taskId?: string): boolean;
	retryPendingNew(): boolean;
	requestSessionsList(): boolean;
	hydrateFromMeta(sessions: Array<{id: string; title?: string | null; status?: string}>): void;
	markEngineLost(reason: string, opts?: {failTurns?: boolean}): void;
	detachAll(): void;
	tickHeartbeat(): boolean;
	isAttached(sessionId: string): boolean;
	isRunActive(): boolean;
	selectTask(taskId: string): TaskRecord | null;
	/**
	 * Bind+Attach without requiring Open Tab focus (option B).
	 * `focus: true` matches selectTask (chrome + activeTaskId).
	 */
	ensureLive(taskId: string, opts?: {focus?: boolean}): TaskRecord | null;
	/** Re-Attach every live session (terminal parse-fail / lease expiry reconcile). */
	resyncAttached(): void;
	/** Host-level notice (protocol mismatch, etc.) shown via consumeHelpNotice. */
	noteHelp(notice: string): void;
	/** Scan lease-aware runs: TTL → Attach reconcile → local settle. */
	tickRunLeases(): void;
	getActiveTask(): TaskRecord | null;
	listTasks(): TaskRecord[];
	listChats(): TaskRecord[];
};

/** Read-only snapshot facet (UI Publisher). */
export type TaskView = {
	/** True after at least one sessions_list hydrate (empty list counts). */
	readonly tasksHydrated: boolean;
	model: string;
	modelDisplay: string;
	runMode: 'agent' | 'plan' | 'ask' | 'yolo';
	engineKind: 'fast' | 'dsh';
	availableEngineIds(): string[];
	effort?: string;
	thinking?: boolean;
	modelCatalog: ModelCatalogEntry[];
	slashCatalog: SlashCatalogEntry[];
	readonly slashCatalogHydrated: boolean;
	listTasks(): TaskRecord[];
	listChats(): TaskRecord[];
	getActiveTask(): TaskRecord | null;
	/** Chrome indicator status — per-task, derived from session state. */
	taskRunState(taskId: string): 'running' | 'completed-unseen' | null;
	gate(): ComposerGate;
};

