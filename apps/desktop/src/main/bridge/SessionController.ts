import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {MentionChip} from '@fast-ide/session-view';
import {
	applyBridgeEvent,
	applyLeaseExpiry,
	CANCEL_SETTLEMENT_TIMEOUT_MS,
	composerGate,
	createLeaseWatch,
	createTranscriptState,
	goalKeepsBusy,
	hasLocalRun,
	type ComposerGate,
	type CompletionCue,
	type LeaseWatchHandle,
	type SessionSeq,
	type SlashCatalogEntry,
	chromeAwaitingSettlement
} from '@fast-ide/session-view';
import {
	createSessionAttachStore,
	detachAllSessions,
	heartbeatAttached,
	parseEngineKind,
	requestSessionAttach,
	resyncSessionAttach,
	type EngineKind,
	type RunMode,
	type SessionMetaInfo
} from '@fast-ide/session-view';
import type {ModelCatalogEntry} from './modelCatalog.js';
import {randomUUID} from 'node:crypto';
import {
	taskRunActive,
	type AnswerBatchPayload,
	type SessionControllerDeps,
	type SessionLifecycle,
	type SessionListInfo,
	type TaskCommands,
	type TaskRecord,
	type TaskView
} from './sessionContracts.js';
import {goalBusyGatePatch, goalLeaseCleanup} from './sessionGoal.js';
import {createSessionGlue, type SessionGlue} from './sessionGlue.js';

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
	/** Live bubble images keyed by session then clientMessageId. */
	private pendingUserImagesBySession = new Map<
		string,
		Map<string, Array<{mediaType: string; name?: string; dataUrl: string}>>
	>();
	/** Multi-Attach: Sessions kept live after select/create (ADR-0010 extend). */
	private readonly attach = createSessionAttachStore();

	private readonly glue: SessionGlue;
	private readonly commands: SessionGlue['commands'];
	private readonly goal: SessionGlue['goal'];
	private readonly lifecycle: SessionGlue['lifecycle'];
	private readonly composer: SessionGlue['composer'];
	private readonly modelSettings: SessionGlue['modelSettings'];
	private readonly slashModule: SessionGlue['slashModule'];
	private readonly eventHost: SessionGlue['eventHost'];
	private leaseWatch!: LeaseWatchHandle;
	private get tasks(): Map<string, TaskRecord> {
		return this.lifecycle.tasks;
	}
	private titleGenRequested = new Set<string>();

	private get catalog() {
		return this.modelSettings.catalog;
	}
	get model(): string {
		return this.catalog.model;
	}
	get modelDisplay(): string {
		return this.catalog.modelDisplay;
	}
	get modelCatalog(): ModelCatalogEntry[] {
		return this.catalog.modelCatalog;
	}
	get runMode(): RunMode {
		return this.catalog.runMode;
	}
	get engineKind(): EngineKind {
		return this.catalog.engineKind;
	}
	get effort(): string | undefined {
		return this.catalog.effort;
	}
	get thinking(): boolean | undefined {
		return this.catalog.thinking;
	}
	private availableIds = new Set<string>(['fast']);
	/** Slash catalog read-face — state lives in slashModule (K18). */
	get slashCatalog(): SlashCatalogEntry[] {
		return this.slashModule.entries;
	}
	set slashCatalog(list: SlashCatalogEntry[]) {
		this.slashModule.replaceEntries(list);
	}
	get slashCatalogHydrated(): boolean {
		return this.slashModule.hydrated;
	}
	/** Set after hydrateFromSessionsList (empty list counts). */
	tasksHydrated = false;
	/** True once Bridge `commands_available` arrived (non-empty); Host disk skills are merged in. */
	get bridgeSlashCatalog(): boolean {
		return this.slashModule.bridgeArrived;
	}
	private readonly discoverHostSkills?: () => SlashCatalogEntry[];
	private helpNotice: string | null = null;
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
		this.glue = createSessionGlue(this as never);
		this.commands = this.glue.commands;
		this.goal = this.glue.goal;
		this.lifecycle = this.glue.lifecycle;
		this.composer = this.glue.composer;
		this.modelSettings = this.glue.modelSettings;
		this.slashModule = this.glue.slashModule;
		this.eventHost = this.glue.eventHost;
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

	/** Seed composer menu from disk when Bridge catalog has not arrived yet (K18). */
	seedHostSlashCatalog(): boolean {
		return this.slashModule.seedHostSlashCatalog();
	}

	getAttachedSessionId(): string | null {
		const active = this.getActiveTask();
		if (active?.sessionId && this.attach.isAttached(active.sessionId)) {
			return active.sessionId;
		}
		return null;
	}

	isAttached(sessionId: string): boolean {
		return this.attach.isAttached(sessionId);
	}

	attachedSessionIdList(): string[] {
		return this.attach.ids();
	}

	/**
	 * Engine host crashed/exited: fail any in-flight turn visibly (no silent resume).
	 * Unix lease drop (`failTurns: false`) only clears Attach so the next Hello
	 * re-Attaches — host is still running the turn.
	 */
	markEngineLost(reason: string, opts?: {failTurns?: boolean}): void {
		this.glue.markEngineLost(reason, opts);
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
			this.attach.isAttached(task.sessionId)
		);
	}

	gate(): ComposerGate {
		const task = this.getActiveTask();
		if (!task) return composerGate(createTranscriptState(), false);
		return goalBusyGatePatch(task, composerGate(task.transcript, this.sessionReady()));
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
	private cancelRunForTask = (task: TaskRecord, reason: string): boolean =>
		this.commands.cancelRunForTask(task, reason);

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
		this.catalog.syncFromTask(task);
	}

	/**
	 * Open Tab / Register reconcile: Bind+Attach a Task's Session.
	 * Default `focus: false` does not move activeTaskId (background Open Tabs).
	 * Close Tab still does not Detach (option B) — this only (re)claims slot I/O.
	 */
	ensureLive(taskId: string, opts?: {focus?: boolean}): TaskRecord | null {
		return this.glue.ensureLive(taskId, opts);
	}

	selectTask(taskId: string): TaskRecord | null {
		return this.ensureLive(taskId, {focus: true});
	}

	sendMessage(
		text: string,
		mentions?: MentionChip[],
		expectedTaskId?: string | null,
		images?: Array<{mediaType: string; data: string; name?: string}>
	): boolean {
		return this.glue.sendMessage(text, mentions, expectedTaskId, images);
	}

	private stashPendingUserImages(
		clientMessageId: string,
		images?: Array<{mediaType: string; data: string; name?: string}>
	): void {
		const sid = this.getActiveTask()?.sessionId;
		if (!sid || !clientMessageId || !images?.length) return;
		const byClient = this.pendingUserImagesBySession.get(sid) ?? new Map();
		byClient.set(
			clientMessageId,
			images.map(i => ({
				mediaType: i.mediaType,
				...(i.name ? {name: i.name} : {}),
				dataUrl: `data:${i.mediaType};base64,${i.data}`
			}))
		);
		this.pendingUserImagesBySession.set(sid, byClient);
	}

	/** Consume pending composer images for one client message (live bubble paint). */
	takePendingUserImages(sessionId: string | null | undefined, clientMessageId?: string | null) {
		if (!sessionId || !clientMessageId) return undefined;
		const byClient = this.pendingUserImagesBySession.get(sessionId);
		if (!byClient) return undefined;
		const imgs = byClient.get(clientMessageId);
		if (!imgs) return undefined;
		byClient.delete(clientMessageId);
		if (byClient.size === 0) this.pendingUserImagesBySession.delete(sessionId);
		return imgs;
	}

	requestMentionSuggest = (prefix: string, requestId: string, kinds?: string[]): boolean =>
		this.commands.requestMentionSuggest(prefix, requestId, kinds);

	/** True while a Chat turn owns the transcript (not Goal-track-only busy). */
	private chatTurnActive(): boolean {
		const task = this.getActiveTask();
		if (!task) return false;
		return composerGate(task.transcript, false).runState !== 'idle';
	}

	/** Catalog + host-seed skill names eligible for SkillSlash (excludes available:false). */
	private availableSkillNames(): string[] {
		return this.slashModule.availableSkillNames();
	}

	private describeSendBlocker(): string {
		return this.glue.describeSendBlocker();
	}

	/** Match Composer chrome: supportsThinking models default thinking On when sticky unset. */
	private submitThinking(): boolean | undefined {
		return this.catalog.submitThinking();
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
		return Boolean(this.composer.submitUserText('', undefined, {planId: id, name: name.trim()}));
	}

	/** Error-card Retry. Engine stops leftover work in the session, then replays lastSubmit. */
	rerunRun = (runId: string): boolean => this.commands.rerunRun(runId);

	/** Bump conversation recency without moving frozen `listOrder`. */
	private touchLastModified(task: TaskRecord): void {
		task.lastModified = new Date(this.now()).toISOString();
		this.tasks.set(task.id, task);
	}

	private canSubmitCommand(): boolean {
		const task = this.getActiveTask();
		if (!task?.sessionId) return false;
		return this.attach.isAttached(task.sessionId);
	}

	/** sessionId for Bridge `{type:command}` (catalog refresh + SkillSlash). */
	private commandSessionId(): string | undefined {
		const task = this.getActiveTask();
		if (task?.sessionId && this.attach.isAttached(task.sessionId)) {
			return task.sessionId;
		}
		// Prefer any attached session so silent `/skills` still pins a workspace.
		return this.attach.first();
		return task?.sessionId ?? undefined;
	}

	/**
	 * Host menu can list disk skills while an old Engine still returns bare
	 * `Unknown command` (no SkillSlash detail). Only then hint about a stale Engine.
	 */
	private enrichSkillCommandError(commandName: string | undefined, message: string): string {
		return this.slashModule.enrichSkillCommandError(commandName, message);
	}

	requestModelList(): boolean {
		return this.catalog.requestModelList(this.commandSessionId(), sessionId =>
			this.composer.sendPinnedCommand('model', '', sessionId)
		);
	}

	applyProviderCatalog(entries: ModelCatalogEntry[]): void {
		this.catalog.applyProviderCatalog(entries);
	}

	selectModel(modelId: string): boolean {
		const pick = this.catalog.selectModel(modelId);
		if (!pick) return false;
		const sessionId = this.commandSessionId();
		if (sessionId) {
			this.composer.sendPinnedCommand('model', pick.resolvedId, sessionId);
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
		const k = parseEngineKind(kind);
		if (!this.availableIds.has(k)) return false;
		const active = this.getActiveTask();
		const target = expectedTaskId
			? (this.tasks.get(expectedTaskId) ?? this.taskBySessionId(expectedTaskId) ?? null)
			: active;
		if (expectedTaskId && !target) return false;
		const sessionId = target?.sessionId ?? this.commandSessionId();
		// Picker is the next-turn promise. Submit still carries engineKind.
		// Idle SetEngine rebinds so session.models / skill.list hit DSH
		// before the first submit. Chrome ignores a stale command_result.
		if (sessionId) {
			this.lifecycle.stageEngineChange(sessionId, k);
			this.sendFn({type: 'SetEngine', sessionId, kind: k});
		}
		if (target && target.id !== active?.id) {
			target.engineKind = k;
			this.tasks.set(target.id, target);
		}
		this.applyEngineKind(k);
		return true;
	}

	/** Rebind after DSH registers — pick may have landed while only Fast was live. */
	rebindPickedEngine(): void {
		const k = this.engineKind;
		const sessionId = this.commandSessionId();
		if (!sessionId || !this.availableIds.has(k)) return;
		this.lifecycle.stageEngineChange(sessionId, k);
		this.sendFn({type: 'SetEngine', sessionId, kind: k});
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
		return this.catalog.healDefaultModelDisplay(model, display);
	}

	/** Keep controller chrome + active Task model in lockstep. */
	private applyModel(model: string, modelDisplay: string): void {
		this.catalog.applyModel(model, modelDisplay);
	}

	private applyRunMode(mode: TaskRecord['runMode']): void {
		this.catalog.applyRunMode(mode);
	}

	private applyEngineKind(kind: TaskRecord['engineKind']): void {
		this.catalog.applyEngineKind(kind);
	}

	private applySampling(effort?: string, thinking?: boolean): void {
		this.catalog.applySampling(effort, thinking);
	}

	/**
	 * @deprecated Host queue is projection-only (E4). Busy send uses SubmitUserMessage.
	 * Kept as a no-op false so legacy call sites fail closed.
	 */
	enqueue(_text: string, _mentions?: MentionChip[]): boolean {
		return false;
	}

	removeQueueItem = (itemId: string): boolean => this.commands.removeQueueItem(itemId);

	clearQueue = (): boolean => this.commands.clearQueue();

	reorderQueue = (fromIndex: number, toIndex: number): boolean =>
		this.commands.reorderQueue(fromIndex, toIndex);

	editQueueItem = (itemId: string, text: string): boolean =>
		this.commands.editQueueItem(itemId, text);

	setQueuePaused = (paused: boolean): boolean => this.commands.setQueuePaused(paused);

	dshSteer = (text: string): boolean => this.commands.dshSteer(text);

	dshGoalAct = (action: 'pause' | 'resume' | 'complete' | 'clear'): boolean =>
		this.commands.dshGoalAct(action);

	interruptQueueItem = (itemId: string): boolean => this.commands.interruptQueueItem(itemId);

	decideApproval = (approvalId: string, approved: boolean, reason?: string): boolean =>
		this.commands.decideApproval(approvalId, approved, reason);

	answerQuestion = (questionId: string, answer: string): boolean =>
		this.commands.answerQuestion(questionId, answer);

	answerQuestionBatch = (rpcId: string, payload: AnswerBatchPayload): boolean =>
		this.commands.answerQuestionBatch(rpcId, payload);

	cancelRun = (reason = 'cancelled by user'): boolean => this.commands.cancelRun(reason);

	killProc = (procId: string, reason = 'user_stopped', sessionId?: string): boolean =>
		this.commands.killProc(procId, reason, sessionId);

	// ── ②′ Goal card actions (single human gate surface) ────────────────────

	/** One gesture: optional card edits ride as ConfirmGoal.patchJson (patch → freeze → start). */
	confirmGoal = (patchJson?: string): boolean => this.commands.confirmGoal(patchJson);

	pauseGoal = (goalId?: string): boolean => this.commands.pauseGoal(goalId);

	cancelGoal = (goalId?: string): boolean => this.commands.cancelGoal(goalId);

	/** Paused → running (ResumeGoal); blocked goals go through escalateGoal('resume'). */
	resumeGoal = (goalId?: string): boolean => this.commands.resumeGoal(goalId);

	steerGoal = (note: string, goalId?: string): boolean => this.commands.steerGoal(note, goalId);

	escalateGoal = (action: 'resume' | 'fail'): boolean => this.commands.escalateGoal(action);

	/** Completion card acknowledge — UI only (goal row already terminal). */
	dismissGoalCard = (): boolean => this.commands.dismissGoalCard();

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
		goalLeaseCleanup(task);
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
		return this.eventHost.consumeCompletionCue();
	}

