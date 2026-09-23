import {mkdirSync} from 'node:fs';
import path from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {EngineHostStatus, ProjectSnapshot, ProjectStatus} from '@fast-ide/session-view';
import type {BridgeClient} from '../BridgeClient.js';
import {SessionController} from '../SessionController.js';
import {discoverHostSlashSkills} from '../hostSkillDiscovery.js';
import {defaultProjectPath, defaultProjectPathOnHost} from '../defaultProject.js';
import type {WorkspaceProjectHandlers} from '../WorkspaceHub.js';
import type {WorkspaceAdopt} from './adopt.js';
import type {ComposerHeal} from './composerHeal.js';
import type {HostWait} from './hostWait.js';

export type HubProject = {
	id: string; path: string; status: ProjectStatus; error?: string; cwd?: string;
	sessions: SessionController; clientId: string; workspaceId?: string; slotLive?: boolean;
	metaProjectId?: string; displayName?: string; pendingDisplayName?: string; isDefault: boolean;
};

type RegisterWait = {resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout>};
type MintInput = {
	workspaceRoot: string;
	handlers: {onSessionsChanged?: (projectId: string) => void};
	metaProjectId?: string;
	workspaceId?: string;
	displayName?: string;
	isDefault: boolean;
};

export type ProjectsHost = {
	projects: Map<string, HubProject>;
	activeProjectId: string | null;
	hostHome?: string;
	homeDir: string;
	engineStatus: EngineHostStatus;
	bridge: BridgeClient | null;
	lastReady: Extract<BridgeEvent, {type: 'ready'}> | null;
	engineHandlers: WorkspaceProjectHandlers | null;
	createId: () => string;
	createClientId: () => string;
	registerWaitMs: number;
	registerWaiters: Map<string, Set<RegisterWait>>;
	registerFailed: Map<string, string>;
	switchAbort?: AbortController;
	pendingEdgeId: string | null;
	shuttingDown: boolean;
	rebindTimer: ReturnType<typeof setTimeout> | null;
	rebindResetTimer: ReturnType<typeof setTimeout> | null;
	lastPickerEngineIds: string[];
	lastRegistryIds: Set<string>;
	hostWait: HostWait;
	adopt: WorkspaceAdopt;
	composerHeal: ComposerHeal;
	isRemote: () => boolean;
	focusProject: (projectId: string) => boolean;
	snapshot: (p: HubProject) => ProjectSnapshot;
	ensureEngine: (handlers: WorkspaceProjectHandlers) => void;
	ensureRegistered: (project: HubProject) => void;
	stampAvailableEngines: (sessions: SessionController) => void;
	getDefaultProject: () => HubProject | null;
	failRegisterWaiters: (projectId: string | null, message: string) => void;
	dropRegisterWaiter: (projectId: string, waiter: RegisterWait) => void;
	findProjectForTask: (taskId: string) => HubProject | null;
	projectForSession: (sessionId: string | undefined) => HubProject | null;
	projectByMetaId: (metaProjectId: string) => HubProject | null;
	clearPickerRefresh: () => void;
	setEngineStatus: (status: EngineHostStatus, error?: string) => void;
};

export type WorkspaceProjects = {
	openInternal: (workspaceRoot: string, handlers: WorkspaceProjectHandlers, isDefault: boolean) => ProjectSnapshot;
	mintAdoptedProject: (input: MintInput) => HubProject;
	ensureDefaultProject: (handlers: WorkspaceProjectHandlers) => ProjectSnapshot;
	closeProject: (projectId: string) => boolean;
	closeAll: () => void;
	ensureRegisteredAsync: (project: HubProject) => Promise<void>;
	ensureTasksLive: (taskIds: string[]) => {ok: string[]; skipped: string[]};
	resolveTaskRef: (taskId: string, sessionId?: string | null) => {project: HubProject; taskId: string} | null;
	openLivingSession: (
		sessionId: string,
		metaProjectId?: string | null
	) =>
		| {ok: true; taskId: string; title: string; kind?: string; sessionId: string | null}
		| {ok: false; notice: string};
	openScheduledRun: (
		sessionId: string,
		metaProjectId: string | null | undefined,
		title: string,
		sessionType?: string | null,
		workspaceRoot?: string | null
	) =>
		| {ok: true; taskId: string; title: string; kind?: string; sessionId: string | null}
		| {ok: false; notice: string};
};

