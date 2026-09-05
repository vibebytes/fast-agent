import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {pickIdList, wireIdList} from '@fastllm/bridge-protocol';
import type {MentionChip} from '@fast-ide/session-view';
import {
	applyBridgeEvent,
	applyLeaseExpiry,
	applyLocalCancel,
	awaitingConfirmPlan,
	CANCEL_SETTLEMENT_TIMEOUT_MS,
	composerGate,
	createLeaseWatch,
	createTranscriptState,
	emptySessionSeq,
	goalFlowSeed,
	goalKeepsBusy,
	hasLocalRun,
	offer,
	paintAwaitingConfirm,
	seqTerminal,
	oldestLoadedTurnId,
	shouldSoundOnSettle,
	queueClearCommands,
	queueEditCommands,
	queuePauseCommand,
	queueRemoveCommands,
	queueReorderCommands,
	queueSteerPlan,
	type ComposerGate,
	type CompletionCue,
	type LeaseWatchHandle,
	type DshCaps,
	type DshGoalView,
	type DshQueueItem,
	type GoalCardView,
	type QueueItem,
	type SessionSeq,
	type SlashCatalogEntry,
	type TranscriptEntry,
	type TranscriptState,
	chromeAwaitingSettlement,
	chromePostRun,
	chromeRunId,
	runChromeTransition
} from '@fast-ide/session-view';
import {
	applyCodeChangeEvent,
	createCodeChangesState,
	createComposerSend,
	createTaskLifecycle,
	parseEngineKind,
	type CodeChangesState
} from '@fast-ide/session-view';
import {
	concreteModelDisplay,
	isPlaceholderModelDisplay,
	isUnresolvedModelDisplay,
	wireUseModel
} from '../../shared/defaultModel.js';
import {matchCatalogEntry} from '../../shared/modelMatch.js';
import {parseModelCatalog, resolveComposerChrome, type ModelCatalogEntry} from './modelCatalog.js';
import {isSessionStreamEvent, sessionIdFromEvent} from './sessionStreamEvents.js';
import {normalizeSlashBadge} from './hostSkillDiscovery.js';
import {hostT} from './hostT.js';
import {resolveSlashRoute} from './slashRoute.js';
import {promptLine} from './dsh/skills.js';
import {randomUUID} from 'node:crypto';

export {CANCEL_SETTLEMENT_TIMEOUT_MS} from '@fast-ide/session-view';
export type {ComposerGate, QueueItem, SlashCatalogEntry} from '@fast-ide/session-view';

function modelEntryMatches(entry: ModelCatalogEntry, id: string): boolean {
	return matchCatalogEntry(entry, id);
}

function parseMentionsJson(raw: string): MentionChip[] {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((m): m is Record<string, unknown> => m != null && typeof m === 'object')
			.map(m => ({
				kind: String(m.kind ?? ''),
				locator: String(m.locator ?? ''),
				...(typeof m.displayName === 'string' ? {displayName: m.displayName} : {}),
				...(typeof m.ref === 'string' ? {ref: m.ref} : {}),
				...(typeof m.entity === 'string' ? {entity: m.entity} : {})
			}))
			.filter(m => m.kind.length > 0 && m.locator.length > 0);
	} catch (err) {
		console.error('[follow_up_changed] bad mentionsJson', err);
		return [];
	}
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

export {pickIdList, wireIdList};