/** Single entry point: host branches (may stop short) then stream projection (K19). */
	handleEvent(event: BridgeEvent): TaskRecord | null {
		return this.eventHost.handleEvent(event);
	}

	private taskBySessionId(sessionId: string): TaskRecord | null {
		for (const task of this.tasks.values()) {
			if (task.sessionId === sessionId) return task;
		}
		return null;
	}

	resyncAttached(): void {
		resyncSessionAttach(this.attach, sessionId => this.taskBySessionId(sessionId), (task, sessionId, lastEventSeq) =>
			this.requestAttach(task, sessionId, lastEventSeq)
		);
	}

	private requestAttach(task: TaskRecord, sessionId: string, lastEventSeq = 0): boolean {
		return requestSessionAttach({
			tasks: this.tasks,
			task,
			sessionId,
			lastEventSeq,
			send: cmd => this.sendFn(cmd),
			clientId: this.clientId,
			attach: this.attach,
			settleTask: t => this.tasks.set(t.id, t)
		});
	}

	/**
	 * Request older Turns before the oldest currently loaded Turn (ADR-0012).
	 * Single-flight: ignores while a page for this Session is already in flight.
	 */
	requestOlderHistory = (): boolean => this.commands.requestOlderHistory();

	/** Ask Engine for disk sessions so the project conversation list can hydrate. */
	requestSessionsList = (): boolean => this.commands.requestSessionsList();

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

	hydrateFromMeta(sessions: SessionMetaInfo[]): void {
		this.glue.hydrateFromMeta(sessions);
	}

	detachAll(): void {
		detachAllSessions(
			this.attach,
			[...this.tasks.values()].map(task => task.sessionId),
			this.sendFn,
			this.clientId
		);
	}

	tickHeartbeat(): boolean {
		return heartbeatAttached(this.attach, this.sendFn, this.clientId, this.now());
	}

	reset(): void {
		this.rejectPendingDeletes('Engine reset');
		this.leaseWatch.dispose();
		this.lifecycle.reset();
		this.activeTaskId = null;
		this.attach.clear();
		this.slashModule.reset();
		this.composer.resetComposerState();
		this.catalog.resetCatalog();
		this.helpNotice = null;
	}

	private rejectPendingDeletes(notice: string): void {
		this.lifecycle.rejectPendingDeletes(notice);
	}
}
