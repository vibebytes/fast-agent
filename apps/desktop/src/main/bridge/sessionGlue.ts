import type {MentionChip} from '@fast-ide/session-view';
import {
	applyLocalCancel,
	chromeAwaitingSettlement,
	chromeRunId,
	createTranscriptState,
	goalKeepsBusy,
	runChromeTransition
} from '@fast-ide/session-view';
import {
	createCodeChangesState,
	createComposerSend,
	createTaskLifecycle,
	parseEngineKind,
	wireUseModel,
	type SessionMetaInfo
} from '@fast-ide/session-view';
import {resolveSlashRoute} from './slashRoute.js';
import {promptLine} from './dsh/skills.js';
import {createSessionCommands} from './sessionCommands.js';
import {createSessionEventHost} from './sessionEventHost.js';
import {createSessionGoal} from './sessionGoal.js';
import {createSessionModelSettings} from './sessionModelSettings.js';
import {createSessionSlashCatalog} from './sessionSlashCatalog.js';
import {taskRunActive, type TaskRecord} from './sessionContracts.js';

/** Remaining SessionController surface; the facade casts `this as never`. */
export type SessionGlueHost = Record<string, any>;

export type SessionGlue = {
	commands: ReturnType<typeof createSessionCommands>;
	goal: ReturnType<typeof createSessionGoal>;
	lifecycle: ReturnType<typeof createTaskLifecycle<TaskRecord>>;
	composer: ReturnType<typeof createComposerSend<TaskRecord>>;
	modelSettings: ReturnType<typeof createSessionModelSettings>;
	slashModule: ReturnType<typeof createSessionSlashCatalog>;
	eventHost: ReturnType<typeof createSessionEventHost>;
	markEngineLost: (reason: string, opts?: {failTurns?: boolean}) => void;
	ensureLive: (taskId: string, opts?: {focus?: boolean}) => TaskRecord | null;
	sendMessage: (
		text: string,
		mentions?: MentionChip[],
		expectedTaskId?: string | null,
		images?: Array<{mediaType: string; data: string; name?: string}>
	) => boolean;
	hydrateFromMeta: (sessions: SessionMetaInfo[]) => void;
	describeSendBlocker: () => string;
};

