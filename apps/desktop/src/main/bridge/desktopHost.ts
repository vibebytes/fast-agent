/**
 * DesktopHost — product InvokeChannels implementation (no Electron import).
 * Pet / locale channels stay in the host entry; window/tray/media protocol stay there too.
 */
import {dirname, join} from 'node:path';
import type {InvokeChannel, InvokeChannels} from '@fast-ide/session-view';
import {classifyProbeError, probeBridge} from '@fastllm/bridge-client';
import type {WorkspaceHub, WorkspaceProjectHandlers} from './WorkspaceHub.js';
import type {TaskCommands} from './SessionController.js';
import {getDshModels, selectDshModel} from './dsh/models.js';
import {settingsCall} from './dsh/settings.js';
import {listDshSkills} from './dsh/skills.js';
import type {createUiPublisher} from './uiPublisher.js';
import {
	CONNECT_DEADLINE_MS,
	LOCAL_EDGE_ID,
	deleteServer,
	edgeUrl,
	edgesPath,
	isLoopbackHost,
	loadEdgesFile,
	openToken,
	publicServers,
	remoteConnection,
	saveEdgesFile,
	upsertServer,
	type TokenVault
} from '../remoteEdges.js';

export type ProductInvokeChannel = Exclude<
	InvokeChannel,
	'pet:getVisible' | 'pet:setVisible' | 'locale:getSystem' | 'locale:set'
>;

type Handler<C extends ProductInvokeChannel> = (
	...args: InvokeChannels[C]['args']
) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>;

export type ProductInvokeMap = {
	[C in ProductInvokeChannel]: Handler<C>;
};

export type UiPublisher = ReturnType<typeof createUiPublisher>;

export type DesktopHostDeps = {
	hub: WorkspaceHub;
	publisher: UiPublisher;
	getRestoreState: () => {done: boolean; failed: boolean; reason?: string};
	startHeartbeat: () => void;
	stopHeartbeat: () => void;
	/** Open a folder Project (validates Default path, Hub open, publish). */
	openProjectPath: (workspaceRoot: string) => void;
	projectHandlers: () => WorkspaceProjectHandlers;
	pickDirectory: () => Promise<string | null>;
	documentsDir: () => string;
	pathExists: (path: string) => boolean;
	mkdirp: (path: string) => void;
	showInFolder: (path: string) => void;
	readMedia: (
		root: string,
		relativePath: string
	) => Promise<InvokeChannels['fs:readMedia']['result']>;
	vault?: TokenVault;
	userData?: () => string;
	onEdgesChanged?: () => void;
	/** Engine pairing export via GetBridgePairing; null/undefined uses the engine-off empty. */
	mobilePairing?: () => Promise<InvokeChannels['mobile:pairingInfo']['result']> | InvokeChannels['mobile:pairingInfo']['result'] | null;
	setLanPairing?: (enabled: boolean) => Promise<InvokeChannels['mobile:setLanPairing']['result']>;
	probe?: typeof probeBridge;
};

function activeFsRoot(hub: WorkspaceHub): string | null {
	const active = hub.getActive();
	if (!active) return null;
	return active.cwd ?? active.path;
}

function activeCommands(hub: WorkspaceHub): TaskCommands | null {
	return hub.getActive()?.sessions ?? null;
}

async function writeEngineAndPublish(
	hub: WorkspaceHub,
	publisher: UiPublisher,
	type: Parameters<WorkspaceHub['writeEngine']>[0],
	id: string
): Promise<Awaited<ReturnType<WorkspaceHub['writeEngine']>>> {
	const res = await hub.writeEngine(type, id);
	if (res.ok) publisher.publishTasksMeta();
	return res;
}

