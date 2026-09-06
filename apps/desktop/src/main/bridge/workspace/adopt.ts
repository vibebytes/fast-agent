import {existsSync} from 'node:fs';
import path from 'node:path';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {SessionController} from '../SessionController.js';
import {isReservedDefaultFolder, sameRemotePath} from '../remotePaths.js';
import {defaultProjectPath, defaultProjectPathOnHost, isDefaultProjectPath} from '../defaultProject.js';
import {projectHash} from '../projectHash.js';

export type CommandResult = Extract<BridgeEvent, {type: 'command_result'}>;
export type WorkspaceMetaEvent = Extract<BridgeEvent, {type: 'workspace_meta'}>;
export type SessionsListEvent = Extract<BridgeEvent, {type: 'sessions_list'}>;

export type AdoptHandlers = {
	onEvent: (projectId: string, event: BridgeEvent) => void;
	onError: (
		projectId: string,
		message: string,
		meta?: {code?: string; params?: Record<string, string | number>}
	) => void;
	onSessionsChanged?: (projectId: string) => void;
};

export type AdoptProject = {
	id: string;
	path: string;
	status: string;
	error?: string;
	cwd?: string;
	sessions: SessionController;
	workspaceId?: string;
	slotLive?: boolean;
	metaProjectId?: string;
	displayName?: string;
	pendingDisplayName?: string;
	isDefault: boolean;
};

export type AdoptHost = {
	isRemote: () => boolean;
	hostHome: () => string | undefined;
	homeDir: () => string;
	projects: () => Iterable<AdoptProject>;
	projectById: (id: string) => AdoptProject | undefined;
	getActive: () => AdoptProject | null;
	getDefault: () => AdoptProject | null;
	ensureDefault: (handlers: AdoptHandlers) => void;
	settleRegister: (project: AdoptProject) => void;
	claimSlot: (project: AdoptProject) => void;
	failRegister: (projectId: string | null, message: string) => void;
	noteRegisterFailed: (projectId: string, message: string) => void;
	hasRegisterFailed: (projectId: string) => boolean;
	mintAdopted: (input: {
		workspaceRoot: string;
		handlers: AdoptHandlers;
		metaProjectId?: string;
		workspaceId?: string;
		displayName?: string;
		isDefault: boolean;
	}) => AdoptProject;
	pendingSessions: Set<string>;
	requestSessionsList: (project: AdoptProject) => void;
};

export type WorkspaceAdopt = {
	applyWorkspaceMeta: (event: WorkspaceMetaEvent, handlers: AdoptHandlers) => void;
	adoptExistingFolder: (
		workspaceRoot: string,
		handlers: AdoptHandlers,
		metaProjectId?: string,
		pathHash?: string | null,
		displayName?: string | null,
		opts?: {isDefault?: boolean; skipDisk?: boolean}
	) => AdoptProject | undefined;
	handleRegisterResult: (event: CommandResult, handlers: AdoptHandlers) => void;
	handleCreateSessionResult: (event: CommandResult, handlers: AdoptHandlers) => void;
	handleSessionsList: (event: SessionsListEvent, handlers: AdoptHandlers) => void;
	handleCreateProjectResult: (event: CommandResult, handlers: AdoptHandlers) => void;
	handleSetProjectDisplayNameResult: (event: CommandResult, handlers: AdoptHandlers) => void;
	handleCommand: (event: CommandResult, handlers: AdoptHandlers) => boolean;
};

/** ink / EnsureProject probe tmp — Meta may keep a pathHash after the dir is gone. */
export function isEchoProbePath(p: string): boolean {
	return /queue-echo-probe-/.test(p);
}

function registerMissingDir(message: string): string | undefined {
	const m = /^not a directory:\s*(.+)$/.exec(message.trim());
	const dir = m?.[1]?.trim();
	return dir || undefined;
}

function field<T extends string>(event: CommandResult, key: T): string | undefined {
	return key in event && typeof (event as Record<T, unknown>)[key] === 'string'
		? (event as Record<T, string>)[key]
		: undefined;
}