export function createProjects(h: ProjectsHost): WorkspaceProjects {
	const openInternal = (
		workspaceRoot: string, handlers: WorkspaceProjectHandlers, isDefault: boolean
	): ProjectSnapshot => {
		if (h.isRemote()) {
			throw new Error('Cannot open a local folder on a remote edge');
		}
		const existing = [...h.projects.values()].find(p => p.path === workspaceRoot);
		if (existing) {
			h.focusProject(existing.id);
			return h.snapshot(existing);
		}

		h.ensureEngine(handlers);

		const id = h.createId();
		const clientId = h.createClientId();
		const sessions = new SessionController({
			clientId,
			send: (command: BridgeCommand) => h.bridge?.send(command) ?? false,
			onChange: () => handlers.onSessionsChanged?.(id),
			workspaceId: () => h.projects.get(id)?.workspaceId,
			projectId: () => {
				const p = h.projects.get(id);
				if (!p) return undefined;
				if (p.isDefault) return p.metaProjectId ?? 'default-project';
				return p.metaProjectId;
			},
			requestRegister: () => {
				const p = h.projects.get(id);
				if (!p) return;
				if (!p.isDefault && !p.metaProjectId && h.bridge && h.engineStatus === 'ready') {
					h.bridge.send({
						type: 'CreateProject',
						projectType: 'coding',
						rootPath: p.path,
						displayName: path.basename(p.path)
					});
				}
				h.ensureRegistered(p);
			},
			discoverHostSkills: () =>
				h.isRemote() ? [] : discoverHostSlashSkills(h.projects.get(id)?.path)
		});

		const project: HubProject = {
			id,
			path: workspaceRoot,
			status: isDefault ? 'ready' : 'starting',
			sessions,
			clientId,
			isDefault,
			cwd: workspaceRoot,
			metaProjectId: isDefault ? 'default-project' : undefined,
			displayName: isDefault ? 'Default Project' : path.basename(workspaceRoot)
		};
		h.projects.set(id, project);
		h.activeProjectId = id;
		sessions.seedHostSlashCatalog();
		h.stampAvailableEngines(sessions);
		// Apply engine-level model chrome from a prior Hello ready (no sessionId path).
		if (h.lastReady) sessions.handleEvent(h.lastReady);
		if (h.engineHandlers) void h.composerHeal.refreshComposerChrome(h.engineHandlers);

		// Meta identity + optional Slot claim (I/O). Slot is not required for sidebar.
		if (!isDefault && h.engineStatus === 'ready' && h.bridge) {
			h.bridge.send({
				type: 'CreateProject',
				projectType: 'coding',
				rootPath: workspaceRoot,
				displayName: path.basename(workspaceRoot)
			});
			h.bridge.send({type: 'RegisterWorkspace', path: workspaceRoot});
		}

		return h.snapshot(project);
	};

	const mintAdoptedProject = (input: MintInput): HubProject => {
		h.ensureEngine(input.handlers as WorkspaceProjectHandlers);
		const id = h.createId();
		const clientId = h.createClientId();
		const sessions = new SessionController({
			clientId,
			send: (command: BridgeCommand) => h.bridge?.send(command) ?? false,
			onChange: () => input.handlers.onSessionsChanged?.(id),
			workspaceId: () => h.projects.get(id)?.workspaceId,
			projectId: () => h.projects.get(id)?.metaProjectId,
			requestRegister: () => {
				const p = h.projects.get(id);
				if (!p) return;
				h.ensureRegistered(p);
			},
			discoverHostSkills: () =>
				h.isRemote() ? [] : discoverHostSlashSkills(h.projects.get(id)?.path)
		});
		const project: HubProject = {
			id,
			path: input.workspaceRoot,
			status: 'ready',
			sessions,
			clientId,
			isDefault: input.isDefault,
			cwd: input.workspaceRoot,
			metaProjectId: input.metaProjectId,
			workspaceId: input.workspaceId,
			displayName: input.displayName
		};
		h.projects.set(id, project);
		sessions.seedHostSlashCatalog();
		h.stampAvailableEngines(sessions);
		return project;
	};

	const resolveTaskRef = (taskId: string, sessionId?: string | null): {project: HubProject; taskId: string} | null => {
		const byId = h.findProjectForTask(taskId);
		if (byId) return {project: byId, taskId};
		if (!sessionId) return null;
		const project = h.projectForSession(sessionId);
		if (!project) return null;
		const task =
			project.sessions.listTasks().find(t => t.sessionId === sessionId) ??
			project.sessions.listChats().find(t => t.sessionId === sessionId);
		if (!task) return null;
		return {project, taskId: task.id};
	};

	return {
		openInternal,
		mintAdoptedProject,
		resolveTaskRef,
		ensureDefaultProject(handlers: WorkspaceProjectHandlers): ProjectSnapshot {
			const existing = h.getDefaultProject();
			if (existing) {
				h.focusProject(existing.id);
				return h.snapshot(existing);
			}
			if (h.isRemote()) {
				const home = h.hostHome?.trim();
				if (!home) throw new Error('Remote host home is unknown');
				const root = defaultProjectPathOnHost(home);
				const project = h.adopt.adoptExistingFolder(
					root,
					handlers,
					'default-project',
					undefined,
					'Default Project',
					{isDefault: true, skipDisk: true}
				);
				if (!project) throw new Error('Failed to adopt remote default project');
				const row = project as HubProject;
				row.sessions.hydrateFromMeta([]);
				h.focusProject(row.id);
				return h.snapshot(row);
			}
			const root = defaultProjectPath(h.homeDir);
			mkdirSync(root, {recursive: true});
			return openInternal(root, handlers, true);
		},
		closeProject(projectId: string): boolean {
			const project = h.projects.get(projectId);
			if (!project) return false;
			const inFlight = project.sessions.isRunActive();
			project.sessions.detachAll();
			const metaId = project.metaProjectId ?? (project.isDefault ? undefined : project.id);
			if (metaId && h.bridge && h.engineStatus === 'ready' && !project.isDefault) {
				h.bridge.send({
					type: 'UpdateProjectStatus',
					projectId: metaId,
					status: 'closed'
				});
			}
			if (project.workspaceId && h.bridge && !inFlight) {
				h.bridge.send({type: 'UnregisterWorkspace', workspaceId: project.workspaceId});
			}
			h.projects.delete(projectId);
			h.registerFailed.delete(projectId);
			h.failRegisterWaiters(projectId, 'Project closed');
			if (h.activeProjectId === projectId) {
				const next =
					[...h.projects.values()].find(p => !p.isDefault)?.id ??
					h.projects.keys().next().value ??
					null;
				h.activeProjectId = (next as string | null) ?? null;
			}
			return true;
		},
		closeAll(): void {
			h.switchAbort?.abort();
			h.pendingEdgeId = null;
			h.shuttingDown = true;
			if (h.rebindTimer) {
				clearTimeout(h.rebindTimer);
				h.rebindTimer = null;
			}
			if (h.rebindResetTimer) {
				clearTimeout(h.rebindResetTimer);
				h.rebindResetTimer = null;
			}
			h.clearPickerRefresh();
			h.lastPickerEngineIds = ['fast'];
			h.lastRegistryIds = new Set(['fast']);
			h.hostWait.cancelAll();
			for (const id of [...h.projects.keys()]) {
				h.projects.get(id)?.sessions.detachAll();
				h.projects.delete(id);
			}
			h.activeProjectId = null;
			h.lastReady = null;
			h.failRegisterWaiters(null, 'Engine shutting down');
			h.bridge?.stop();
			h.bridge = null;
			h.setEngineStatus('exited');
		},
		ensureRegisteredAsync(project: HubProject): Promise<void> {
			if (project.slotLive && project.workspaceId) return Promise.resolve();
			const failed = h.registerFailed.get(project.id);
			if (failed) return Promise.reject(new Error(failed));
			h.ensureRegistered(project);
			if (project.slotLive && project.workspaceId) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const waiter: RegisterWait = {
					resolve,
					reject,
					timer: setTimeout(() => {
						h.dropRegisterWaiter(project.id, waiter);
						reject(new Error('timeout waiting for RegisterWorkspace'));
					}, h.registerWaitMs)
				};
				const waiters = h.registerWaiters.get(project.id) ?? new Set<RegisterWait>();
				waiters.add(waiter);
				h.registerWaiters.set(project.id, waiters);
			});
		},
		ensureTasksLive(taskIds: string[]): {ok: string[]; skipped: string[]} {
			const ok: string[] = [];
			const skipped: string[] = [];
			const seen = new Set<string>();
			for (const raw of taskIds) {
				const id = raw?.trim();
				if (!id || seen.has(id)) continue;
				seen.add(id);
				const resolved = resolveTaskRef(id, id);
				if (!resolved) {
					skipped.push(id);
					continue;
				}
				const {project} = resolved;
				const task = project.sessions.ensureLive(resolved.taskId, {focus: false});
				const sid = task?.sessionId;
				// No session yet, no slot hash yet, or Attach did not stick → retry later.
				if (!sid || !project.workspaceId || !project.sessions.isAttached(sid)) {
					skipped.push(id);
					continue;
				}
				ok.push(resolved.taskId);
			}
			return {ok, skipped};
		},
		openLivingSession(sessionId: string, metaProjectId?: string | null) {
			const sid = sessionId.trim();
			if (!sid) return {ok: false, notice: 'sessionId required'};

			let resolved = resolveTaskRef(sid, sid);
			if (!resolved && metaProjectId?.trim()) {
				const project = h.projectByMetaId(metaProjectId.trim());
				if (project) {
					const task =
						project.sessions.listTasks().find(t => t.sessionId === sid) ??
						project.sessions.listChats().find(t => t.sessionId === sid);
					if (task) resolved = {project, taskId: task.id};
				}
			}
			if (!resolved) {
				return {
					ok: false,
					notice: metaProjectId?.trim()
						? 'Session not in an open Project — open the folder first'
						: 'Session not found in open Projects'
				};
			}
			h.focusProject(resolved.project.id);
			const task = resolved.project.sessions.selectTask(resolved.taskId);
			if (!task) return {ok: false, notice: 'Failed to select task'};
			return {
				ok: true,
				taskId: task.id,
				title: task.title,
				kind: task.kind,
				sessionId: task.sessionId
			};
		},
		openScheduledRun(sessionId, metaProjectId, title, sessionType, workspaceRoot) {
			const sid = sessionId.trim();
			if (!sid) return {ok: false, notice: 'sessionId required'};
			const meta = metaProjectId?.trim() ?? '';
			let project = meta ? h.projectByMetaId(meta) : null;
			if (!project) {
				const root = workspaceRoot?.trim();
				const handlers = h.engineHandlers;
				if (!root || !handlers || h.isRemote()) {
					return {
						ok: false,
						notice: 'Session not in an open Project — open the folder first'
					};
				}
				try {
					openInternal(root, handlers, false);
				} catch (e) {
					return {ok: false, notice: e instanceof Error ? e.message : String(e)};
				}
				const resolved = path.resolve(root);
				project =
					(meta ? h.projectByMetaId(meta) : null) ??
					[...h.projects.values()].find(p => path.resolve(p.path) === resolved) ??
					null;
				if (project && meta && !project.metaProjectId) project.metaProjectId = meta;
			}
			if (!project) {
				return {
					ok: false,
					notice: 'Session not in an open Project — open the folder first'
				};
			}
			const kind = sessionType?.trim();
			if (!resolveTaskRef(sid, sid)) {
				project.sessions.hydrateFromMeta([
					{
						id: sid,
						title: title.trim() || sid.slice(0, 8),
						status: 'active',
						...(kind ? {sessionType: kind} : {})
					}
				]);
			}
			return this.openLivingSession(sid, meta || project.metaProjectId);
		}
	};
}