export function createSessionGlue(h: SessionGlueHost): SessionGlue {
	const commands = createSessionCommands({
		getActiveTask: () => h.getActiveTask(),
		taskBySessionId: sessionId => h.taskBySessionId(sessionId),
		isAttached: sessionId => h.attach.isAttached(sessionId),
		send: command => h.sendFn(command),
		createId: () => h.createId(),
		setHelpNotice: notice => {
			h.helpNotice = notice;
		},
		workspaceId: () => h.workspaceId?.(),
		settleTask: task => h.tasks.set(task.id, task),
		onChange: () => h.onChange?.(),
		armCancelSettle: taskId => h.leaseWatch.armCancelSettle(taskId),
		composerSampling: () => h.composer.composerSampling()
	});

	const goal = createSessionGoal({
		getActiveTask: () => h.getActiveTask(),
		taskBySessionId: sessionId => h.taskBySessionId(sessionId),
		settleTask: task => h.tasks.set(task.id, task),
		onChange: () => h.onChange?.(),
		createId: () => h.createId(),
		offerCue: (task, kind, wasBusy, success) =>
			h.eventHost.offerCompletionCue(task, kind, wasBusy, success)
	});

	const buildTaskEntry = (
		id: string,
		kind: 'task' | 'chat',
		title: string,
		listOrder: number
	): TaskRecord => ({
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
		model: h.model,
		modelDisplay: h.modelDisplay,
		runMode: h.runMode,
		engineKind: h.engineKind,
		...(h.effort ? {effort: h.effort} : {}),
		...(h.thinking !== undefined ? {thinking: h.thinking} : {})
	});

	const lifecycle = createTaskLifecycle<TaskRecord>({
		createId: () => h.createId(),
		now: () => h.now(),
		send: cmd => h.sendFn(cmd),
		projectId: () => h.projectId?.(),
		workspaceId: () => h.workspaceId?.(),
		requestRegister: () => h.requestRegister?.(),
		requestAttach: (task, sessionId, attempt) => {
			h.requestAttach(task, sessionId, attempt);
		},
		selectTask: taskId => h.selectTask(taskId),
		getActiveTask: () => h.getActiveTask(),
		getActiveTaskId: () => h.activeTaskId,
		setActiveTaskId: taskId => {
			h.activeTaskId = taskId;
		},
		setActiveEngineKind: k => {
			h.catalog.applyEngineKind(k);
		},
		setHelpNotice: notice => {
			h.helpNotice = notice;
		},
		onChange: () => h.onChange?.(),
		taskBySessionId: sid => h.taskBySessionId(sid),
		taskRunActive: task => taskRunActive(task),
		cancelRunForTask: (task, reason) => {
			h.cancelRunForTask(task, reason);
		},
		forgetTask: taskId => h.leaseWatch.forgetTask(taskId),
		attachedSessionIds: h.attach,
		seqBySession: h.seqBySession,
		buildEntry: (id, kind, title, listOrder) => buildTaskEntry(id, kind, title, listOrder)
	});

	const describeSendBlocker = (): string => {
		const task = h.getActiveTask();
		if (!task) return 'errors.send.no_active_task';
		if (task.pendingNew || !task.sessionId) {
			return 'errors.send.session_starting';
		}
		if (task.pendingAttach || !h.attach.isAttached(task.sessionId)) {
			return 'errors.send.session_not_ready';
		}
		const g = h.gate();
		if (g.composerLocked) {
			return 'errors.send.composer_locked';
		}
		if (g.runState === 'stopping' || g.runState === 'running') {
			return 'errors.send.turn_running';
		}
		return 'errors.send.workspace_not_ready';
	};

	const composer = createComposerSend<TaskRecord>({
		createId: () => h.createId(),
		now: () => h.now(),
		send: cmd => h.sendFn(cmd),
		getActiveTask: () => h.getActiveTask(),
		commandSessionId: () => h.commandSessionId(),
		canSubmitNow: () => h.canSubmitNow(),
		canSubmitCommand: () => h.canSubmitCommand(),
		describeSendBlocker,
		engineKind: () => h.engineKind,
		promptLine: (name, args) => promptLine(name, args),
		selectModel: id => h.selectModel(id),
		requestModelList: () => h.requestModelList(),
		setHelpNotice: notice => {
			h.helpNotice = notice;
		},
		applyRunMode: mode => h.applyRunMode(mode),
		effort: () => h.effort,
		onClearSlash: () => {
			const task = h.getActiveTask();
			if (!task) return false;
			task.transcript = createTranscriptState();
			task.codeChanges = createCodeChangesState();
			h.tasks.set(task.id, task);
			if (task.sessionId && h.attach.isAttached(task.sessionId)) {
				h.composer.sendPinnedCommand('clear', '', task.sessionId);
			}
			return true;
		},
		touchLastModified: task => h.touchLastModified(task),
		useModelOf: (model, modelDisplay) => wireUseModel(model ?? '', modelDisplay ?? ''),
		catalogHas: ref => h.catalog.catalogHas(ref ?? ''),
		submitThinking: () => h.catalog.submitThinking(),
		titleGenRequested: h.titleGenRequested,
		seedHostSlashCatalog: () => h.slashModule.seedHostSlashCatalog(),
		slashCatalogLive: () => h.slashModule.bridgeArrived && h.slashModule.entries.length > 0,
		applyEmptySlashCatalog: () => h.slashModule.applyEmptySlashCatalog(),
		markSlashCatalogHydrated: () => {
			h.slashModule.markHydrated();
		},
		appendSkillsTranscript: message => {
			const task = h.getActiveTask();
			if (!task) return;
			task.transcript = {
				...task.transcript,
				entries: [
					...task.transcript.entries,
					{id: h.createId(), role: 'assistant', text: message, status: 'done'}
				]
			};
			h.tasks.set(task.id, task);
		}
	});

	const modelSettings = createSessionModelSettings({
		getActiveTask: () => h.getActiveTask(),
		tasks: lifecycle.tasks,
		onChange: () => h.onChange?.(),
		send: cmd => h.sendFn(cmd),
		commandSessionId: () => h.commandSessionId(),
		sendPinnedCommand: (name, args, sessionId) =>
			h.composer.sendPinnedCommand(name, args, sessionId),
		stageEngineChange: (sessionId, current) => h.lifecycle.stageEngineChange(sessionId, current)
	});

	const slashModule = createSessionSlashCatalog({
		getActiveTask: () => h.getActiveTask(),
		engineKind: () => h.modelSettings.catalog.engineKind,
		onChange: () => h.onChange?.(),
		discoverHostSkills: () => h.discoverHostSkills?.()
	});

	let ensureLiveRef: (taskId: string, opts?: {focus?: boolean}) => TaskRecord | null = () => null;

	const eventHost = createSessionEventHost({
		clientId: () => h.clientId,
		send: cmd => h.sendFn(cmd),
		createId: () => h.createId(),
		onChange: () => h.onChange?.(),
		getActiveTask: () => h.getActiveTask(),
		taskBySessionId: sessionId => h.taskBySessionId(sessionId),
		tasks: lifecycle.tasks,
		seqBySession: h.seqBySession,
		titleGenRequested: h.titleGenRequested,
		setHelpNotice: notice => {
			h.helpNotice = notice;
		},
		lifecycle,
		composer,
		attach: h.attach,
		commands: {clearHistoryInFlight: sid => h.commands.clearHistoryInFlight(sid)},
		leaseWatch: {
			syncCancelSettle: task => h.leaseWatch.syncCancelSettle(task),
			noteRunLease: (task, event) => h.leaseWatch.noteRunLease(task, event)
		},
		model: modelSettings,
		slash: slashModule,
		goal,
		requestAttach: (task, sessionId, lastEventSeq) =>
			h.requestAttach(task, sessionId, lastEventSeq),
		hydrateFromSessionsList: sessions => h.hydrateFromSessionsList(sessions),
		takePendingUserImages: (sid, clientId) => h.takePendingUserImages(sid, clientId),
		retryBind(taskId: string) {
			setTimeout(() => {
				ensureLiveRef(taskId, {focus: false});
			}, 200);
		}
	});

	const glue: SessionGlue = {
		commands,
		goal,
		lifecycle,
		composer,
		modelSettings,
		slashModule,
		eventHost,
		describeSendBlocker,
		markEngineLost(reason: string, opts?: {failTurns?: boolean}): void {
			h.leaseWatch.clearAllCancelSettle();
			h.rejectPendingDeletes(reason);
			const failTurns = opts?.failTurns ?? true;
			for (const task of h.tasks.values() as Iterable<TaskRecord>) {
				if (
					failTurns &&
					(chromeRunId(task.transcript.chrome) ||
						chromeAwaitingSettlement(task.transcript.chrome) ||
						task.transcript.entries.some((e: {status: string}) => e.status === 'streaming'))
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
				h.tasks.set(task.id, task);
			}
			h.attach.clear();
			h.leaseWatch.clearLeaseBookkeeping();
			h.onChange?.();
		},
		ensureLive(taskId: string, opts?: {focus?: boolean}): TaskRecord | null {
			const focus = opts?.focus ?? false;
			const task = h.tasks.get(taskId);
			if (!task) return null;
			if (focus) {
				h.activeTaskId = taskId;
				h.restoreChromeFromTask(task);
				// Re-arm watchdog when returning to a task still awaiting Cancel Settlement.
				h.leaseWatch.syncCancelSettle(task);
			}
			// Pending create — optional focus only; Bind/Attach wait until sessionId exists.
			if (!task.sessionId) return task;
			const workspaceId = h.workspaceId?.();
			if (!workspaceId) {
				// Never Attach before Bind — Engine would pin Sessions to boot cwd
				// ($HOME/fast_workspace). Open Tab reconcile retries after Register.
				h.requestRegister?.();
				return task;
			}
			if (h.attach.liveInFlight(task.sessionId, h.now())) return task;
			// Already bound + restored — nothing to do (focus already applied above).
			if (h.attach.isAttached(task.sessionId) && h.attach.isRestored(task.sessionId)) {
				return task;
			}
			// Background ensureLive: already Attach'd — skip; focus path may re-Attach
			// when session_restored never arrived (same as legacy selectTask).
			if (h.attach.isAttached(task.sessionId) && !focus) {
				return task;
			}
			h.attach.armBind(task.sessionId, h.now());
			h.sendFn({
				type: 'BindSessionWorkspace',
				sessionId: task.sessionId,
				workspaceId
			});
			h.requestAttach(task, task.sessionId, task.lastEventSeq);
			return task;
		},
		sendMessage(
			text: string,
			mentions?: MentionChip[],
			expectedTaskId?: string | null,
			images?: Array<{mediaType: string; data: string; name?: string}>
		): boolean {
			const active = h.getActiveTask();
			if (expectedTaskId && active?.id !== expectedTaskId && active?.sessionId !== expectedTaskId) {
				h.helpNotice = 'errors.send.task_changed';
				return false;
			}
			const trimmed = text.trim();
			if (!trimmed && !(images && images.length > 0)) {
				h.helpNotice = 'errors.send.empty_message';
				return false;
			}

			const chips = mentions && mentions.length > 0 ? mentions : undefined;
			const routed = resolveSlashRoute(trimmed, h.slashModule.availableSkillNames());
			const busyFollowUp =
				h.canEnqueue() || (goalKeepsBusy(h.getActiveTask()?.goalCard) && !h.chatTurnActive());

			if (routed.kind === 'slash') {
				const line = `/${routed.name}${routed.args ? ` ${routed.args}` : ''}`;
				// Busy skill: Bridge SkillSlash → Session Follow-up (preserves skillSlash payload).
				return h.composer.handleSlash(line);
			}

			// S2/E4: busy (Chat or Goal) → SubmitUserMessage; Session Follow-up queues.
			// SteerGoal is Goal-drawer「捎话」only — never main Enter.
			if (busyFollowUp) {
				const cid = h.composer.submitUserText(routed.text, chips, undefined, images);
				if (cid) h.stashPendingUserImages(cid, images);
				return Boolean(cid);
			}

			if (!h.canSubmitNow()) {
				h.helpNotice = describeSendBlocker();
				return false;
			}
			const cid = h.composer.submitUserText(routed.text, chips, undefined, images);
			if (cid) h.stashPendingUserImages(cid, images);
			return Boolean(cid);
		},
		hydrateFromMeta(sessions: SessionMetaInfo[]): void {
			h.lifecycle.hydrateSessions(sessions, {
				model: () => h.model,
				modelDisplay: () => h.modelDisplay,
				applyStickyChrome: (task: TaskRecord, info: SessionMetaInfo) =>
					h.catalog.applyStickyChrome(task, info),
				buildStub: (
					id: string,
					info: SessionMetaInfo,
					listOrder: number,
					model: string,
					modelDisplay: string
				): TaskRecord => ({
					id,
					title: info.title?.trim() || info.id.slice(0, 8),
					kind: 'task',
					sessionId: info.id,
					sessionType: info.sessionType ?? undefined,
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
					model,
					modelDisplay,
					runMode: 'agent',
					engineKind: parseEngineKind(info.engineKind)
				}),
				restoreChrome: (task: TaskRecord) => h.restoreChromeFromTask(task)
			});
			h.tasksHydrated = true;
		}
	};
	ensureLiveRef = (taskId, opts) => glue.ensureLive(taskId, opts);
	return glue;
}