export function createAdopt(host: AdoptHost): WorkspaceAdopt {
	const adoptExistingFolder = (
		workspaceRoot: string,
		handlers: AdoptHandlers,
		metaProjectId?: string,
		pathHash?: string | null,
		displayName?: string | null,
		opts?: {isDefault?: boolean; skipDisk?: boolean}
	): AdoptProject | undefined => {
		const skipDisk = Boolean(opts?.skipDisk || host.isRemote());
		const existing = [...host.projects()].find(p =>
			skipDisk ? sameRemotePath(p.path, workspaceRoot) : path.resolve(p.path) === workspaceRoot
		);
		const stamp =
			pathHash && (isEchoProbePath(workspaceRoot) || pathHash === projectHash(workspaceRoot))
				? pathHash
				: undefined;
		if (existing) {
			if (metaProjectId) existing.metaProjectId = metaProjectId;
			if (stamp) existing.workspaceId = stamp;
			existing.displayName = displayName?.trim() || path.basename(workspaceRoot);
			existing.status = 'ready';
			if (opts?.isDefault) existing.isDefault = true;
			host.claimSlot(existing);
			return existing;
		}
		const project = host.mintAdopted({
			workspaceRoot,
			handlers,
			metaProjectId,
			workspaceId: stamp,
			displayName: displayName?.trim() || path.basename(workspaceRoot),
			isDefault: Boolean(opts?.isDefault)
		});
		// Sidebar can show from Meta pathHash; I/O still needs a process-local Slot.
		// Probe tmp is skipped inside ensureRegistered so a gone queue-echo-probe
		// does not paint an engine-wide banner.
		host.claimSlot(project);
		return project;
	};

	const applyWorkspaceMeta = (event: WorkspaceMetaEvent, handlers: AdoptHandlers): void => {
		const sessionsByProject = event.sessionsByProjectId ?? {};
		const remote = host.isRemote();
		for (const meta of event.projects) {
			const rawRoot = meta.workspace?.rootPath?.trim();
			const rootPath = remote
				? rawRoot ||
					(meta.isDefault && host.hostHome() ? defaultProjectPathOnHost(host.hostHome()!) : undefined)
				: rawRoot
					? path.resolve(rawRoot)
					: meta.isDefault
						? defaultProjectPath(host.homeDir())
						: undefined;
			if (!rootPath && !meta.isDefault) continue;

			let project =
				[...host.projects()].find(p => p.metaProjectId === meta.id) ??
				(remote && meta.workspace?.pathHash
					? [...host.projects()].find(
							p =>
								p.workspaceId === meta.workspace?.pathHash ||
								projectHash(p.path) === meta.workspace?.pathHash
						)
					: undefined) ??
				(meta.isDefault && !remote
					? (host.getDefault() ?? undefined)
					: rootPath
						? [...host.projects()].find(p =>
								remote
									? sameRemotePath(p.path, rootPath)
									: !p.isDefault && path.resolve(p.path) === rootPath
							)
						: undefined);

			if (!project && remote && rootPath) {
				if (!meta.isDefault && isReservedDefaultFolder(rootPath)) continue;
				project = adoptExistingFolder(
					rootPath,
					handlers,
					meta.id,
					meta.workspace?.pathHash,
					meta.displayName,
					{isDefault: Boolean(meta.isDefault), skipDisk: true}
				);
			} else if (!project && !remote && meta.isDefault) {
				host.ensureDefault(handlers);
				project = host.getDefault() ?? undefined;
			} else if (
				!project &&
				!remote &&
				!meta.isDefault &&
				rootPath &&
				existsSync(rootPath) &&
				!isDefaultProjectPath(rootPath, host.homeDir())
			) {
				project = adoptExistingFolder(
					rootPath,
					handlers,
					meta.id,
					meta.workspace?.pathHash,
					meta.displayName
				);
			}

			if (!project) continue;
			project.metaProjectId = meta.id;
			const minted = projectHash(project.path);
			if (isEchoProbePath(project.path)) {
				if (meta.workspace?.pathHash) {
					project.workspaceId = meta.workspace.pathHash;
					host.settleRegister(project);
				}
			} else if (meta.workspace?.pathHash === minted) {
				project.workspaceId = minted;
			}
			host.claimSlot(project);
			const metaName = meta.displayName?.trim();
			project.displayName = metaName || path.basename(rootPath ?? project.path);
			project.status = 'ready';
			project.error = undefined;
			const sessions = sessionsByProject[meta.id] ?? [];
			project.sessions.hydrateFromMeta(
				sessions.map(s => ({
					id: s.id,
					title: s.title,
					status: s.status,
					lastModified: s.updatedAt ?? undefined
				}))
			);
			handlers.onSessionsChanged?.(project.id);
		}
	};

	const handleCreateSessionResult = (event: CommandResult, handlers: AdoptHandlers): void => {
		const projectId = field(event, 'projectId');
		const workspaceId = field(event, 'workspaceId');
		const sessionId = field(event, 'sessionId');
		const taskId = field(event, 'taskId');
		const hash = workspaceId?.replace(/^workspace:/, '');
		const project =
			(taskId
				? [...host.projects()].find(p => p.sessions.listTasks().some(t => t.id === taskId))
				: undefined) ??
			(projectId
				? [...host.projects()].find(
						p => p.metaProjectId === projectId || (p.isDefault && projectId === 'default-project')
					)
				: undefined) ??
			(hash
				? [...host.projects()].find(p => p.workspaceId === hash || projectHash(p.path) === hash)
				: undefined) ??
			host.getActive();

		const failCreate = (projectHint: AdoptProject | null | undefined, detailRaw?: string) => {
			const target = projectHint ?? host.getActive();
			target?.sessions.failPendingCreate(taskId);
			const detail = detailRaw?.trim();
			handlers.onError(
				target?.id ?? 'engine',
				'',
				detail
					? {code: 'session.create_failed_detail', params: {detail}}
					: {code: 'session.create_failed'}
			);
			if (target) handlers.onSessionsChanged?.(target.id);
		};

		if (event.status !== 'accepted' || !sessionId || !taskId) {
			failCreate(project, event.message);
			return;
		}
		if (!project) {
			failCreate(undefined, event.message);
			return;
		}
		if (hash && !project.workspaceId) {
			project.workspaceId = hash;
			host.settleRegister(project);
		}
		if (projectId) project.metaProjectId = projectId;
		project.status = 'ready';
		project.error = undefined;
		// Engine adoptCreatedSession already binds before this result — pass hash so
		// acceptNewSession can Attach without a redundant BindSessionWorkspace round-trip.
		const bound = project.sessions.acceptNewSession(sessionId, taskId, hash);
		if (!bound) {
			const row =
				project.sessions.listTasks().find(t => t.id === taskId) ??
				project.sessions.listChats().find(t => t.id === taskId);
			if (!row?.sessionId) {
				failCreate(project, event.message);
				return;
			}
		}
		handlers.onError(project.id, '');
		handlers.onEvent(project.id, event);
		handlers.onSessionsChanged?.(project.id);
	};

	const handleSetProjectDisplayNameResult = (event: CommandResult, handlers: AdoptHandlers): void => {
		const metaProjectId = field(event, 'projectId');
		const fromEvent = field(event, 'displayName')?.trim() ?? '';
		const project = metaProjectId
			? [...host.projects()].find(p => p.metaProjectId === metaProjectId)
			: [...host.projects()].find(p => p.pendingDisplayName);
		const ok = event.status === 'accepted' || event.status === 'success';
		const displayName = fromEvent || project?.pendingDisplayName?.trim() || '';
		if (project && ok && displayName) {
			project.displayName = displayName;
			delete project.pendingDisplayName;
			handlers.onEvent(project.id, event);
			handlers.onSessionsChanged?.(project.id);
			return;
		}
		if (project) {
			delete project.pendingDisplayName;
			if (!ok) handlers.onError(project.id, event.message ?? 'SetProjectDisplayName failed');
			handlers.onEvent(project.id, event);
			return;
		}
		handlers.onEvent('engine', event);
	};

	const handleCreateProjectResult = (event: CommandResult, handlers: AdoptHandlers): void => {
		const projectId = field(event, 'projectId');
		const workspaceId = field(event, 'workspaceId');
		const pathHash = field(event, 'pathHash');
		if (event.status !== 'accepted' || !projectId) {
			handlers.onError('engine', event.message ?? 'CreateProject failed');
			return;
		}
		const hash = (pathHash ?? workspaceId)?.replace(/^workspace:/, '');
		const active = host.getActive();
		const project =
			(hash ? [...host.projects()].find(p => projectHash(p.path) === hash) : undefined) ??
			(active && !active.isDefault && !active.metaProjectId ? active : undefined) ??
			[...host.projects()].find(p => !p.isDefault && !p.metaProjectId);
		if (project) {
			project.metaProjectId = projectId;
			if (hash && projectHash(project.path) === hash) {
				project.workspaceId = hash;
			}
			project.status = 'ready';
			project.error = undefined;
			const pending = project.sessions.getActiveTask();
			if (pending?.pendingNew && !pending.sessionId) {
				project.sessions.retryPendingNew();
			}
			handlers.onSessionsChanged?.(project.id);
		}
		handlers.onEvent(project?.id ?? 'engine', event);
	};

	const handleRegisterResult = (event: CommandResult, handlers: AdoptHandlers): void => {
		if (event.status !== 'accepted' || !event.message) {
			const message = event.message ?? 'RegisterWorkspace failed';
			const missing = registerMissingDir(message);
			const hit = missing
				? [...host.projects()].find(
						p =>
							sameRemotePath(p.path, missing) || path.resolve(p.path) === path.resolve(missing)
					)
				: undefined;
			if (hit) {
				hit.status = 'error';
				hit.error = message;
				host.failRegister(hit.id, message);
				if (!host.hasRegisterFailed(hit.id)) host.noteRegisterFailed(hit.id, message);
				handlers.onSessionsChanged?.(hit.id);
				return;
			}
			host.failRegister(null, message);
			handlers.onError('engine', message);
			return;
		}
		const hash = event.message;
		const project = [...host.projects()].find(p => projectHash(p.path) === hash);
		if (!project) {
			handlers.onError('engine', `RegisterWorkspace hash unmatched: ${hash}`);
			return;
		}

		project.workspaceId = hash;
		project.slotLive = true;
		project.status = 'ready';
		project.error = undefined;
		project.cwd = project.path;
		host.settleRegister(project);

		const active = project.sessions.getActiveTask();
		if (active?.pendingNew && !active.sessionId) {
			project.sessions.retryPendingNew();
		} else if (active?.sessionId) {
			project.sessions.selectTask(active.id);
		} else if (!project.isDefault) {
			host.requestSessionsList(project);
		}

		handlers.onEvent(project.id, event);
		handlers.onSessionsChanged?.(project.id);
	};

	const handleSessionsList = (event: SessionsListEvent, handlers: AdoptHandlers): void => {
		let matched = false;
		for (const project of host.projects()) {
			const root = path.resolve(project.path);
			const filtered = event.sessions.filter(s => {
				if (!s.cwd) return false;
				return path.resolve(s.cwd) === root;
			});
			if (filtered.length === 0) continue;
			host.pendingSessions.delete(project.id);
			matched = true;
			project.sessions.hydrateFromSessionsList(filtered);
			const active = project.sessions.getActiveTask();
			if (active?.sessionId) {
				project.sessions.selectTask(active.id);
			}
			handlers.onEvent(project.id, event);
			handlers.onSessionsChanged?.(project.id);
		}
		if (event.sessions.length === 0 && host.pendingSessions.size > 0) {
			const id = host.pendingSessions.values().next().value as string;
			host.pendingSessions.delete(id);
			const project = host.projectById(id);
			if (project) {
				matched = true;
				project.sessions.hydrateFromSessionsList([]);
				handlers.onEvent(project.id, event);
				handlers.onSessionsChanged?.(project.id);
			}
		}
		if (!matched) handlers.onEvent('engine', event);
	};

	const command = {
		CreateProject: handleCreateProjectResult,
		RegisterWorkspace: handleRegisterResult,
		CreateSession: handleCreateSessionResult,
		NewSession: handleCreateSessionResult,
		SetProjectDisplayName: handleSetProjectDisplayNameResult
	} as const;

	return {
		applyWorkspaceMeta,
		adoptExistingFolder,
		handleRegisterResult,
		handleCreateSessionResult,
		handleSessionsList,
		handleCreateProjectResult,
		handleSetProjectDisplayNameResult,
		handleCommand: (event, handlers) => {
			const fn = command[event.name as keyof typeof command];
			if (!fn) return false;
			fn(event, handlers);
			return true;
		}
	};
}
