import {dirname, join} from 'node:path';
import type {InvokeChannels} from '@fast-ide/session-view';
import type {WorkspaceHub, WorkspaceProjectHandlers} from '../WorkspaceHub.js';
import type {TaskCommands} from '../sessionContracts.js';
import type {ProductInvokeMap, UiPublisher} from '../desktopHost.js';

function activeFsRoot(hub: WorkspaceHub): string | null {
	const active = hub.getActive();
	if (!active) return null;
	return active.cwd ?? active.path;
}

function activeCommands(hub: WorkspaceHub): TaskCommands | null {
	return hub.getActive()?.sessions ?? null;
}

export function hostSession(input: {
	hub: WorkspaceHub;
	publisher: UiPublisher;
	startHeartbeat: () => void;
	projectHandlers: () => WorkspaceProjectHandlers;
	showInFolder: (path: string) => void;
	pathExists: (path: string) => boolean;
	readMedia: (
		root: string,
		relativePath: string
	) => Promise<InvokeChannels['fs:readMedia']['result']>;
}) {
	const {
		hub,
		publisher,
		startHeartbeat,
		projectHandlers,
		showInFolder,
		pathExists,
		readMedia
	} = input;
	return {
		'task:showProjectInFolder': (taskId: string) => {
			const project = hub.findProjectForTask(taskId) ?? hub.getDefaultProject();
			if (!project) return false;
			showInFolder(project.path);
			return true;
		},

		'workspace:showInFolder': (relativePath: string) => {
			const root = activeFsRoot(hub);
			if (!root) return false;
			const segments = String(relativePath ?? '')
				.replace(/\\/g, '/')
				.split('/')
				.filter(Boolean);
			if (segments.some(segment => segment === '..')) return false;
			const target = join(root, ...segments);
			// Missing file (deleted / never written) — reveal the parent so the folder still opens.
			showInFolder(pathExists(target) ? target : dirname(target));
			return true;
		},

		listWorkspaceDir: (relativePath?: string) => hub.listWorkspaceDir(relativePath),

		getWorkspaceFile: (relativePath: string) => hub.getWorkspaceFile(relativePath),

		saveWorkspaceFile: (
			relativePath: string,
			content: string,
			mtime?: number,
			bytes?: number
		) => hub.saveWorkspaceFile(relativePath, content, mtime, bytes),

		'fs:readMedia': async (relativePath: string) => {
			const root = activeFsRoot(hub);
			if (!root) {
				return {ok: false as const, error: 'No project open'};
			}
			return readMedia(root, relativePath ?? '');
		},

		'task:create': (title?: string, projectId?: string) => {
			const handlers = projectHandlers();
			if (projectId?.trim()) {
				// Folder OpenProject.id or Meta project id (Teams rows carry Meta ids).
				const project =
					hub.getById(projectId.trim()) ?? hub.projectByMetaId(projectId.trim());
				if (!project) return null;
				const ok = hub.focusProject(project.id);
				if (!ok) return null;
				startHeartbeat();
			} else {
				try {
					hub.ensureDefaultProject(handlers);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					handlers.onError('engine', message);
					return null;
				}
			}
			const sessions = activeCommands(hub);
			if (!sessions) return null;
			const task = sessions.createTask(title?.trim() || 'New task');
			// Structure (sidebar lists) then one Focus Change — do not double-push body.
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return {id: task.id, title: task.title, kind: task.kind, sessionId: task.sessionId};
		},

		'chat:create': (title?: string) => {
			const sessions = activeCommands(hub);
			if (!sessions) return null;
			const chat = sessions.createChat(title?.trim() || 'New chat');
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return {id: chat.id, title: chat.title, kind: chat.kind};
		},
		'task:select': (taskId: string, epoch?: number) => {
			const mainT0 = performance.now();
			if (epoch !== undefined && epoch < publisher.currentFocusEpoch()) {
				return null;
			}
			// LivingTask / schedule rows pass Engine sessionId; resolve to local Task id.
			const resolved = hub.resolveTaskRef(taskId, taskId);
			const project = resolved?.project ?? hub.findProjectForTask(taskId) ?? hub.getActive();
			if (!project) return null;
			const localId = resolved?.taskId ?? taskId;
			hub.focusProject(project.id);
			const sessions: TaskCommands = project.sessions;
			const selectT0 = performance.now();
			const task = sessions.selectTask(localId);
			const selectMs = Number((performance.now() - selectT0).toFixed(1));
			if (!task) return null;
			// Focus only — ADR-0005; never full publishWorkspace on switch.
			const published = publisher.publishFocusChange(epoch);
			const mainMs = Number((performance.now() - mainT0).toFixed(1));
			// Rides the IPC result; the renderer's tab.ipc trace line surfaces it.
			const trace = {
				mainMs,
				selectMs,
				publishMs: published?.publishMs ?? -1,
				focusPayloadBytes: published?.focusPayloadBytes ?? -1
			};
			return {
				id: task.id,
				title: task.title,
				kind: task.kind,
				sessionId: task.sessionId,
				trace
			};
		},

		/** Open Tab working-set Bind+Attach (no focus steal). */
		'task:ensureLive': (taskIds: string[]) => hub.ensureTasksLive(taskIds ?? []),

		'task:openLiving': (sessionId: string, metaProjectId?: string | null) => {
			const result = hub.openLivingSession(sessionId, metaProjectId);
			if (result.ok) publisher.publishFocusChange();
			return result;
		},

		'task:rename': (taskId: string, title: string) => {
			const project = hub.findProjectForTask(taskId);
			if (!project) return {ok: false as const, notice: 'Task not found'};
			const sessions: TaskCommands = project.sessions;
			const ok = sessions.renameTask(taskId, String(title ?? ''));
			publisher.publishWorkspace();
			return ok
				? {ok: true as const}
				: {ok: false as const, notice: 'Cannot rename until session is ready'};
		},

		'task:delete': async (taskId: string, sessionId?: string | null) => {
			const resolved = hub.resolveTaskRef(taskId, sessionId);
			if (!resolved) {
				// Already gone (double-confirm / hydrate remapped id after soft-delete).
				publisher.publishWorkspace();
				publisher.publishFocusChange();
				return {ok: true as const};
			}
			const sessions: TaskCommands = resolved.project.sessions;
			const result = await sessions.deleteTask(resolved.taskId);
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return result.ok
				? {ok: true as const}
				: {ok: false as const, notice: result.notice ?? 'Delete failed'};
		},

		'task:send': (text: string, mentions?, expectedTaskId?: string | null, images?) => {
			const sessions = activeCommands(hub);
			if (!sessions) return {ok: false};
			const ok = sessions.sendMessage(text, mentions, expectedTaskId, images);
			const notice = sessions.consumeHelpNotice();
			const openModelPicker = sessions.consumeOpenModelPicker();
			// Chrome only (queue/gate) + local transcript mutations (/clear).
			// Never rebuild projectTasks here — that was the send hot-path tax.
			publisher.flushContentPatchNow();
			publisher.publishTasksMeta();
			return {ok, notice: notice ?? undefined, openModelPicker: openModelPicker || undefined};
		},

		'task:buildPlan': (planId: string, name?: string) => {
			const sessions = activeCommands(hub);
			if (!sessions) return {ok: false};
			const ok = sessions.buildPlan(planId, name);
			const notice = sessions.consumeHelpNotice();
			publisher.flushContentPatchNow();
			publisher.publishTasksMeta();
			return {ok, notice: notice ?? undefined};
		},

		'mention:suggest': (prefix: string, requestId: string, kinds?) => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			return sessions.requestMentionSuggest(prefix, requestId, kinds);
		},

		'task:list': () => publisher.buildTasksSnapshot(),

		'model:list': async () => {
			await hub.refreshComposerCatalog();
			publisher.publishWorkspace();
			return true;
		},

		'slash:list': () => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			const ok = sessions.requestSlashCatalog();
			publisher.publishWorkspace();
			return ok;
		},

		'model:select': (modelId: string) => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			const ok = sessions.selectModel(modelId);
			if (ok) publisher.publishTasksMeta();
			return ok;
		},

		'mode:set': (mode: string, expectedTaskId?: string | null) => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			const ok = sessions.setRunMode(mode, expectedTaskId);
			if (ok) publisher.publishTasksMeta();
			return ok;
		},

		'engineKind:set': (kind: string, expectedTaskId?: string | null) => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			const ok = sessions.setEngineKind(kind, expectedTaskId);
			if (ok) publisher.publishTasksMeta();
			return ok;
		},

		'model:settings': (settings: {
			platform: string;
			model: string;
			effort?: string;
			thinking?: boolean;
		}) => {
			const sessions = activeCommands(hub);
			if (!sessions) return false;
			const ok = sessions.setModelSettings(settings);
			if (ok) publisher.publishTasksMeta();
			return ok;
		},

		'queue:remove': (itemId: string) => {
			const ok = activeCommands(hub)?.removeQueueItem(itemId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'queue:clear': () => {
			const ok = activeCommands(hub)?.clearQueue() ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'queue:reorder': (fromIndex: number, toIndex: number) => {
			const ok = activeCommands(hub)?.reorderQueue(fromIndex, toIndex) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'queue:edit': (itemId: string, text: string) => {
			const ok = activeCommands(hub)?.editQueueItem(itemId, text) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'queue:pause': (paused: boolean) => {
			const ok = activeCommands(hub)?.setQueuePaused(paused) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'queue:interrupt': (itemId: string) => {
			const ok = activeCommands(hub)?.interruptQueueItem(itemId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'dsh:steer': (text: string) => {
			const ok = activeCommands(hub)?.dshSteer(text) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'dshGoal:act': (action: 'pause' | 'resume' | 'complete' | 'clear') => {
			const ok = activeCommands(hub)?.dshGoalAct(action) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:approve': (approvalId: string, approved: boolean, reason?: string) => {
			const ok = activeCommands(hub)?.decideApproval(approvalId, approved, reason) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		// ②′ Goal card actions — the only Goal gate surface (never chat text).
		'goal:confirm': (patchJson?: string) => {
			const ok = activeCommands(hub)?.confirmGoal(patchJson) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:pause': (goalId?: string) => {
			const ok = activeCommands(hub)?.pauseGoal(goalId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:cancel': (goalId?: string) => {
			const ok = activeCommands(hub)?.cancelGoal(goalId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:resume': (goalId?: string) => {
			const ok = activeCommands(hub)?.resumeGoal(goalId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:steer': (note: string, goalId?: string) => {
			const ok = activeCommands(hub)?.steerGoal(note, goalId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:escalate': (action: 'resume' | 'fail') => {
			const ok = activeCommands(hub)?.escalateGoal(action) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'goal:dismiss': () => {
			const ok = activeCommands(hub)?.dismissGoalCard() ?? false;
			publisher.flushContentPatchNow();
			return ok;
		},

		'task:answer': (questionId: string, answer: string) => {
			const ok = activeCommands(hub)?.answerQuestion(questionId, answer) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:answerBatch': (
			rpcId: string,
			payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
		) => {
			const ok = activeCommands(hub)?.answerQuestionBatch(rpcId, payload) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:cancel': (reason?: string) => {
			const ok = activeCommands(hub)?.cancelRun(reason) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:rerun': (runId: string) => {
			const ok = activeCommands(hub)?.rerunRun(runId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:killProc': (procId: string, reason?: string, sessionId?: string) => {
			const ok = activeCommands(hub)?.killProc(procId, reason, sessionId) ?? false;
			publisher.publishWorkspace();
			return ok;
		},

		'task:requestOlderHistory': () => {
			return activeCommands(hub)?.requestOlderHistory() ?? false;
		},

		'engine:retry': () => {
			const handlers = projectHandlers();
			hub.ensureEngine(handlers);
			publisher.publishWorkspace();
			if (hub.getEngineStatus().status === 'ready') startHeartbeat();
			return true;
		},
	} satisfies Partial<ProductInvokeMap>;
}