export function createDesktopHost(deps: DesktopHostDeps): ProductInvokeMap {
	const {
		hub,
		publisher,
		getRestoreState,
		startHeartbeat,
		stopHeartbeat,
		openProjectPath,
		projectHandlers,
		pickDirectory,
		documentsDir,
		pathExists,
		mkdirp,
		showInFolder,
		readMedia,
		vault,
		userData,
		onEdgesChanged,
		probe = probeBridge
	} = deps;

	const edgesFile = () => loadEdgesFile(edgesPath(userData?.() ?? ''));
	const persistEdges = (file: ReturnType<typeof loadEdgesFile>) => {
		if (!userData) return;
		saveEdgesFile(edgesPath(userData()), file);
		onEdgesChanged?.();
	};
	const edgesList = (): InvokeChannels['edges:list']['result'] => {
		const snap = hub.edgeSnapshot();
		return {
			activeId: snap.activeId,
			pendingEdgeId: snap.pendingEdgeId,
			servers: userData ? publicServers(edgesFile()) : [],
			capabilities: snap.capabilities,
			hostHome: snap.hostHome,
			runActive: hub.hasInFlightRuns()
		};
	};

	const refusePending = (): InvokeChannels['edges:upsert']['result'] | null => {
		if (!hub.edgeSnapshot().pendingEdgeId) return null;
		return {ok: false, code: 'pending', message: 'Edge switch in progress'};
	};

	const remoteOptsFor = (
		row: Parameters<typeof remoteConnection>[0]
	) => remoteConnection(row, vault);

	return {
		'workspace:checkRestore': () => getRestoreState(),

		'project:open': async () => {
			if (hub.isRemote()) return null;
			const path = await pickDirectory();
			if (!path) return null;
			openProjectPath(path);
			return path;
		},

		'project:openRemote': async (serverPath: string) => {
			if (!hub.isRemote() || hub.edgeSnapshot().pendingEdgeId) return null;
			const snap = await hub.openRemoteProject(serverPath, projectHandlers());
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return snap.path;
		},

		'project:createBlank': async (name?: string) => {
			if (hub.isRemote()) return null;
			const trimmed = name?.trim() || 'New project';
			const safe =
				trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'New project';
			const documents = documentsDir();
			let root = join(documents, safe);
			if (pathExists(root)) {
				let n = 2;
				while (pathExists(join(documents, `${safe} ${n}`))) n += 1;
				root = join(documents, `${safe} ${n}`);
			}
			mkdirp(root);
			openProjectPath(root);
			return root;
		},

		'project:get': () => {
			const active = hub.getActive();
			const engine = hub.getEngineStatus();
			return {
				path: active?.path ?? null,
				projects: hub.listProjects(),
				activeProjectId: active?.id ?? null,
				projectTasks: publisher.buildProjectTaskLists(),
				projectTasksHydrated: publisher.buildProjectTasksHydrated(),
				engineStatus: engine.status,
				engineError: engine.error ?? null,
				bridgeConnectionId: hub.connectionId() ?? null
			};
		},

		'project:gitStatus': async (force?: boolean) => hub.gitWorkspaceStatus(force),

		'project:focus': (projectId: string) => {
			const ok = hub.focusProject(projectId);
			if (ok) {
				startHeartbeat();
				publisher.publishFocusChange();
			}
			return ok;
		},

		'project:close': (projectId: string) => {
			const ok = hub.closeProject(projectId);
			if (!hub.getActive()) stopHeartbeat();
			else startHeartbeat();
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return ok;
		},

		'project:showInFolder': (projectId: string) => {
			const project = hub.getById(projectId);
			if (!project) return false;
			showInFolder(project.path);
			return true;
		},

		'project:rename': (projectId: string, displayName: string) => {
			const trimmed = String(displayName ?? '').trim();
			if (!trimmed) return {ok: false as const, notice: 'Name required'};
			const project = hub.getById(projectId);
			if (!project) return {ok: false as const, notice: 'Project not found'};
			if (!project.metaProjectId) {
				return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
			}
			const ok = hub.renameProjectDisplayName(projectId, trimmed);
			return ok
				? {ok: true as const}
				: {ok: false as const, notice: 'Failed to send rename to Engine'};
		},

		'settings:get': (scope, scopeId) => hub.getSettings(scope, scopeId),
		'settings:patch': (scope, namespace, patch, scopeId) =>
			hub.patchSettings(scope, namespace, patch, scopeId),

		'providers:list': () => hub.listProviders(),
		'providers:upsert': input => hub.upsertProvider(input),
		'providers:delete': (id: string) => hub.deleteProvider(id),
		'providers:setEnabled': (id: string, enabled: boolean) => hub.setProviderEnabled(id, enabled),
		'providers:test': (id: string) => hub.testProvider(id),
		'providers:patchModels': (id, patch) => hub.patchProviderModels(id, patch),
		'providers:searchModels': (id: string, query: string) => hub.searchProviderModels(id, query),

		'skills:list': () => hub.listSkills(),
		'skills:create': input => hub.createSkill(input),
		'skills:delete': (name: string, scope: string) => hub.deleteSkill(name, scope),
		'skills:setEnabled': (name: string, scope: string, enabled: boolean) =>
			hub.setSkillEnabled(name, scope, enabled),
		'skills:searchMarket': (query: string) => hub.searchSkillMarket(query),
		'skills:installMarket': (source: string, scope: string) =>
			hub.installSkillFromMarket(source, scope),
		'skills:uninstallMarket': (name: string, scope: string) =>
			hub.uninstallSkillFromMarket(name, scope),

		'extensions:list': () => hub.listExtensions(),
		'extensions:status': (id: string) => hub.extensionStatus(id),
		'extensions:install': (dir: string) => hub.installExtension(dir),
		'extensions:uninstall': (id: string) => hub.uninstallExtension(id),
		'extensions:pickDir': () => pickDirectory(),

		'engines:list': async () => {
			const res = await hub.listEngines();
			if (res.ok) publisher.publishTasksMeta();
			return res;
		},
		'engines:enable': id => writeEngineAndPublish(hub, publisher, 'EnableEngine', id),
		'engines:disable': id => writeEngineAndPublish(hub, publisher, 'DisableEngine', id),
		'engines:start': id => writeEngineAndPublish(hub, publisher, 'StartEngine', id),
		'engines:stop': id => writeEngineAndPublish(hub, publisher, 'StopEngine', id),
		'engines:setDefault': id => writeEngineAndPublish(hub, publisher, 'SetDefaultEngine', id),
		'engines:install': id => writeEngineAndPublish(hub, publisher, 'InstallEngine', id),
		'engines:uninstall': id => writeEngineAndPublish(hub, publisher, 'UninstallEngine', id),
		'engines:cancelInstall': id => writeEngineAndPublish(hub, publisher, 'CancelEngineInstall', id),

		'rules:list': (projectId: string) => hub.listRules(projectId),
		'rules:add': (projectId: string, text: string) => hub.addProjectRule(projectId, text),
		'rules:remove': (projectId: string, ruleId: string) => hub.removeRule(projectId, ruleId),
		'rules:setEnabled': (projectId: string, ruleId: string, enabled: boolean) =>
			hub.setRuleEnabled(projectId, ruleId, enabled),

		'review:list': (projectId: string, checkpointId?: string | null, sessionId?: string | null) =>
			hub.listReviewChanges(projectId, checkpointId, sessionId),
		'review:change': (projectId: string, changeId: string) => hub.getReviewChange(projectId, changeId),
		'review:diff': (projectId: string, sinceRevision?: number) =>
			hub.listReviewDiff(projectId, sinceRevision),
		'review:fileDiff': (projectId: string, path: string) => hub.getFileReviewDiff(projectId, path),
		'review:keep': (projectId: string, changeIds: string[], revision: number) =>
			hub.keepReviewChanges(projectId, changeIds, revision),
		'review:preview': (projectId, input) => hub.previewRevert(projectId, input),
		'review:apply': (projectId: string, previewId: string, force?: boolean) =>
			hub.applyRevert(projectId, previewId, force),
		'review:redo': (projectId: string, restoreId: string) => hub.redoRevert(projectId, restoreId),

		'schedule:list': (projectId?: string | null) => hub.listScheduledJobs(projectId),
		'schedule:listLiving': () => hub.listLivingTasks(),
		'schedule:create': input => hub.createScheduledJob(input),
		'schedule:pause': (id: string) => hub.pauseScheduledJob(id),
		'schedule:resume': (id: string) => hub.resumeScheduledJob(id),
		'schedule:cancel': (id: string) => hub.cancelScheduledJob(id),
		'schedule:fireNow': (id: string) => hub.fireNowScheduledJob(id),
		'schedule:updateCron': (id: string, cronExpr: string, timezone?: string) =>
			hub.updateScheduledJobCron(id, cronExpr, timezone),
		'schedule:listRuns': (id: string) => hub.listScheduledJobRuns(id),

		'teams:list': (projectId?: string | null) => hub.listTeams(projectId),
		'teams:listGoals': (projectId?: string | null, status?: string | null) =>
			hub.listGoals(projectId, status),
		'teams:listAgents': (projectId?: string | null, opts?: {includeArchived?: boolean}) =>
			hub.listAgents(projectId, opts),
		'teams:create': input => hub.createTeam(input),
		'teams:update': input => hub.updateTeam(input),
		'teams:archive': (teamId: string) => hub.archiveTeam(teamId),
		'teams:unarchive': (teamId: string) => hub.unarchiveTeam(teamId),
		'teams:get': (teamId: string) => hub.getTeam(teamId),
		'teams:getGoal': (goalId: string) => hub.getGoal(goalId),
		'teams:createAgent': input => hub.createAgent(input),
		'teams:updateAgent': input => hub.updateAgent(input),
		'teams:archiveAgent': (agentId: string) => hub.archiveAgent(agentId),
		'teams:unarchiveAgent': (agentId: string) => hub.unarchiveAgent(agentId),
		'teams:cloneAgent': input => hub.cloneAgent(input),
		'teams:getAgent': (agentId: string) => hub.getAgent(agentId),
		'teams:delete': (teamId: string) => hub.deleteTeam(teamId),
		'teams:saveAs': input => hub.saveAsTeam(input),
		'teams:promote': input => hub.promoteTeam(input),
		'teams:deleteAgent': (agentId: string) => hub.deleteAgent(agentId),
		'teams:stopAgentRun': (agentId: string) => hub.stopAgentRun(agentId),
		'teams:deleteGoal': (goalId: string) => hub.deleteGoal(goalId),

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

		'task:send': (text: string, mentions?, expectedTaskId?: string | null) => {
			const sessions = activeCommands(hub);
			if (!sessions) return {ok: false};
			const ok = sessions.sendMessage(text, mentions, expectedTaskId);
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

		'engine:diagnostics': () => hub.bridgeDiagnostics(),

		'dsh:call': (method, payload, sessionId) => hub.dshCall(method, payload, sessionId),
		'dsh:models': sessionId => getDshModels(hub.dshCall.bind(hub), sessionId),
		'dsh:selectModel': input => selectDshModel(hub.dshCall.bind(hub), input),
		'dsh:skills': sessionId => listDshSkills(hub.dshCall.bind(hub), sessionId),
		'dsh:settings': op => settingsCall(hub.dshCall.bind(hub), op),

		'host:listDir': path => hub.listHostDir(path),
		'host:createDir': (parent, name) => hub.createHostDir(parent, name),

		'edges:list': () => edgesList(),

		'edges:get': id => {
			if (!userData || id === LOCAL_EDGE_ID) return null;
			const row = edgesFile().servers.find(s => s.id === id);
			if (!row) return null;
			return {
				id: row.id,
				name: row.name,
				ip: row.ip,
				port: row.port,
				token: openToken(row.token, vault),
				fingerprint: row.fingerprint,
				caPem: row.caPem,
				insecureSkipVerify: row.insecureSkipVerify
			};
		},

		'edges:upsert': async input => {
			const blocked = refusePending();
			if (blocked) return blocked;
			if (!userData) return {ok: false, code: 'error', message: 'No userData'};
			if (vault && !vault.isEncryptionAvailable()) {
				console.warn('safeStorage unavailable; remote edge token stored as plaintext (0600)');
			}
			const probed = await probe({
				url: edgeUrl(input.ip, input.port),
				authToken: input.token,
				fingerprint: input.fingerprint,
				caPem: input.caPem,
				timeoutMs: CONNECT_DEADLINE_MS
			});
			if (!probed.ok) return probed;
			try {
				const next = upsertServer(
					edgesFile(),
					{...input, fingerprint: input.fingerprint ?? probed.fingerprint, insecureSkipVerify: undefined},
					vault
				);
				persistEdges(next.file);
				return {ok: true, id: next.id};
			} catch (error) {
				return {
					ok: false,
					code: 'error',
					message: error instanceof Error ? error.message : String(error)
				};
			}
		},

		'edges:delete': async id => {
			const blocked = refusePending();
			if (blocked) return blocked;
			if (!userData) return {ok: false, code: 'error', message: 'No userData'};
			if (id === LOCAL_EDGE_ID) return {ok: false, code: 'error', message: 'Cannot delete local'};
			if (hub.edgeSnapshot().activeId === id) {
				try {
					await hub.switchEdge({id: LOCAL_EDGE_ID}, projectHandlers());
					publisher.publishWorkspace();
					publisher.publishFocusChange();
				} catch (error) {
					const classified = classifyProbeError(error);
					return {ok: false, code: classified.code, message: classified.message};
				}
				if (hub.edgeSnapshot().activeId !== LOCAL_EDGE_ID) {
					return {ok: false, code: 'error', message: 'Failed to switch to local before delete'};
				}
			}
			persistEdges(deleteServer(edgesFile(), id));
			return {ok: true};
		},

		'edges:select': async id => {
			const file = userData ? edgesFile() : null;
			try {
				if (id === LOCAL_EDGE_ID) {
					await hub.switchEdge({id: LOCAL_EDGE_ID}, projectHandlers());
				} else {
					const row = file?.servers.find(s => s.id === id);
					if (!row) return {ok: false, code: 'error', message: 'Unknown edge'};
					if (!row.fingerprint && !row.caPem && !isLoopbackHost(row.ip)) {
						return {
							ok: false,
							code: 'unpinned',
							message: 'Server identity is not pinned. Open Settings and confirm the fingerprint.'
						};
					}
					await hub.switchEdge({id, remote: remoteOptsFor(row)}, projectHandlers());
				}
				publisher.publishWorkspace();
				publisher.publishFocusChange();
				onEdgesChanged?.();
				return {ok: true};
			} catch (error) {
				if (error instanceof Error && error.name === 'AbortError') {
					return {ok: false, code: 'aborted', message: 'aborted'};
				}
				const classified = classifyProbeError(error);
				return {ok: false, code: classified.code, message: classified.message};
			}
		},

		'edges:test': async input => {
			const blocked = refusePending();
			if (blocked) return blocked;
			return probe({
				url: edgeUrl(input.ip, input.port),
				authToken: input.token,
				fingerprint: input.fingerprint,
				caPem: input.caPem,
				timeoutMs: CONNECT_DEADLINE_MS
			});
		},

		'mobile:pairingInfo': () =>
			deps.mobilePairing?.() ?? {
				available: false,
				reason: 'engine',
				host: '',
				port: 0,
				serverUrl: '',
				token: '',
				fingerprint: ''
			},

		'mobile:setLanPairing': input =>
			deps.setLanPairing?.(input) ?? {
				available: false,
				reason: 'engine',
				host: '',
				port: 0,
				serverUrl: '',
				token: '',
				fingerprint: ''
			}
	};
}