/** Keep previous when both next plural and singular are nullish. */
function mergeIdList(
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

function sessionDisplayTitle(info: SessionListInfo, fallback = 'Main'): string {
	const titled = info.title?.trim() || info.summary?.trim();
	if (titled) return titled;
	if (info.isCurrent) return fallback;
	return info.id.length > 8 ? info.id.slice(0, 8) : info.id;
}

/** Map a RerunRun rejection detail to a stable error code (renderer i18n key suffix). */
export function rerunErrorCode(message?: string): string {
	const detail = (message ?? '').trim();
	if (detail.includes('rerun_target_active')) return 'rerun.target_active';
	if (detail.includes('session_busy')) return 'rerun.session_busy';
	if (detail.includes('rerun_target_stale')) return 'rerun.target_stale';
	if (detail.includes('rerun_unsupported')) return 'rerun.unsupported';
	return 'rerun.rejected';
}

function parseRunMode(raw?: string | null): TaskRecord['runMode'] {
	const m = (raw ?? '').trim().toLowerCase();
	if (m === 'plan' || m === 'ask' || m === 'yolo' || m === 'agent') return m;
	if (m === 'normal') return 'agent';
	return 'agent';
}

export {isPlaceholderModelDisplay, isUnresolvedModelDisplay} from '../../shared/defaultModel.js';

/** Prefer Engine displayName; never invent the yaml `default` alias label. */
function resolvedModelDisplay(model: string, modelDisplay: string | undefined): string {
	return concreteModelDisplay(model, modelDisplay);
}

/** Apply Engine sticky when present; omit effort/thinking → keep prior Task chrome. */
function applyStickyChrome(
	task: TaskRecord,
	info: {
		runMode?: string;
		engineKind?: string | null;
		modelSettings?: SessionListInfo['modelSettings'];
	}
): void {
	if (info.runMode != null && info.runMode !== '') {
		task.runMode = parseRunMode(info.runMode);
	}
	if (info.engineKind != null && info.engineKind !== '') {
		task.engineKind = parseEngineKind(info.engineKind);
	}
	const ms = info.modelSettings;
	if (!ms) return;
	task.model = `${ms.platform}/${ms.model}`;
	// Match Engine catalog / LLMModelLookup.displayName shape (platform/model), not bare alias.
	task.modelDisplay = `${ms.platform}/${ms.model}`;
	if (ms.effort) task.effort = ms.effort;
	if (ms.thinking !== undefined) task.thinking = ms.thinking;
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

function taskRunActive(task: TaskRecord): boolean {
	return (
		composerGate(task.transcript, false).runState !== 'idle' || goalKeepsBusy(task.goalCard)
	);
}

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
	answerQuestionBatch(
		rpcId: string,
		payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
	): boolean;
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

export class SessionController implements TaskCommands, SessionLifecycle, TaskView {
	private readonly clientId: string;
	private readonly sendFn: (command: BridgeCommand) => boolean;
	private readonly now: () => number;
	private readonly createId: () => string;
	private readonly onChange?: () => void;
	private readonly cancelSettlementTimeoutMs: number;
	private readonly leaseScanIntervalMs: number;
	private readonly workspaceId?: () => string | undefined;
	private readonly projectId?: () => string | undefined;
	private readonly requestRegister?: () => void;
	/** Contiguous applied cursor + pending, keyed by sessionId. */
	private seqBySession = new Map<string, SessionSeq>();
	private activeTaskId: string | null = null;
	/** Multi-Attach: Sessions kept live after select/create (ADR-0010 extend). */
	private attachedSessionIds = new Set<string>();
	/** Sessions that received at least one `session_restored` (empty turns still count). */
	private restoredSessionIds = new Set<string>();

	model = 'default';
	/** Concrete catalog label from ListProviders — empty until the DB catalog arrives. */
	modelDisplay = '';
	runMode: 'agent' | 'plan' | 'ask' | 'yolo' = 'agent';
	engineKind: 'fast' | 'dsh' = 'fast';
	private availableIds = new Set<string>(['fast']);
	effort?: string;
	thinking?: boolean;
	modelCatalog: ModelCatalogEntry[] = [];
	slashCatalog: SlashCatalogEntry[] = [];
	/** True after first `/skills` response (empty catalog still counts). */
	slashCatalogHydrated = false;
	/** Set after hydrateFromSessionsList (empty list counts). */
	tasksHydrated = false;
	private awaitingModelList = false;
	/** True once Hub applied ListProviders catalog — ignore yaml /model dumps. */
	private catalogFromProviders = false;
	/** True once Bridge `commands_available` arrived (non-empty); Host disk skills are merged in. */
	private bridgeSlashCatalog = false;
	private readonly discoverHostSkills?: () => SlashCatalogEntry[];
	private helpNotice: string | null = null;
	private pendingCompletionCue: CompletionCue | null = null;
	/**
	 * Task create/rename/delete lifecycle + command_result settlement. The deep
	 * module owns the task map; the Host mints rows (buildTaskEntry) and keeps
	 * only its own chrome/watchdog state.
	 */
	private readonly lifecycle = createTaskLifecycle<TaskRecord>({
		createId: () => this.createId(),
		now: () => this.now(),
		send: cmd => this.sendFn(cmd),
		projectId: () => this.projectId?.(),
		workspaceId: () => this.workspaceId?.(),
		requestRegister: () => this.requestRegister?.(),
		requestAttach: (task, sessionId, attempt) => {
			this.requestAttach(task, sessionId, attempt);
		},
		selectTask: taskId => this.selectTask(taskId),
		getActiveTask: () => this.getActiveTask(),
		getActiveTaskId: () => this.activeTaskId,
		setActiveTaskId: taskId => {
			this.activeTaskId = taskId;
		},
		setActiveEngineKind: k => {
			this.engineKind = k;
		},
		setHelpNotice: notice => {
			this.helpNotice = notice;
		},
		onChange: () => this.onChange?.(),
		taskBySessionId: sid => this.taskBySessionId(sid),
		taskRunActive: task => taskRunActive(task),
		cancelRunForTask: (task, reason) => {
			this.cancelRunForTask(task, reason);
		},
		forgetTask: taskId => this.leaseWatch.forgetTask(taskId),
		attachedSessionIds: this.attachedSessionIds,
		seqBySession: this.seqBySession,
		buildEntry: (id, kind, title, listOrder) => this.buildTaskEntry(id, kind, title, listOrder)
	});

	/** Per-task Cancel Settlement watchdogs — switching tabs must not disarm others. */
	private leaseWatch!: LeaseWatchHandle;

	private get tasks(): Map<string, TaskRecord> {
		return this.lifecycle.tasks;
	}
	/**
	 * Sessions for which this controller sent `generateTitle: true` and is waiting
	 * for `input_accepted` before clearing `autoTitlePending`.
	 */
	private titleGenRequested = new Set<string>();
	/** Composer send channel — SubmitUserMessage sampling + slash + pinned `command` + `/skills` FIFO. */
	private readonly composer = createComposerSend<TaskRecord>({
		createId: () => this.createId(),
		now: () => this.now(),
		send: cmd => this.sendFn(cmd),
		getActiveTask: () => this.getActiveTask(),
		commandSessionId: () => this.commandSessionId(),
		canSubmitNow: () => this.canSubmitNow(),
		canSubmitCommand: () => this.canSubmitCommand(),
		describeSendBlocker: () => this.describeSendBlocker(),
		engineKind: () => this.engineKind,
		promptLine: (name, args) => promptLine(name, args),
		selectModel: id => this.selectModel(id),
		requestModelList: () => this.requestModelList(),
		setHelpNotice: notice => {
			this.helpNotice = notice;
		},
		applyRunMode: mode => this.applyRunMode(mode),
		effort: () => this.effort,
		onClearSlash: () => {
			const task = this.getActiveTask();
			if (!task) return false;
			task.transcript = createTranscriptState();
			task.codeChanges = createCodeChangesState();
			this.tasks.set(task.id, task);
			if (task.sessionId && this.attachedSessionIds.has(task.sessionId)) {
				this.composer.sendPinnedCommand('clear', '', task.sessionId);
			}
			return true;
		},
		touchLastModified: task => this.touchLastModified(task),
		useModelOf: (model, modelDisplay) => wireUseModel(model ?? '', modelDisplay ?? ''),
		catalogHas: ref => this.catalogHas(ref ?? ''),
		submitThinking: () => this.submitThinking(),
		titleGenRequested: this.titleGenRequested,
		seedHostSlashCatalog: () => this.seedHostSlashCatalog(),
		slashCatalogLive: () => this.bridgeSlashCatalog && this.slashCatalog.length > 0,
		applyEmptySlashCatalog: () => this.applyEmptySlashCatalog(),
		markSlashCatalogHydrated: () => {
			this.slashCatalogHydrated = true;
		},
		appendSkillsTranscript: message => {
			const task = this.getActiveTask();
			if (!task) return;
			task.transcript = {
				...task.transcript,
				entries: [
					...task.transcript.entries,
					{id: this.createId(), role: 'assistant', text: message, status: 'done'}
				]
			};
			this.tasks.set(task.id, task);
		}
	});
	/** Single-flight FetchSessionHistory per attached Session (ADR-0012). */
	private historyInFlightSessionId: string | null = null;

	/** UI should open model popover after silent catalog fetch. */
	consumeOpenModelPicker(): boolean {
		return this.composer.takeOpenModelPicker();
	}

	constructor(deps: SessionControllerDeps) {
		this.clientId = deps.clientId;
		this.sendFn = deps.send;
		this.now = deps.now ?? (() => Date.now());
		this.createId = deps.createId ?? (() => randomUUID());
		this.onChange = deps.onChange;
		this.cancelSettlementTimeoutMs =
			deps.cancelSettlementTimeoutMs ?? CANCEL_SETTLEMENT_TIMEOUT_MS;
		this.leaseScanIntervalMs = deps.leaseScanIntervalMs ?? 2_000;
		this.workspaceId = deps.workspaceId;
		this.projectId = deps.projectId;
		this.requestRegister = deps.requestRegister;
		this.discoverHostSkills = deps.discoverHostSkills;
		this.leaseWatch = createLeaseWatch<TaskRecord>({
			now: () => this.now(),
			scanIntervalMs: this.leaseScanIntervalMs,
			cancelSettleTimeoutMs: this.cancelSettlementTimeoutMs,
			tasks: () => this.tasks.values(),
			busy: task => hasLocalRun(task.transcript) || goalKeepsBusy(task.goalCard),
			sessionIdOf: task => task.sessionId,
			onReconcile: task => {
				if (task.sessionId) this.requestAttach(task, task.sessionId, task.lastEventSeq);
			},
			onExpire: task => this.settleExpiredLease(task),
			cancelSettleDue: taskId => this.forceCancelSettlement('client settlement timeout', taskId),
			onChange: () => this.onChange?.()
		});
	}

	/** Forward to composer send module (skills slash hydration owns state). */
	requestSlashCatalog(): boolean {
		return this.composer.requestSlashCatalog();
	}

	/** Seed composer menu from disk when Bridge catalog has not arrived yet. */
	seedHostSlashCatalog(): boolean {
		// After a non-empty Bridge catalog, Host is merged on each commands_available.
		// Still allow Host backfill if the in-memory catalog was wiped empty.
		if (this.bridgeSlashCatalog && this.slashCatalog.length > 0) return false;
		const host = (this.discoverHostSkills?.() ?? [])
			.filter(e => !PRODUCT_CODING_SKILL_NAMES.has(e.name.toLowerCase()))
			.map(withNormalizedBadge);
		if (host.length === 0) return false;
		this.slashCatalog = host;
		this.slashCatalogHydrated = true;
		this.onChange?.();
		return true;
	}

	/** DSH Caps: empty Bridge catalog clears slash. Fast: keep Host disk seed. */
	private applyEmptySlashCatalog(): void {
		if (this.getActiveTask()?.dshCaps?.slash) return;
		if (this.engineKind === 'dsh') return;
		this.seedHostSlashCatalog();
	}

	getAttachedSessionId(): string | null {
		const active = this.getActiveTask();
		if (active?.sessionId && this.attachedSessionIds.has(active.sessionId)) {
			return active.sessionId;
		}
		return null;
	}

	isAttached(sessionId: string): boolean {
		return this.attachedSessionIds.has(sessionId);
	}

	attachedSessionIdList(): string[] {
		return [...this.attachedSessionIds];
	}

	/**
	 * Engine host crashed/exited: fail any in-flight turn visibly (no silent resume).
	 * Unix lease drop (`failTurns: false`) only clears Attach so the next Hello
	 * re-Attaches — host is still running the turn.
	 */
	markEngineLost(reason: string, opts?: {failTurns?: boolean}): void {
		this.leaseWatch.clearAllCancelSettle();
		this.rejectPendingDeletes(reason);
		const failTurns = opts?.failTurns ?? true;
		for (const task of this.tasks.values()) {
			if (
				failTurns &&
				(chromeRunId(task.transcript.chrome) ||
					chromeAwaitingSettlement(task.transcript.chrome) ||
					task.transcript.entries.some(e => e.status === 'streaming'))
			) {
				const cancelled = applyLocalCancel(task.transcript);
				task.transcript = {
					...cancelled,
					chrome: runChromeTransition(cancelled.chrome, {run: 'clear', postRun: true, awaiting: 'clear'}),
					entries: cancelled.entries.map(entry => {
						if (entry.role !== 'assistant' || entry.status !== 'cancelled') return entry;
						return {
							...entry,
							status: 'error' as const,
							text: entry.text || reason
						};
					})
				};
			}
			task.pendingAttach = false;
			this.tasks.set(task.id, task);
		}
		this.attachedSessionIds.clear();
		this.restoredSessionIds.clear();
		this.leaseWatch.clearLeaseBookkeeping();
		this.onChange?.();
	}

	listTasks(): TaskRecord[] {
		return [...this.tasks.values()]
			.filter(t => t.kind === 'task')
			.sort((a, b) => b.listOrder - a.listOrder);
	}

	listChats(): TaskRecord[] {
		return [...this.tasks.values()].filter(t => t.kind === 'chat');
	}

	getActiveTask(): TaskRecord | null {
		return this.activeTaskId ? this.tasks.get(this.activeTaskId) ?? null : null;
	}

	/** Chrome indicator for the task list — reads the task's session state. */
	taskRunState(taskId: string): 'running' | 'completed-unseen' | null {
		const t = this.tasks.get(taskId);
		if (!t || t.kind === 'chat') return null;
		const gate = composerGate(t.transcript, false);
		if (gate.runState === 'running') return 'running';
		return null;
	}

	hasPendingPrompts(): boolean {
		const task = this.getActiveTask();
		if (!task) return false;
		return (
			task.transcript.approvals.length > 0 ||
			task.transcript.questions.length > 0 ||
			task.transcript.questionBatches.length > 0
		);
	}

	/** Host-folded attach readiness — not prompt lock (Composer Gate owns that). */
	sessionReady(): boolean {
		const task = this.getActiveTask();
		return Boolean(
			task &&
			task.sessionId &&
			!task.pendingNew &&
			!task.pendingAttach &&
			this.attachedSessionIds.has(task.sessionId)
		);
	}

	gate(): ComposerGate {
		const task = this.getActiveTask();
		if (!task) return composerGate(createTranscriptState(), false);
		const base = composerGate(task.transcript, this.sessionReady());
		// Goal track Busy A′: paint running chrome; allow composer submit as steer (not CancelRun).
		// Esc remains off (canCancel=false); the composer Stop action uses CancelGoal.
		if (goalKeepsBusy(task.goalCard) && base.runState === 'idle' && !base.composerLocked) {
			return {
				...base,
				runState: 'running',
				canSubmitNow: true,
				canEnqueue: false,
				canCancel: false
			};
		}
		return base;
	}

	isRunActive(): boolean {
		return this.gate().runState !== 'idle';
	}

	canSendMessage(): boolean {
		const g = this.gate();
		return g.canSubmitNow || g.canEnqueue;
	}

	/** Direct submit only when idle; otherwise use enqueue. */
	canSubmitNow(): boolean {
		return this.gate().canSubmitNow;
	}

	canEnqueue(): boolean {
		return this.gate().canEnqueue;
	}

	createTask(title: string): TaskRecord {
		return this.lifecycle.createTask(title);
	}

	createChat(title: string): TaskRecord {
		return this.lifecycle.createChat(title);
	}

	/**
	 * Rename Task/Chat display title on Engine Session.
	 * Requires sessionId (pendingNew Tasks cannot rename yet).
	 */
	renameTask(taskId: string, title: string): boolean {
		return this.lifecycle.renameTask(taskId, title);
	}

	/**
	 * Soft-delete Engine Session, or discard an unbound optimistic create.
	 * Resolves after accepted/error `UpdateSessionStatus` (or immediately for pending create).
	 */
	deleteTask(taskId: string): Promise<{ok: boolean; notice?: string}> {
		return this.lifecycle.deleteTask(taskId);
	}

	/** Cancel a specific Task's Associated work (active Task optional). */
	private cancelRunForTask(task: TaskRecord, reason: string): boolean {
		if (!task.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const streaming = task.transcript.entries.some(e => e.status === 'streaming');
		const runId = chromeRunId(task.transcript.chrome);
		if (
			!runId &&
			!streaming &&
			!chromeAwaitingSettlement(task.transcript.chrome) &&
			!goalKeepsBusy(task.goalCard)
		) {
			return false;
		}

		task.transcript = applyLocalCancel(task.transcript);
		this.tasks.set(task.id, task);
		this.leaseWatch.armCancelSettle(task.id);
		return this.sendFn({
			type: 'CancelAssociated',
			sessionId: task.sessionId,
			reason
		});
	}

	/**
	 * Mint a fresh optimistic Task/Chat row (session-view supplies map insert,
	 * focus and CreateSession send; the Host keeps only row construction).
	 */
	private buildTaskEntry(
		id: string,
		kind: 'task' | 'chat',
		title: string,
		listOrder: number
	): TaskRecord {
		return {
			id,
			title,
			kind,
			sessionId: null,
			listOrder,
			lastModified: new Date(listOrder).toISOString(),
			lastEventSeq: 0,
			transcript: createTranscriptState(),
			codeChanges: createCodeChangesState(),
			pendingNew: true,
			pendingAttach: false,
			createRequested: false,
			autoTitlePending: true,
			queue: [],
			queuePaused: false,
			model: this.model,
			modelDisplay: this.modelDisplay,
			runMode: this.runMode,
			engineKind: this.engineKind,
			...(this.effort ? {effort: this.effort} : {}),
			...(this.thinking !== undefined ? {thinking: this.thinking} : {})
		};
	}

	/**
	 * Sole SessionBind authority: CreateSession / NewSession command_result.
	 * `taskId` must match the local optimistic Task row exactly.
	 * When Engine already bound to the project path-hash, Attach only — Bind would
	 * re-run ensureCodingProjectFull + Meta + ensureAsync on every New Task.
	 */
	acceptNewSession(sessionId: string, taskId: string, engineBoundHash?: string): TaskRecord | null {
		return this.lifecycle.acceptNewSession(sessionId, taskId, engineBoundHash);
	}

	/** Drop unbound optimistic create; optionally by taskId, else the sole unbound pending. */
	failPendingCreate(taskId?: string): boolean {
		return this.lifecycle.failPendingCreate(taskId);
	}

	/** Re-send CreateSession for a pending create once projectId is known. */
	retryPendingNew(): boolean {
		return this.lifecycle.retryPendingNew();
	}

	private restoreChromeFromTask(task: TaskRecord): void {
		// Tasks minted before Hello ready keep the "Default" stub. Heal the label only when
		// this Task is still on the same unresolved model key — never steal another Task's model.
		const sameKey =
			task.model === this.model ||
			(isPlaceholderModelDisplay(task.model) && isPlaceholderModelDisplay(this.model));
		if (
			sameKey &&
			isUnresolvedModelDisplay(task.modelDisplay) &&
			!isUnresolvedModelDisplay(this.modelDisplay)
		) {
			task.modelDisplay = this.modelDisplay;
			if (isPlaceholderModelDisplay(task.model)) task.model = this.model;
			this.tasks.set(task.id, task);
		}
		this.model = task.model;
		this.modelDisplay = task.modelDisplay;
		this.runMode = task.runMode ?? 'agent';
		this.engineKind = task.engineKind ?? 'fast';
		this.effort = task.effort;
		this.thinking = task.thinking;
	}

	/**
	 * Open Tab / Register reconcile: Bind+Attach a Task's Session.
	 * Default `focus: false` does not move activeTaskId (background Open Tabs).
	 * Close Tab still does not Detach (option B) — this only (re)claims slot I/O.
	 */
	ensureLive(taskId: string, opts?: {focus?: boolean}): TaskRecord | null {
		const focus = opts?.focus ?? false;
		const task = this.tasks.get(taskId);
		if (!task) return null;
		if (focus) {
			this.activeTaskId = taskId;
			this.restoreChromeFromTask(task);
			// Re-arm watchdog when returning to a task still awaiting Cancel Settlement.
			this.leaseWatch.syncCancelSettle(task);
		}
		// Pending create — optional focus only; Bind/Attach wait until sessionId exists.
		if (!task.sessionId) return task;
		const workspaceId = this.workspaceId?.();
		if (!workspaceId) {
			// Never Attach before Bind — Engine would pin Sessions to boot cwd
			// ($HOME/fast_workspace). Open Tab reconcile retries after Register.
			this.requestRegister?.();
			return task;
		}
		// Already bound + restored — nothing to do (focus already applied above).
		if (
			this.attachedSessionIds.has(task.sessionId) &&
			this.restoredSessionIds.has(task.sessionId)
		) {
			return task;
		}
		// Background ensureLive: already Attach'd — skip; focus path may re-Attach
		// when session_restored never arrived (same as legacy selectTask).
		if (this.attachedSessionIds.has(task.sessionId) && !focus) {
			return task;
		}
		this.sendFn({
			type: 'BindSessionWorkspace',
			sessionId: task.sessionId,
			workspaceId
		});
		this.requestAttach(task, task.sessionId, task.lastEventSeq);
		return task;
	}

	selectTask(taskId: string): TaskRecord | null {
		return this.ensureLive(taskId, {focus: true});
	}

	sendMessage(
		text: string,
		mentions?: MentionChip[],
		expectedTaskId?: string | null
	): boolean {
		const active = this.getActiveTask();
		if (
			expectedTaskId &&
			active?.id !== expectedTaskId &&
			active?.sessionId !== expectedTaskId
		) {
			this.helpNotice = 'errors.send.task_changed';
			return false;
		}
		const trimmed = text.trim();
		if (!trimmed) {
			this.helpNotice = 'errors.send.empty_message';
			return false;
		}

		const chips = mentions && mentions.length > 0 ? mentions : undefined;
		const routed = resolveSlashRoute(trimmed, this.availableSkillNames());
		const busyFollowUp =
			this.canEnqueue() ||
			(goalKeepsBusy(this.getActiveTask()?.goalCard) && !this.chatTurnActive());

		if (routed.kind === 'slash') {
			const line = `/${routed.name}${routed.args ? ` ${routed.args}` : ''}`;
			// Busy skill: Bridge SkillSlash → Session Follow-up (preserves skillSlash payload).
			return this.composer.handleSlash(line);
		}

		// S2/E4: busy (Chat or Goal) → SubmitUserMessage; Session Follow-up queues.
		// SteerGoal is Goal-drawer「捎话」only — never main Enter.
		if (busyFollowUp) {
			return this.composer.submitUserText(routed.text, chips);
		}

		if (!this.canSubmitNow()) {
			this.helpNotice = this.describeSendBlocker();
			return false;
		}
		return this.composer.submitUserText(routed.text, chips);
	}

	requestMentionSuggest(prefix: string, requestId: string, kinds?: string[]): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		return this.sendFn({
			type: 'MentionSuggest',
			sessionId: task.sessionId,
			prefix,
			requestId,
			...(kinds && kinds.length > 0 ? {kinds} : {}),
			limit: 20
		});
	}

	/** True while a Chat turn owns the transcript (not Goal-track-only busy). */
	private chatTurnActive(): boolean {
		const task = this.getActiveTask();
		if (!task) return false;
		return composerGate(task.transcript, false).runState !== 'idle';
	}

	/** Catalog + host-seed skill names eligible for SkillSlash (excludes available:false). */
	private availableSkillNames(): string[] {
		const fromCatalog = this.slashCatalog
			.filter(e => e.available !== false)
			.map(e => e.name);
		const fromHost = (this.discoverHostSkills?.() ?? [])
			.filter(e => e.available !== false)
			.map(e => e.name);
		return [...fromCatalog, ...fromHost];
	}

	private describeSendBlocker(): string {
		const task = this.getActiveTask();
		if (!task) return 'errors.send.no_active_task';
		if (task.pendingNew || !task.sessionId) {
			return 'errors.send.session_starting';
		}
		if (task.pendingAttach || !this.attachedSessionIds.has(task.sessionId)) {
			return 'errors.send.session_not_ready';
		}
		const g = this.gate();
		if (g.composerLocked) {
			return 'errors.send.composer_locked';
		}
		if (g.runState === 'stopping' || g.runState === 'running') {
			return 'errors.send.turn_running';
		}
		return 'errors.send.workspace_not_ready';
	}

	/** Match Composer chrome: supportsThinking models default thinking On when sticky unset. */
	private submitThinking(): boolean | undefined {
		if (this.thinking !== undefined) return this.thinking;
		const entry = this.modelCatalog.find(e => modelEntryMatches(e, this.model));
		if (entry?.supportsThinking) return true;
		return undefined;
	}

	buildPlan(planId: string, name = ''): boolean {
		const id = planId.trim();
		if (!id) {
			this.helpNotice = 'errors.build.missing_plan_id';
			return false;
		}
		if (!this.canSubmitNow()) {
			this.helpNotice = this.describeSendBlocker();
			return false;
		}
		return this.composer.submitUserText('', undefined, {planId: id, name: name.trim()});
	}

	/** Error-card Retry. Engine stops leftover work in the session, then replays lastSubmit. */
	rerunRun(runId: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) {
			this.helpNotice = 'errors.send.session_not_ready';
			return false;
		}
		return this.sendFn({type: 'RerunRun', sessionId: task.sessionId, runId});
	}

	/** Bump conversation recency without moving frozen `listOrder`. */
	private touchLastModified(task: TaskRecord): void {
		task.lastModified = new Date(this.now()).toISOString();
		this.tasks.set(task.id, task);
	}

	private canSubmitCommand(): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId) return false;
		return this.attachedSessionIds.has(task.sessionId);
	}

	/** sessionId for Bridge `{type:command}` (catalog refresh + SkillSlash). */
	private commandSessionId(): string | undefined {
		const task = this.getActiveTask();
		if (task?.sessionId && this.attachedSessionIds.has(task.sessionId)) {
			return task.sessionId;
		}
		// Prefer any attached session so silent `/skills` still pins a workspace.
		for (const id of this.attachedSessionIds) return id;
		return task?.sessionId ?? undefined;
	}

	/**
	 * Host menu can list disk skills while an old Engine still returns bare
	 * `Unknown command` (no SkillSlash detail). Only then hint about a stale Engine.
	 * Messages with `(…)` already include loadL1 / SkillSlash errors — leave them alone.
	 */
	private enrichSkillCommandError(commandName: string | undefined, message: string): string {
		const name = (commandName ?? '').trim();
		if (!name || name === 'skill_view' || name === 'skills') return message;
		if (!message.includes('Unknown command:')) return message;
		// New Engine: `Unknown command: /x (Skill 'x' not found…)` — do not mislabel as missing SkillSlash.
		if (message.includes('(')) return message;
		const known =
			this.slashCatalog.some(e => e.name.toLowerCase() === name) ||
			(this.discoverHostSkills?.().some(e => e.name.toLowerCase() === name) ?? false);
		if (!known) return message;
		return `${message}\n\n${hostT('errors.skill.engine_missing_skillslash', {name})}`;
	}

	requestModelList(): boolean {
		if (this.catalogFromProviders) return true;
		const sessionId = this.commandSessionId();
		if (!sessionId) return false;
		this.awaitingModelList = true;
		return this.composer.sendPinnedCommand('model', '', sessionId);
	}

	applyProviderCatalog(entries: ModelCatalogEntry[]): void {
		this.catalogFromProviders = true;
		this.awaitingModelList = false;
		const pick = resolveComposerChrome(entries, this.model, this.modelDisplay);
		this.modelCatalog = entries.map(e => ({
			...e,
			current: pick
				? modelEntryMatches(e, pick.id) || modelEntryMatches(e, pick.display)
				: false
		}));
		if (pick && (this.model !== pick.id || this.modelDisplay !== pick.display)) {
			this.applyModel(pick.id, pick.display);
		}
		this.onChange?.();
	}

	selectModel(modelId: string): boolean {
		const id = modelId.trim();
		if (!id) return false;
		const entry = this.modelCatalog.find(e => modelEntryMatches(e, id));
		const resolvedId = entry?.id ?? id;
		const resolvedDisplay =
			entry?.display ?? (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id);
		this.applyModel(resolvedId, resolvedDisplay);
		this.modelCatalog = this.modelCatalog.map(e => ({
			...e,
			current: modelEntryMatches(e, resolvedId) || modelEntryMatches(e, resolvedDisplay)
		}));
		const sessionId = this.commandSessionId();
		if (sessionId) {
			this.composer.sendPinnedCommand('model', resolvedId, sessionId);
		}
		return true;
	}

	setRunMode(mode: string, expectedTaskId?: string | null): boolean {
		const active = this.getActiveTask();
		if (
			expectedTaskId &&
			active?.id !== expectedTaskId &&
			active?.sessionId !== expectedTaskId
		) {
			return false;
		}
		const m = mode.trim().toLowerCase();
		if (!['agent', 'plan', 'ask', 'yolo'].includes(m)) return false;
		const sessionId = this.commandSessionId();
		if (sessionId) {
			this.sendFn({type: 'SetMode', sessionId, mode: m});
		}
		this.applyRunMode(m as TaskRecord['runMode']);
		return true;
	}

	setAvailableEngines(ids: string[]): void {
		this.availableIds = new Set(ids.map(id => id.trim().toLowerCase()).filter(Boolean));
		if (this.availableIds.size === 0) this.availableIds.add('fast');
	}

	availableEngineIds(): string[] {
		return [...this.availableIds];
	}

	setEngineKind(kind: string, expectedTaskId?: string | null): boolean {
		const active = this.getActiveTask();
		if (
			expectedTaskId &&
			active?.id !== expectedTaskId &&
			active?.sessionId !== expectedTaskId
		) {
			return false;
		}
		const k = parseEngineKind(kind);
		if (!this.availableIds.has(k)) return false;
		const sessionId = this.commandSessionId();
		if (sessionId) {
			this.lifecycle.stageEngineChange(sessionId, this.engineKind);
			this.sendFn({type: 'SetEngine', sessionId, engineId: k});
		}
		this.applyEngineKind(k);
		return true;
	}

	setModelSettings(settings: {
		platform: string;
		model: string;
		effort?: string;
		thinking?: boolean;
	}): boolean {
		const platform = settings.platform.trim();
		const model = settings.model.trim();
		if (!platform || !model) return false;
		const sessionId = this.commandSessionId();
		if (sessionId) {
			this.sendFn({
				type: 'SetModelSettings',
				sessionId,
				platform,
				model,
				...(settings.effort ? {effort: settings.effort} : {}),
				...(settings.thinking !== undefined ? {thinking: settings.thinking} : {})
			});
		}
		this.applySampling(settings.effort, settings.thinking);
		return true;
	}

	/**
	 * Paint the Composer with a resolved default-model label (never the bare `default` alias
	 * or the yaml nemotron stub). Used when Hello still carries the alias stub but
	 * Settings/Providers know the real id.
	 */
	healDefaultModelDisplay(model: string, display: string): boolean {
		if (isPlaceholderModelDisplay(display)) return false;
		if (isUnresolvedModelDisplay(display) && !this.catalogHas(display) && !this.catalogHas(model)) {
			return false;
		}
		const currentUnresolved =
			isUnresolvedModelDisplay(this.modelDisplay) || isPlaceholderModelDisplay(this.model);
		const notInCatalog =
			this.modelCatalog.length > 0 &&
			!this.catalogHas(this.model) &&
			!this.catalogHas(this.modelDisplay);
		if (!currentUnresolved && !notInCatalog && this.modelDisplay !== display) {
			return false;
		}
		this.applyModel(model, display);
		this.onChange?.();
		return true;
	}

	private catalogHas(ref: string): boolean {
		const t = ref.trim();
		if (!t) return false;
		return this.modelCatalog.some(e => modelEntryMatches(e, t));
	}

	/** Keep controller chrome + active Task model in lockstep. */
	private applyModel(model: string, modelDisplay: string): void {
		let resolved = resolvedModelDisplay(model, modelDisplay);
		if (!resolved) {
			const raw = modelDisplay.trim() || model.trim();
			if (this.catalogHas(raw) || this.catalogHas(model)) resolved = raw;
		}
		if (!resolved) {
			if (!isUnresolvedModelDisplay(this.modelDisplay)) return;
			this.model = 'default';
			this.modelDisplay = '';
			const active = this.getActiveTask();
			if (active && isUnresolvedModelDisplay(active.modelDisplay)) {
				active.model = 'default';
				active.modelDisplay = '';
				this.tasks.set(active.id, active);
			}
			return;
		}
		const key =
			wireUseModel(model, resolved) ??
			(this.catalogHas(resolved) ? resolved : model);
		this.model = key;
		this.modelDisplay = resolved;
		const active = this.getActiveTask();
		if (active) {
			active.model = key;
			active.modelDisplay = resolved;
			this.tasks.set(active.id, active);
		}
		if (!isUnresolvedModelDisplay(resolved)) {
			for (const t of this.tasks.values()) {
				if (t.id === active?.id) continue;
				if (!isUnresolvedModelDisplay(t.modelDisplay)) continue;
				const sameKey =
					t.model === model ||
					t.model === key ||
					(isPlaceholderModelDisplay(t.model) && isPlaceholderModelDisplay(model));
				if (!sameKey) continue;
				t.model = key;
				t.modelDisplay = resolved;
				this.tasks.set(t.id, t);
			}
		}
	}

	private applyRunMode(mode: TaskRecord['runMode']): void {
		this.runMode = mode;
		const task = this.getActiveTask();
		if (!task) return;
		task.runMode = mode;
		this.tasks.set(task.id, task);
	}

	private applyEngineKind(kind: TaskRecord['engineKind']): void {
		this.engineKind = kind;
		const task = this.getActiveTask();
		if (!task) return;
		task.engineKind = kind;
		this.tasks.set(task.id, task);
	}

	private applySampling(effort?: string, thinking?: boolean): void {
		if (effort !== undefined) this.effort = effort || undefined;
		if (thinking !== undefined) this.thinking = thinking;
		const task = this.getActiveTask();
		if (!task) return;
		if (effort !== undefined) {
			if (effort) task.effort = effort;
			else delete task.effort;
		}
		if (thinking !== undefined) task.thinking = thinking;
		this.tasks.set(task.id, task);
	}

	/**
	 * @deprecated Host queue is projection-only (E4). Busy send uses SubmitUserMessage.
	 * Kept as a no-op false so legacy call sites fail closed.
	 */
	enqueue(_text: string, _mentions?: MentionChip[]): boolean {
		return false;
	}

	removeQueueItem(itemId: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		return queueRemoveCommands(task, task.sessionId, itemId)
			.map(cmd => this.sendFn(cmd))
			.some(ok => ok);
	}

	clearQueue(): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		return queueClearCommands(task, task.sessionId)
			.map(cmd => this.sendFn(cmd))
			.some(ok => ok);
	}

	reorderQueue(fromIndex: number, toIndex: number): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const [cmd] = queueReorderCommands(task, task.sessionId, fromIndex, toIndex);
		return cmd ? this.sendFn(cmd) : false;
	}

	editQueueItem(itemId: string, text: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const [cmd] = queueEditCommands(task, task.sessionId, itemId, text);
		return cmd ? this.sendFn(cmd) : false;
	}

	setQueuePaused(paused: boolean): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		return this.sendFn(queuePauseCommand(task.sessionId, paused));
	}

	dshSteer(text: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		if (!task.dshCaps?.queue) return false;
		const trimmed = text.trim();
		if (!trimmed) return false;
		return this.sendFn({type: 'Steer', sessionId: task.sessionId, text: trimmed});
	}

	dshGoalAct(action: 'pause' | 'resume' | 'complete' | 'clear'): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		if (!task.dshCaps?.goal) return false;
		const method =
			action === 'pause'
				? 'goal.pause'
				: action === 'resume'
					? 'goal.resume'
					: action === 'complete'
						? 'goal.complete'
						: 'goal.clear';
		return this.sendFn({type: 'Call', method, sessionId: task.sessionId, payload: {}});
	}

	interruptQueueItem(itemId: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const plan = queueSteerPlan(task, itemId);
		if (!plan) return false;
		if (plan.kind === 'dsh') {
			return this.sendFn({type: 'Queue', sessionId: task.sessionId, itemId, action: 'steer'});
		}
		const streaming = task.transcript.entries.some(e => e.status === 'streaming');
		const runId = chromeRunId(task.transcript.chrome);
		if (
			runId ||
			streaming ||
			chromeAwaitingSettlement(task.transcript.chrome) ||
			goalKeepsBusy(task.goalCard)
		) {
			task.transcript = applyLocalCancel(task.transcript);
			this.tasks.set(task.id, task);
			this.leaseWatch.armCancelSettle(task.id);
		}
		return this.sendFn({
			type: 'InterruptWithMessage',
			sessionId: task.sessionId,
			text: plan.text,
			clientMessageId: this.createId(),
			itemId,
			...this.composer.composerSampling()
		});
	}

	decideApproval(approvalId: string, approved: boolean, reason?: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const approval = task.transcript.approvals.find(a => a.id === approvalId);
		if (!approval) return false;
		return this.sendFn({
			type: 'DecideApproval',
			sessionId: task.sessionId,
			runId: approval.runId,
			approvalId,
			approved,
			reason
		});
	}

	answerQuestion(questionId: string, answer: string): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const question = task.transcript.questions.find(q => q.id === questionId);
		if (!question) return false;
		const trimmed = answer.trim();
		if (!trimmed) return false;
		const selectedOptionId = question.options.some(o => o.id === trimmed) ? trimmed : undefined;
		return this.sendFn({
			type: 'AnswerQuestion',
			sessionId: task.sessionId,
			runId: question.runId,
			questionId,
			...(selectedOptionId ? {selectedOptionId} : {customText: trimmed})
		});
	}

	answerQuestionBatch(
		rpcId: string,
		payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
	): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const batch = task.transcript.questionBatches.find(q => q.rpcId === rpcId);
		if (!batch) return false;
		if ('cancelled' in payload && payload.cancelled) {
			return this.sendFn({
				type: 'AnswerQuestionBatch',
				sessionId: task.sessionId,
				rpcId,
				cancelled: true
			});
		}
		if (!('answers' in payload) || payload.answers.length === 0) return false;
		return this.sendFn({
			type: 'AnswerQuestionBatch',
			sessionId: task.sessionId,
			rpcId,
			answers: payload.answers
		});
	}

	cancelRun(reason = 'cancelled by user'): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		const streaming = task.transcript.entries.some(e => e.status === 'streaming');
		const runId = chromeRunId(task.transcript.chrome);
		const goalBusy = goalKeepsBusy(task.goalCard);
		if (!runId && !streaming && !chromeAwaitingSettlement(task.transcript.chrome) && !goalBusy) {
			return false;
		}

		task.transcript = applyLocalCancel(task.transcript);
		this.tasks.set(task.id, task);
		this.leaseWatch.armCancelSettle(task.id);

		// Stop = CancelAssociated (FanOut BusyRoots); no Submit / no Follow-up drain (V6).
		return this.sendFn({
			type: 'CancelAssociated',
			sessionId: task.sessionId,
			reason
		});
	}

	killProc(procId: string, reason = 'user_stopped', sessionId?: string): boolean {
		const id = procId.trim();
		const sid =
			sessionId?.trim() ||
			this.getActiveTask()?.sessionId?.trim() ||
			'';
		if (!id || !sid) return false;
		// Attach not required: KillProc is Session-routed; LivingTask rail may kill off-focus.
		const ok = this.sendFn({type: 'KillProc', sessionId: sid, procId: id, reason});
		if (ok) {
			const task = this.taskBySessionId(sid) ?? this.getActiveTask();
			if (task) {
				// Optimistic clear: after turn settle Bridge may not stream Live ProcUpdated.
				task.transcript = applyBridgeEvent(task.transcript, {
					type: 'proc_updated',
					procId: id,
					status: 'killed',
					reason
				});
				this.tasks.set(task.id, task);
				this.onChange?.();
			}
		}
		return ok;
	}

	// ── ②′ Goal card actions (single human gate surface) ────────────────────

	private activeGoalCard(): {task: TaskRecord; card: GoalCardView} | null {
		const task = this.getActiveTask();
		if (!task?.goalCard) return null;
		return {task, card: task.goalCard};
	}

	/** One gesture: optional card edits ride as ConfirmGoal.patchJson (patch → freeze → start). */
	confirmGoal(patchJson?: string): boolean {
		const active = this.activeGoalCard();
		if (!active || active.card.phase !== 'awaiting_confirm') return false;
		return this.sendFn(
			patchJson
				? {type: 'ConfirmGoal', goalId: active.card.goalId, patchJson}
				: {type: 'ConfirmGoal', goalId: active.card.goalId}
		);
	}

	pauseGoal(goalId?: string): boolean {
		const id = goalId?.trim() || this.activeGoalCard()?.card.goalId;
		if (!id) return false;
		if (!goalId?.trim()) {
			const phase = this.activeGoalCard()?.card.phase;
			if (phase !== 'started' && phase !== 'escalated') return false;
		}
		return this.sendFn({type: 'PauseGoal', goalId: id});
	}

	cancelGoal(goalId?: string): boolean {
		const id = goalId?.trim() || this.activeGoalCard()?.card.goalId;
		if (!id) return false;
		return this.sendFn({type: 'CancelGoal', goalId: id});
	}

	/** Paused → running (ResumeGoal); blocked goals go through escalateGoal('resume'). */
	resumeGoal(goalId?: string): boolean {
		const id = goalId?.trim();
		if (id) return this.sendFn({type: 'ResumeGoal', goalId: id});
		const active = this.activeGoalCard();
		if (!active || active.card.phase !== 'paused') return false;
		return this.sendFn({type: 'ResumeGoal', goalId: active.card.goalId});
	}

	steerGoal(note: string, goalId?: string): boolean {
		if (!note.trim()) return false;
		const id = goalId?.trim() || this.activeGoalCard()?.card.goalId;
		if (!id) return false;
		return this.sendFn({type: 'SteerGoal', goalId: id, note: note.trim()});
	}

	escalateGoal(action: 'resume' | 'fail'): boolean {
		const active = this.activeGoalCard();
		if (!active || active.card.phase !== 'escalated') return false;
		return this.sendFn(
			action === 'resume'
				? {type: 'EscalateResume', goalId: active.card.goalId}
				: {type: 'EscalateFail', goalId: active.card.goalId}
		);
	}

	/** Completion card acknowledge — UI only (goal row already terminal). */
	dismissGoalCard(): boolean {
		const active = this.activeGoalCard();
		if (!active) return false;
		active.task.goalCard = undefined;
		active.task.transcript = {...active.task.transcript, goalFlow: undefined};
		this.tasks.set(active.task.id, active.task);
		this.onChange?.();
		return true;
	}

	/**
	 * Last-resort unlock when Bridge never emits `turn_cancelled` (or it is dropped).
	 * Safe to call repeatedly; only acts while awaiting Cancel Settlement.
	 */
	forceCancelSettlement(reason = 'client settlement timeout', taskId?: string): boolean {
		const id = taskId ?? this.activeTaskId;
		const task = id ? this.tasks.get(id) ?? null : null;
		if (!task) return false;
		this.leaseWatch.clearCancelSettle(task.id);
		if (!chromeAwaitingSettlement(task.transcript.chrome)) return false;
		task.transcript = applyBridgeEvent(task.transcript, {
			type: 'turn_cancelled',
			reason
		});
		this.tasks.set(task.id, task);
		this.onChange?.();
		return true;
	}

	private settleExpiredLease(task: TaskRecord): void {
		task.transcript = applyLeaseExpiry(task.transcript);
		if (goalKeepsBusy(task.goalCard)) {
			task.goalCard = undefined;
			task.transcript = {...task.transcript, goalFlow: undefined};
		}
		task.pendingAttach = false;
		this.helpNotice = 'errors.lease.expired';
		this.tasks.set(task.id, task);
		this.leaseWatch.syncCancelSettle(task);
	}

	tickRunLeases(): void {
		this.leaseWatch.tickRunLeases();
	}

	noteHelp(notice: string): void {
		this.helpNotice = notice;
		this.onChange?.();
	}

	consumeHelpNotice(): string | null {
		const note = this.helpNotice;
		this.helpNotice = null;
		return note;
	}

	consumeCompletionCue(): CompletionCue | null {
		const cue = this.pendingCompletionCue;
		this.pendingCompletionCue = null;
		return cue;
	}

	private offerCompletionCue(
		task: TaskRecord,
		kind: 'turn_finished' | 'goal_finished',
		wasBusy: boolean,
		success: boolean
	): void {
		const gate = composerGate(task.transcript, true);
		if (
			!shouldSoundOnSettle({
				kind,
				wasBusy,
				runState: gate.runState,
				composerLocked: gate.composerLocked,
				queueLength: task.queue.length,
				queuePaused: task.queuePaused,
				goalBusy: goalKeepsBusy(task.goalCard)
			})
		) {
			return;
		}
		this.pendingCompletionCue = {taskId: task.id, success};
	}

	handleEvent(event: BridgeEvent): TaskRecord | null {
		const host = this.hostEvent(event);
		if (host.stop) return host.task;
		return this.projectStream(event);
	}

	/**
	 * Host-level / attach bookkeeping. Returns stop when the event must not continue
	 * into Transcript / Code Changes projection.
	 */
	private hostEvent(event: BridgeEvent): {stop: true; task: TaskRecord | null} | {stop: false} {
		const routed = this.lifecycle.handleCommandResult(event);
		if (routed.stop) {
			return {stop: true, task: routed.task ?? this.getActiveTask()};
		}

		if (event.type === 'input_accepted') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task = (sid ? this.taskBySessionId(sid) : null) ?? this.getActiveTask();
			// Clear sticky opt-in whenever present; drop pending only if still waiting.
			if (sid && this.titleGenRequested.has(sid)) {
				this.titleGenRequested.delete(sid);
				if (task?.autoTitlePending) {
					task.autoTitlePending = false;
					this.tasks.set(task.id, task);
					this.onChange?.();
				}
			}
			return {stop: false};
		}

		if (event.type === 'input_rejected') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			// Drop sticky opt-in; autoTitlePending stays so the next successful send can retry.
			if (sid) this.titleGenRequested.delete(sid);
			const reason =
				'reason' in event && typeof event.reason === 'string' && event.reason.trim()
					? event.reason.trim()
					: 'errors.build.rejected';
			if (this.composer.pendingPlanBuildPlanId) {
				this.composer.clearPendingPlanBuild();
				this.helpNotice = reason;
			}
			// HITL lock is a send blocker, not a failed run. Painting the engine detail as
			// a second ErrorCard (next to the Transport card) is what "Retry did nothing
			// then composer_locked appeared" looks like.
			if (reason.includes('composer_locked')) {
				this.helpNotice = 'errors.send.composer_locked';
				this.onChange?.();
				return {stop: true, task: (sid ? this.taskBySessionId(sid) : null) ?? this.getActiveTask()};
			}
			const task = (sid ? this.taskBySessionId(sid) : null) ?? this.getActiveTask();
			if (task) {
				task.transcript = {
					...task.transcript,
					entries: [
						...task.transcript.entries,
						{
							id: this.createId(),
							role: 'assistant',
							text: reason,
							status: 'error'
						}
					]
				};
				this.tasks.set(task.id, task);
			}
			this.onChange?.();
			return {stop: false};
		}

		if (event.type === 'ready') {
			if (event.model) {
				const display = event.modelDisplay ?? event.model;
				if (
					!isUnresolvedModelDisplay(display) &&
					!isPlaceholderModelDisplay(event.model)
				) {
					this.applyModel(event.model, display);
				}
			}
			// Catalog comes from ListProviders (Hub.applyProviderCatalog). Do not pull yaml `/model`
			// here — that dump races ListProviders and paints Settings-disabled yaml rows.
			// ready must not bind pending New — only CreateSession command_result + taskId.
		}

		if (event.type === 'sessions_list') {
			this.hydrateFromSessionsList(event.sessions);
			return {stop: true, task: this.getActiveTask()};
		}

		if (event.type === 'model_changed') {
			this.applyModel(event.model, event.modelDisplay ?? event.model);
		}

		if (event.type === 'commands_available') {
			const fromBridge = (event.commands ?? []).map(c =>
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
				const host = this.discoverHostSkills?.() ?? [];
				const byName = new Map<string, SlashCatalogEntry>();
				for (const e of host) {
					if (PRODUCT_CODING_SKILL_NAMES.has(e.name.toLowerCase())) continue;
					byName.set(e.name.toLowerCase(), withNormalizedBadge(e));
				}
				for (const e of fromBridge) byName.set(e.name.toLowerCase(), e);
				// Stable order for menu (group sort still applies in renderer).
				this.slashCatalog = [...byName.values()].sort((a, b) =>
					a.name.localeCompare(b.name)
				);
				this.bridgeSlashCatalog = true;
			} else {
				this.applyEmptySlashCatalog();
			}
			this.slashCatalogHydrated = true;
			return {stop: true, task: this.getActiveTask()};
		}

		if (event.type === 'command_result' && event.name === 'model') {
			if (this.catalogFromProviders) {
				this.awaitingModelList = false;
				return {stop: true, task: this.getActiveTask()};
			}
			if (this.awaitingModelList && event.status !== 'error') {
				this.modelCatalog = parseModelCatalog(event.message);
				this.awaitingModelList = false;
				const current = this.modelCatalog.find(e => e.current);
				if (current) {
					// Prefer catalog display over alias placeholders ("default" / "Default").
					this.applyModel(current.id, current.display);
				}
				this.onChange?.();
				// Do not project list dump into transcript
				return {stop: true, task: this.getActiveTask()};
			}
			this.awaitingModelList = false;
		}

		if (event.type === 'command_result' && event.name === 'skills') {
			this.composer.handleSkillsResult(event);
			return {stop: true, task: this.getActiveTask()};
		}

		// ②′ card lifecycle push — the single source for confirm/busy/escalate/completion cards.
		if (event.type === 'goal_updated') {
			const eventSession =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task =
				(eventSession ? this.taskBySessionId(eventSession) : null) ?? this.getActiveTask();
			if (task) {
				const wasBusy = goalKeepsBusy(task.goalCard);
				const incoming: GoalCardView = {
					goalId: event.goalId,
					phase: event.phase,
					status: event.status,
					name: event.name ?? undefined,
					statement: event.statement ?? undefined,
					acceptance: event.acceptance ?? undefined,
					workflowJson: event.workflowJson ?? undefined,
					membersJson: event.membersJson ?? undefined,
					budgetJson: event.budgetJson ?? undefined,
					loopAgentId: event.loopAgentId ?? undefined,
					resultSummary: event.resultSummary ?? undefined,
					escalateActions: event.escalateActions,
					reason: event.reason ?? undefined,
					currentStepIds: pickIdList(event.currentStepIds, event.currentStepId),
					activeRunIds: pickIdList(event.activeRunIds, event.activeRunId),
					progressJson: event.progressJson ?? undefined,
					escalateKind:
						event.escalateKind === 'infra' || event.escalateKind === 'decision'
							? event.escalateKind
							: undefined
				};
				// A push for another goal must not clobber a live confirm card.
				const clobbers =
					task.goalCard &&
					task.goalCard.goalId !== event.goalId &&
					task.goalCard.phase === 'awaiting_confirm' &&
					event.phase !== 'awaiting_confirm';
				if (!clobbers) {
					task.goalCard = incoming;
					// Goal track is not a Chat-turn straggler — lift SkillSlash postRunTerminal
					// so Goal notice turns / nested non-Goal agent_call are not dropped.
					// L1 Goal agent_call_* with goalId also pass the guard inside applyBridgeEvent.
					const prevFlow = task.transcript.goalFlow;
					const keepLive =
						prevFlow?.goalId === incoming.goalId &&
						prevFlow.members.some(m => !m.runId.startsWith('seed-'));
					const nextFlow = keepLive ? prevFlow : goalFlowSeed(incoming);
					task.transcript = paintAwaitingConfirm(
						{
							...task.transcript,
							goalFlow: nextFlow,
							...(event.phase === 'started' ||
							event.phase === 'paused' ||
							event.phase === 'escalated'
								? {postRunTerminal: false}
								: {})
						},
						incoming
					);
					this.tasks.set(task.id, task);
					if (event.phase === 'finished') {
						const failed =
							event.status === 'failed' ||
							event.status === 'cancelled' ||
							event.status === 'canceled';
						this.offerCompletionCue(task, 'goal_finished', wasBusy, !failed);
					}
					this.onChange?.();
				}
			}
			return {stop: true, task: task ?? this.getActiveTask()};
		}

		// PatchGoal result — canonical draft snapshot rides the reply (no live stream needed).
		if (event.type === 'command_result' && event.name === 'PatchGoal') {
			const eventSession =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task =
				(eventSession ? this.taskBySessionId(eventSession) : null) ?? this.getActiveTask();
			const g = event.goal;
			if (
				task &&
				event.status === 'accepted' &&
				g &&
				task.goalCard?.phase === 'awaiting_confirm' &&
				task.goalCard.goalId === g.id
			) {
				task.goalCard = {
					...task.goalCard,
					status: g.status,
					statement: g.statement ?? task.goalCard.statement,
					acceptance: g.acceptance ?? task.goalCard.acceptance,
					workflowJson: g.workflowJson ?? task.goalCard.workflowJson,
					budgetJson: g.budgetJson ?? task.goalCard.budgetJson,
					membersJson: g.membersJson ?? task.goalCard.membersJson,
					loopAgentId: g.loopAgentId ?? task.goalCard.loopAgentId,
					currentStepIds: mergeIdList(
						task.goalCard.currentStepIds,
						g.currentStepIds,
						g.currentStepId
					),
					activeRunIds: mergeIdList(
						task.goalCard.activeRunIds,
						g.activeRunIds,
						g.activeRunId
					),
					progressJson: g.progressJson ?? task.goalCard.progressJson
				};
				this.tasks.set(task.id, task);
				this.onChange?.();
			}
			return {stop: true, task: task ?? this.getActiveTask()};
		}

		// ConfirmGoal / CancelGoal — paint outcome. Confirm must NOT drop the card: transition
		// awaiting_confirm → started from command_result.goal (watch can miss GoalUpdated(started)).
		if (
			event.type === 'command_result' &&
			(event.name === 'ConfirmGoal' || event.name === 'CancelGoal') &&
			event.message?.trim()
		) {
			const eventSession =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task =
				(eventSession ? this.taskBySessionId(eventSession) : null) ?? this.getActiveTask();
			if (task) {
				const ok = event.status === 'accepted' || event.status === 'success';
				if (event.name === 'CancelGoal') {
					// Success OR failure (goal already terminal / missing): the Stop affordance
					// is meaningless once the goal can no longer be cancelled. A late
					// GoalUpdated(finished) may never arrive, so don't leave the card stuck on
					// 'started' with a Stop button that always errors "cannot cancelled from status=…".
					task.goalCard = undefined;
					task.transcript = {...task.transcript, goalFlow: undefined};
				} else if (ok && event.name === 'ConfirmGoal') {
					const g = event.goal;
					const started =
						g?.status === 'running' ||
						event.message.includes('confirmed+started') ||
						event.message.startsWith('confirmed+started');
					if (started) {
						const prev = task.goalCard;
						task.goalCard = {
							goalId: g?.id ?? prev?.goalId ?? '',
							phase: 'started',
							status: g?.status ?? 'running',
							statement: g?.statement ?? prev?.statement,
							acceptance: g?.acceptance ?? prev?.acceptance,
							workflowJson: g?.workflowJson ?? prev?.workflowJson,
							membersJson: g?.membersJson ?? prev?.membersJson,
							budgetJson: g?.budgetJson ?? prev?.budgetJson,
							loopAgentId: g?.loopAgentId ?? prev?.loopAgentId,
							resultSummary: g?.resultSummary ?? prev?.resultSummary,
							currentStepIds: mergeIdList(
								prev?.currentStepIds,
								g?.currentStepIds,
								g?.currentStepId
							),
							activeRunIds: mergeIdList(
								prev?.activeRunIds,
								g?.activeRunIds,
								g?.activeRunId
							),
							progressJson: g?.progressJson ?? prev?.progressJson
						};
						if (!task.goalCard.goalId) task.goalCard = undefined;
					} else if (task.goalCard?.phase === 'awaiting_confirm') {
						// Confirmed but startGoal failed — keep card so user can retry / cancel.
					}
				}
				task.transcript = {
					...task.transcript,
					// Confirm opens Goal track — do not keep the prior Chat turn's straggler guard.
					chrome: runChromeTransition(task.transcript.chrome, {postRun: !(ok && event.name === 'ConfirmGoal') && chromePostRun(task.transcript.chrome)}),
					entries: [
						...task.transcript.entries,
						{
							id: this.createId(),
							role: 'assistant',
							text: event.message,
							status: ok ? 'done' : 'error'
						}
					]
				};
				this.tasks.set(task.id, task);
				this.onChange?.();
			}
			return {stop: true, task: task ?? this.getActiveTask()};
		}

		// RerunRun rejections (target active / session busy / stale target / unsupported)
		// arrive as command_result status='rejected'. They must NOT paint a transcript
		// error entry — that rendered a second "运行失败详情" card repeating the busy
		// text next to the real failure card. The renderer surfaces rejections via the
		// bridge:error code (sticky regen banner + optimistic-hide rollback) instead.
		if (event.type === 'command_result' && event.name === 'RerunRun') {
			return {stop: true, task: this.getActiveTask()};
		}

		// SkillSlash / unknown slash failures arrive after task:send already returned —
		// paint into the owning Task (by sessionId) so the UI is never silently empty.
		if (
			event.type === 'command_result' &&
			event.status === 'error' &&
			event.message?.trim() &&
			(event.name === 'skill_view' ||
				event.message.includes('Unknown command:') ||
				event.message.includes('No active session') ||
				event.message.includes('Failed to persist skill_view') ||
				// Skill names are Bridge command names; host help/clear/model handled above.
				(typeof event.name === 'string' &&
					event.name.length > 0 &&
					!['skills', 'model', 'debug', 'sessions', 'history'].includes(event.name)))
		) {
			const eventSession =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task =
				(eventSession ? this.taskBySessionId(eventSession) : null) ?? this.getActiveTask();
			// Drop sticky generateTitle opt-in (no input_accepted/rejected on this path).
			const sid = eventSession ?? task?.sessionId;
			if (sid) this.titleGenRequested.delete(sid);
			if (task) {
				task.transcript = {
					...task.transcript,
					entries: [
						...task.transcript.entries,
						{
							id: this.createId(),
							role: 'assistant',
							text: this.enrichSkillCommandError(event.name, event.message),
							status: 'error'
						}
					]
				};
				this.tasks.set(task.id, task);
			}
			return {stop: true, task: task ?? this.getActiveTask()};
		}

		if (event.type === 'Attached' && event.sessionId) {
			this.attachedSessionIds.add(event.sessionId);
			const existing = this.taskBySessionId(event.sessionId);
			if (existing) {
				existing.pendingAttach = false;
				existing.pendingNew = false;
				this.tasks.set(existing.id, existing);
			} else {
				// Never claim an unbound pendingNew from a stray Attached — that was
				// how a prior session stole a brand-new empty task (ISO-4/8).
				const active = this.getActiveTask();
				if (active?.pendingAttach && active.sessionId === event.sessionId) {
					active.pendingAttach = false;
					active.pendingNew = false;
					this.tasks.set(active.id, active);
				}
			}
			// Slash catalog: composer pulls on menu open — not on every Attached.
			// Model catalog: Hub ListProviders, not yaml `/model`.
		}

		return {stop: false};
	}

	/** sessionId → TaskRecord projection (Transcript, Code Changes, Ack, Follow-up). */
	private projectStream(event: BridgeEvent): TaskRecord | null {
		const eventSession = sessionIdFromEvent(event);
		const task = this.resolveTaskForEvent(event, eventSession);
		if (!task) return null;

		if (
			event.type === 'turn_started' &&
			'messageType' in event &&
			event.messageType === 'plan_build'
		) {
			this.composer.clearPendingPlanBuild();
		}

		if (event.type === 'dsh_caps') {
			task.dshCaps = {
				queue: event.queue,
				goal: event.goal,
				budget: event.budget,
				question: event.question,
				slash: event.slash
			};
			this.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'dsh_queue') {
			task.dshQueue = event.items;
			this.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'dsh_goal_changed') {
			task.dshGoal = {
				operation: event.operation,
				phase: event.phase,
				title: event.title,
				text: event.text
			};
			this.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'follow_up_changed') {
			this.applyFollowUpProjection(
				task,
				event.paused,
				event.itemsJson,
				'notice' in event && typeof event.notice === 'string' ? event.notice : undefined
			);
			this.tasks.set(task.id, task);
			return task;
		}

		if (isSessionStreamEvent(event.type)) {
			if (!eventSession) {
				// Defense in depth: never paint unsigned stream onto a Task.
				return task;
			}
			// Live stream only for Sessions we keep attached (multi-Attach).
			if (!this.attachedSessionIds.has(eventSession)) {
				return task;
			}
		}

		const seqSession = task.sessionId ?? eventSession;
		const wasBusy = composerGate(task.transcript, false).runState !== 'idle';
		if (seqSession) {
			const before = this.seqBySession.get(seqSession) ?? {
				...emptySessionSeq(),
				lastApplied: task.lastEventSeq
			};
			const result = offer(before, event, {terminal: seqTerminal(task.transcript)});
			this.seqBySession.set(seqSession, result.state);
			if (result.state.lastApplied !== before.lastApplied) {
				task.lastEventSeq = result.state.lastApplied;
				this.sendFn({
					type: 'Ack',
					sessionId: seqSession,
					clientId: this.clientId,
					lastEventSeq: result.state.lastApplied
				});
			}
			for (const ev of result.emit) {
				task.transcript = applyBridgeEvent(task.transcript, ev);
				task.codeChanges = applyCodeChangeEvent(task.codeChanges, ev);
			}
			if (result.resync) this.requestAttach(task, seqSession, result.state.lastApplied);
		} else {
			task.transcript = applyBridgeEvent(task.transcript, event);
			task.codeChanges = applyCodeChangeEvent(task.codeChanges, event);
		}
		if (event.type === 'session_restored' && eventSession) {
			this.restoredSessionIds.add(eventSession);
		}
		if (event.type === 'session_history_page' && event.sessionId === this.historyInFlightSessionId) {
			this.historyInFlightSessionId = null;
		}
		if (task.goalCard?.phase === 'awaiting_confirm') {
			task.transcript = paintAwaitingConfirm(task.transcript, task.goalCard);
		}
		this.tasks.set(task.id, task);

		if (
			event.type === 'turn_finished' ||
			event.type === 'run_done' ||
			event.type === 'run_failed' ||
			event.type === 'run_exhausted'
		) {
			this.offerCompletionCue(
				task,
				'turn_finished',
				wasBusy,
				event.type === 'run_failed' || event.type === 'run_exhausted'
					? false
					: !('success' in event && event.success === false)
			);
		}

		this.leaseWatch.syncCancelSettle(task);
		this.leaseWatch.noteRunLease(task, event);

		return task;
	}

	/** E4: task.queue is a read-through of Session follow_up_changed. */
	private applyFollowUpProjection(
		task: TaskRecord,
		paused: boolean,
		itemsJson: string,
		notice?: string
	): void {
		task.queuePaused = paused;
		if (notice?.trim()) this.helpNotice = notice.trim();
		try {
			const raw = JSON.parse(itemsJson) as unknown;
			if (!Array.isArray(raw)) {
				task.queue = [];
				return;
			}
			task.queue = raw
				.filter(
					(x): x is {id: string; text?: string; order?: number; mentionsJson?: string} =>
						x != null && typeof x === 'object' && typeof (x as {id?: unknown}).id === 'string'
				)
				.map(x => {
					const mentions =
						typeof x.mentionsJson === 'string' && x.mentionsJson
							? parseMentionsJson(x.mentionsJson)
							: undefined;
					return {
						id: x.id,
						text: String(x.text ?? ''),
						order: typeof x.order === 'number' ? x.order : 0,
						...(mentions && mentions.length > 0 ? {mentions} : {})
					};
				})
				.filter(q => q.id.length > 0)
				.sort((a, b) => a.order - b.order)
				.map(({id, text, mentions}) => ({
					id,
					text,
					...(mentions ? {mentions} : {})
				}));
		} catch (err) {
			console.error('[follow_up_changed] bad itemsJson', err);
			task.queue = [];
		}
	}

	/**
	 * Route by event sessionId → TaskRecord.
	 * Host-level events (no sessionId) fall back to active.
	 * session_restored / history with an unknown sessionId must not paint onto the
	 * focused pending New task (multi-task / cross-project isolation).
	 */
	private resolveTaskForEvent(
		event: BridgeEvent,
		eventSession: string | undefined
	): TaskRecord | null {
		if (eventSession) {
			const bySession = this.taskBySessionId(eventSession);
			if (bySession) return bySession;
			if (isSessionStreamEvent(event.type)) return null;
			if (event.type === 'session_restored' || event.type === 'session_history_page') {
				return null;
			}
		}
		return this.getActiveTask();
	}

	private taskBySessionId(sessionId: string): TaskRecord | null {
		for (const task of this.tasks.values()) {
			if (task.sessionId === sessionId) return task;
		}
		return null;
	}

	resyncAttached(): void {
		for (const task of this.tasks.values()) {
			if (task.sessionId && this.attachedSessionIds.has(task.sessionId)) {
				this.requestAttach(task, task.sessionId, task.lastEventSeq);
			}
		}
	}

	private requestAttach(task: TaskRecord, sessionId: string, lastEventSeq = 0): boolean {
		// Drop hydrate stubs that raced in for the same Session (ready/meta before bind).
		for (const [id, other] of this.tasks) {
			if (id !== task.id && other.sessionId === sessionId) this.tasks.delete(id);
		}
		task.sessionId = sessionId;
		task.pendingNew = false;
		task.pendingAttach = true;
		this.tasks.set(task.id, task);
		const ok = this.sendFn({
			type: 'AttachSession',
			sessionId,
			clientId: this.clientId,
			lastEventSeq,
			limit: 20
		});
		if (ok) {
			// Match cli-ink: a successful AttachSession write is enough to treat the
			// session as attached so SubmitUserMessage / event projection are not
			// blocked waiting on the Attached ack (some engines delay or coalesce it).
			this.attachedSessionIds.add(sessionId);
			task.pendingAttach = false;
			this.tasks.set(task.id, task);
		}
		return ok;
	}

	/**
	 * Request older Turns before the oldest currently loaded Turn (ADR-0012).
	 * Single-flight: ignores while a page for this Session is already in flight.
	 */
	requestOlderHistory(): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId || !this.attachedSessionIds.has(task.sessionId)) return false;
		if (!task.transcript.hasMoreOlder) return false;
		if (this.historyInFlightSessionId === task.sessionId) return false;
		const beforeTurnId = oldestLoadedTurnId(task.transcript);
		if (!beforeTurnId) return false;
		const ok = this.sendFn({
			type: 'FetchSessionHistory',
			sessionId: task.sessionId,
			beforeTurnId,
			limit: 20
		});
		if (ok) this.historyInFlightSessionId = task.sessionId;
		return ok;
	}

	/** Ask Engine for disk sessions so the project conversation list can hydrate. */
	requestSessionsList(): boolean {
		const workspaceId = this.workspaceId?.() ?? '';
		return this.sendFn({type: 'command', name: 'sessions', args: workspaceId});
	}

	/**
	 * Upsert project conversations (tasks) from Engine sessions_list.
	 * Stub rows only — Bind/Attach happen on selectTask / ensureLive (Open Tab reconcile).
	 */
	hydrateFromSessionsList(sessions: SessionListInfo[]): void {
		this.hydrateFromMeta(
			sessions.map(s => ({
				id: s.id,
				title: s.title?.trim() || s.summary?.trim() || undefined,
				status: 'active',
				lastModified: s.lastModified,
				isCurrent: s.isCurrent ?? undefined,
				runMode: s.runMode ?? undefined,
				engineKind: s.engineKind ?? undefined,
				modelSettings: s.modelSettings ?? undefined
			}))
		);
	}

	/**
	 * Session inventory: upsert stubs for existing Engine sessions.
	 * Never claims an unbound optimistic New row — only CreateSession command_result binds.
	 *
	 * List-order contract (host `listTasks`):
	 * 1. Sort key is `listOrder` only (desc). Never `pendingNew`, never live Engine timestamps.
	 * 2. `listOrder` is set once (create or first stub hydrate) and never moved.
	 * 3. `lastModified` may advance when Meta `updatedAt` is newer (renderer conversation order).
	 * 4. A racing inventory stub for the same sessionId is dropped when acceptNewSession attaches.
	 */
	hydrateFromMeta(
		sessions: Array<{
			id: string;
			title?: string | null;
			status?: string;
			lastModified?: string;
			isCurrent?: boolean;
			runMode?: string;
			engineKind?: string | null;
			modelSettings?: SessionListInfo['modelSettings'];
		}>
	): void {
		const bySessionId = new Map<string, TaskRecord>();
		for (const task of this.tasks.values()) {
			if (task.sessionId) bySessionId.set(task.sessionId, task);
		}

		const ordered = [...sessions].sort((a, b) =>
			(b.lastModified ?? '').localeCompare(a.lastModified ?? '')
		);

		for (const info of ordered) {
			if (info.status === 'deleted') {
				const doomed = bySessionId.get(info.id);
				if (doomed) {
					bySessionId.delete(info.id);
					this.lifecycle.applyDeletedTask(doomed.id);
				}
				continue;
			}

			const named = info.title?.trim() || '';
			const existing = bySessionId.get(info.id);
			if (existing) {
				if (named) existing.title = named;
				if (existing.kind !== 'task') existing.kind = 'task';
				if (
					info.lastModified &&
					(!existing.lastModified || info.lastModified > existing.lastModified)
				) {
					existing.lastModified = info.lastModified;
				}
				applyStickyChrome(existing, info);
				this.tasks.set(existing.id, existing);
				continue;
			}

			const engineMs = info.lastModified ? Date.parse(info.lastModified) : Number.NaN;
			const listOrder = Number.isNaN(engineMs) ? this.lifecycle.nextListOrder() : engineMs;
			const id = this.createId();
			const task: TaskRecord = {
				id,
				title: named || info.id.slice(0, 8),
				kind: 'task',
				sessionId: info.id,
				listOrder,
				lastModified: info.lastModified,
				lastEventSeq: 0,
				transcript: createTranscriptState(),
				codeChanges: createCodeChangesState(),
				pendingNew: false,
				pendingAttach: false,
				createRequested: false,
				autoTitlePending: false,
				queue: [],
				queuePaused: false,
				model: this.model,
				modelDisplay: this.modelDisplay,
				runMode: 'agent',
				engineKind: 'fast'
			};
			applyStickyChrome(task, info);
			this.tasks.set(id, task);
			bySessionId.set(info.id, task);
		}

		this.tasksHydrated = true;

		if (this.activeTaskId) {
			const active = this.tasks.get(this.activeTaskId);
			if (active) this.restoreChromeFromTask(active);
			return;
		}

		const currentInfo = ordered.find(s => s.isCurrent) ?? ordered[0];
		if (!currentInfo) return;

		const current = bySessionId.get(currentInfo.id);
		if (!current) return;
		this.activeTaskId = current.id;
		this.restoreChromeFromTask(current);
	}

	detachAll(): void {
		const seen = new Set<string>();
		for (const sessionId of this.attachedSessionIds) {
			seen.add(sessionId);
			this.sendFn({
				type: 'DetachSession',
				sessionId,
				clientId: this.clientId
			});
		}
		for (const task of this.tasks.values()) {
			if (!task.sessionId || seen.has(task.sessionId)) continue;
			seen.add(task.sessionId);
			this.sendFn({
				type: 'DetachSession',
				sessionId: task.sessionId,
				clientId: this.clientId
			});
		}
		this.attachedSessionIds.clear();
		this.restoredSessionIds.clear();
	}

	tickHeartbeat(): boolean {
		if (this.attachedSessionIds.size === 0) return false;
		const atMillis = this.now();
		let any = false;
		for (const sessionId of this.attachedSessionIds) {
			const ok = this.sendFn({
				type: 'Heartbeat',
				sessionId,
				clientId: this.clientId,
				atMillis
			});
			any = any || ok;
		}
		return any;
	}

	reset(): void {
		this.rejectPendingDeletes('Engine reset');
		this.leaseWatch.dispose();
		this.tasks.clear();
		this.activeTaskId = null;
		this.attachedSessionIds.clear();
		this.restoredSessionIds.clear();
		this.modelCatalog = [];
		this.catalogFromProviders = false;
		this.slashCatalog = [];
		this.slashCatalogHydrated = false;
		this.bridgeSlashCatalog = false;
		this.composer.resetComposerState();
		this.awaitingModelList = false;
		this.helpNotice = null;
	}

	private rejectPendingDeletes(notice: string): void {
		this.lifecycle.rejectPendingDeletes(notice);
	}
}
