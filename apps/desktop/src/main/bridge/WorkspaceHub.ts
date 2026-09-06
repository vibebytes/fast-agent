import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {TERMINAL_PARSE_FAILURE_PREFIX, PROTOCOL_MISMATCH_PREFIX, type BridgeCommand, type BridgeEvent} from '@fastllm/bridge-protocol';
import type {
	AgentRow,
	AmbientRule,
	CreateSkillInput,
	EngineHostStatus,
	GetWorkspaceFileResult,
	GitStatus,
	ListWorkspaceDirResult,
	MarketSkillRow,
	ProjectSnapshot,
	ProjectStatus,
	ProviderModelPatch,
	ProviderRow,
	ReviewChangeDetail,
	FileReviewDiff,
	ReviewDiffSnapshot,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored,
	SaveWorkspaceFileResult,
	SearchModelRow,
	MobilePairingInfo,
	SettingsDoc,
	SettingsScope,
	SkillRow,
	TeamRow,
	UpsertProviderInput,
	WorkspaceFsCode,
	DshCallResult,
	DshError,
	EngineWireRow,
	HostDirResult,
	HostDirCreateResult
} from '@fast-ide/session-view';
import {stopOwnedLocal, type RemoteBridgeConnectionOptions} from '@fastllm/bridge-client';
import {BridgeClient} from './BridgeClient.js';
import {CONNECT_DEADLINE_MS, LOCAL_EDGE_ID, edgeCapabilities, type EdgeCapabilities} from '../remoteEdges.js';
import {isReservedDefaultFolder, sameRemotePath} from './remotePaths.js';
import {discoverHostSlashSkills} from './hostSkillDiscovery.js';
import {isLocalSaveEcho, rememberLocalSave} from './localSaveEcho.js';
import {SessionController} from './SessionController.js';
import {defaultProjectPath, defaultProjectPathOnHost, isDefaultProjectPath} from './defaultProject.js';
import {projectHash} from './projectHash.js';
import {isSessionStreamEvent, sessionIdFromEvent} from './sessionEvents.js';
import {createHostWait, HostWaitCommands, type HostLane, type HostWait} from './workspace/hostWait.js';
import {createTeams, type WorkspaceTeams} from './workspace/teams.js';
import {createSchedule, type WorkspaceSchedule} from './workspace/schedule.js';
import {createCatalog, type WorkspaceCatalog} from './workspace/catalog.js';
import {createPlugins, type WorkspacePlugins} from './workspace/plugins.js';
import {createReview, type WorkspaceReview} from './workspace/review.js';
import {createCheckout, type WorkspaceCheckout} from './workspace/checkout.js';
import {createComposerHeal, type ComposerHeal} from './workspace/composerHeal.js';
import {createAdopt, isEchoProbePath, type WorkspaceAdopt} from './workspace/adopt.js';

export type {AmbientRule, EngineHostStatus, ProjectSnapshot, ProjectStatus};


/** How long a review op waits for a missing slot registration before giving up. */
const RegisterWaitMs = 12_000;

export type BridgeErrorMeta = {
	code?: string;
	params?: Record<string, string | number>;
};

export type WorkspaceProjectHandlers = {
	onEvent: (projectId: string, event: BridgeEvent) => void;
	/** Empty `message` + no `code` clears sticky banner (existing behavior). */
	onError: (projectId: string, message: string, meta?: BridgeErrorMeta) => void;
	onExit: (projectId: string, code: number | null, signal: NodeJS.Signals | null) => void;
	onLog?: (projectId: string, message: string) => void;
	onSessionsChanged?: (projectId: string) => void;
	onEngineStatus?: (status: EngineHostStatus, error?: string) => void;
	onEngineInstallLog?: (log: {
		engineId: string;
		stream: 'stdout' | 'stderr';
		text: string;
		seq: number;
	}) => void;
};

export type WorkspaceHubDeps = {
	createBridge?: () => BridgeClient;
	createId?: () => string;
	createClientId?: () => string;
	hostCwd?: string;
	homeDir?: string;
	/** Hub `waitByRequestId` budget (DshCall / FS). Tests shorten this to prove the timeout text. */
	requestWaitMs?: number;
	/** RegisterWorkspace waiter. Tests shorten this. */
	registerWaitMs?: number;
	/** First rebind delay (ms). Next attempt doubles, cap 15s. Tests shorten this. */
	rebindBaseMs?: number;
	/** After ready, wait this long before clearing rebind backoff. */
	stableLeaseMs?: number;
	/** Write committed activeId after HelloOk. */
	persistActiveId?: (id: string) => void;
};

export type SwitchEdgeTarget = {
	id: string;
	remote?: RemoteBridgeConnectionOptions;
};

type RegisterWaiter = {
	resolve: () => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type OpenProject = {
	id: string;
	path: string;
	status: ProjectStatus;
	error?: string;
	cwd?: string;
	sessions: SessionController;
	clientId: string;
	/** Slot path hash (Meta identity). Not proof this Engine process hosts the checkout. */
	workspaceId?: string;
	/** RegisterWorkspace accepted on the current Engine connection. */
	slotLive?: boolean;
	/** Meta resource id (CreateProject / workspace_meta). */
	metaProjectId?: string;
	/** Engine-durable Project display name. */
	displayName?: string;
	/** Awaiting SetProjectDisplayName accepted (not yet applied to displayName). */
	pendingDisplayName?: string;
	isDefault: boolean;
};

/**
 * App-scoped hub: one BridgeClient for the whole App.
 * Folder Projects and the hidden Default Project share that host.
 */
export class WorkspaceHub {
	private readonly projects = new Map<string, OpenProject>();
	private activeProjectId: string | null = null;
	/** Project ids awaiting a sessions_list response (empty list still hydrates). */
	private readonly pendingSessionsList = new Set<string>();
	private readonly createBridge: () => BridgeClient;
	private readonly createId: () => string;
	private readonly createClientId: () => string;
	private readonly hostCwd: string;
	private readonly homeDir: string;
	private readonly requestWaitMs: number;
	private readonly registerWaitMs: number;
	private readonly rebindBaseMs: number;
	private readonly stableLeaseMs: number;
	private readonly persistActiveId?: (id: string) => void;

	private committedEdgeId = LOCAL_EDGE_ID;
	private pendingEdgeId: string | null = null;
	private switchingEdge = false;
	private remoteOpts?: RemoteBridgeConnectionOptions;
	private hostHome?: string;
	private switchAbort?: AbortController;
	private edgeAttempt = 0;
	private engineHandshakeOk = false;

	private bridge: BridgeClient | null = null;
	private engineStatus: EngineHostStatus = 'exited';
	private engineError?: string;
	/** Last Engine `ready` — fan out model chrome to projects opened after Hello. */
	private lastReady: Extract<BridgeEvent, {type: 'ready'}> | null = null;
	private engineHandlers: WorkspaceProjectHandlers | null = null;
	/** In-flight ListProviders → Composer catalog so ready / restore / model:list share one wait. */
	private composerCatalogSync: Promise<void> | null = null;
	private rebindTimer: ReturnType<typeof setTimeout> | null = null;
	private rebindResetTimer: ReturnType<typeof setTimeout> | null = null;
	private rebindAttempts = 0;
	private shuttingDown = false;
	/** Host connection id learned from our own Save echoes (`workspace_file_changed.connectionId`). */
	private bridgeConnectionId: string | undefined;
	/** Recent local Save fingerprints for echo suppress before connectionId is known. */
	private recentLocalSaves = new Map<string, number>();
	/** Review ops parked until the project's RegisterWorkspace result mints a slot hash. */
	private readonly registerWaiters = new Map<string, Set<RegisterWaiter>>();
	/** Projects whose RegisterWorkspace already failed — later review ops fail fast instead of re-waiting. */
	private readonly registerFailed = new Map<string, string>();
	private readonly hostWait: HostWait;
	private readonly teams: WorkspaceTeams;
	private readonly schedule: WorkspaceSchedule;
	private readonly catalog: WorkspaceCatalog;
	private readonly plugins: WorkspacePlugins;
	private readonly review: WorkspaceReview;
	private readonly checkout: WorkspaceCheckout;
	private readonly composerHeal: ComposerHeal;
	private readonly adopt: WorkspaceAdopt;

	constructor(deps: WorkspaceHubDeps = {}) {
		this.createBridge = deps.createBridge ?? (() => new BridgeClient());
		this.createId = deps.createId ?? (() => randomUUID());
		this.createClientId = deps.createClientId ?? (() => `fast-ide-${randomUUID()}`);
		this.homeDir = deps.homeDir ?? homedir();
		// Engine boot cwd (parent of Default Project). Default Project disk root is
		// $HOME/fast_workspace/.default_project — Tasks only, never in 项目.
		this.hostCwd = deps.hostCwd ?? path.join(this.homeDir, 'fast_workspace');
		this.requestWaitMs = deps.requestWaitMs ?? 12_000;
		this.registerWaitMs = deps.registerWaitMs ?? RegisterWaitMs;
		this.rebindBaseMs = deps.rebindBaseMs ?? 1_000;
		this.stableLeaseMs = deps.stableLeaseMs ?? 8_000;
		this.persistActiveId = deps.persistActiveId;
		this.hostWait = createHostWait({requestWaitMs: this.requestWaitMs});
		const lane: HostLane = {
			ready: () => this.bridge != null && this.engineStatus === 'ready',
			send: cmd => this.bridge?.send(cmd) ?? false,
			wait: (names, metaId, timeoutMs, checkoutId) => this.hostWait.wait(names, metaId, timeoutMs, checkoutId),
			waitRequest: (requestId, timeoutMs) => this.hostWait.waitRequest(requestId, timeoutMs),
			cancel: token => this.hostWait.cancel(token),
			metaId: projectId => this.metaIdFor(projectId),
			displayName: metaProjectId => {
				const meta = metaProjectId?.trim();
				if (!meta) return undefined;
				const open = this.projectByMetaId(meta);
				return open?.displayName?.trim() || (open ? path.basename(open.path) : undefined) || undefined;
			}
		};
		this.teams = createTeams(lane);
		this.schedule = createSchedule({
			...lane,
			livingLabel: (metaId, fromMeta) => {
				const open = this.projectByMetaId(metaId);
				const fromOpen = open?.displayName?.trim() || (open ? path.basename(open.path) : '');
				return (
					(fromOpen && !/^[0-9a-f-]{30,}$/i.test(fromOpen) ? fromOpen : '') ||
					(fromMeta && !/^[0-9a-f-]{30,}$/i.test(fromMeta) ? fromMeta : '') ||
					fromOpen ||
					fromMeta ||
					undefined
				);
			}
		});
		this.catalog = createCatalog(lane);
		this.plugins = createPlugins({
			...lane,
			hostOpen: () => this.bridge != null,
			applyEngines: rows => this.applyAvailable(rows)
		});
		this.review = createReview({
			...lane,
			ensureSlot: async projectId => {
				const project = this.projects.get(projectId);
				if (!project) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
				if (!this.bridge || this.engineStatus !== 'ready') return {ok: false, notice: 'Engine not ready'};
				if (!project.slotLive) {
					try {
						await this.ensureRegisteredAsync(project);
					} catch (e) {
						return {ok: false, notice: e instanceof Error ? e.message : String(e)};
					}
				}
				const hash = project.workspaceId;
				if (!hash || !project.slotLive) {
					return {ok: false, notice: 'Project not ready — wait for Engine workspace registration.'};
				}
				return {ok: true, hash};
			}
		});
		this.checkout = createCheckout({
			...lane,
			activeWorkspaceId: () => this.activeWorkspaceId(),
			rememberSave: (pathHash, relativePath, mtime) => this.rememberLocalSave(pathHash, relativePath, mtime),
			isRemote: () => this.isRemote(),
			pendingEdge: () => this.pendingEdgeId != null,
			hostHome: () => this.hostHome,
			setHostHome: home => {
				this.hostHome = home;
			},
			requestWaitMs: () => this.requestWaitMs
		});
		this.composerHeal = createComposerHeal({
			catalog: this.catalog,
			ready: () => this.bridge != null && this.engineStatus === 'ready',
			projects: () => this.projects.values(),
			active: () => this.getActive()
		});
		this.adopt = createAdopt({
			isRemote: () => this.isRemote(),
			hostHome: () => this.hostHome,
			homeDir: () => this.homeDir,
			projects: () => this.projects.values(),
			projectById: id => this.projects.get(id),
			getActive: () => this.getActive(),
			getDefault: () => this.getDefaultProject(),
			ensureDefault: handlers => {
				this.ensureDefaultProject(handlers as WorkspaceProjectHandlers);
			},
			settleRegister: p => this.settleRegisterWaiters(p as OpenProject),
			claimSlot: p => this.claimSlot(p as OpenProject),
			failRegister: (id, message) => this.failRegisterWaiters(id, message),
			noteRegisterFailed: (id, message) => {
				this.registerFailed.set(id, message);
			},
			hasRegisterFailed: id => this.registerFailed.has(id),
			mintAdopted: input => this.mintAdoptedProject(input),
			pendingSessions: this.pendingSessionsList,
			requestSessionsList: p => this.requestProjectSessionsList(p as OpenProject)
		});
	}

	isRemote(): boolean {
		return this.committedEdgeId !== LOCAL_EDGE_ID;
	}

	edgeSnapshot(): {
		activeId: string;
		pendingEdgeId: string | null;
		capabilities: EdgeCapabilities;
		hostHome?: string;
	} {
		return {
			activeId: this.committedEdgeId,
			pendingEdgeId: this.pendingEdgeId,
			capabilities: edgeCapabilities(this.committedEdgeId, this.pendingEdgeId),
			hostHome: this.hostHome
		};
	}

	bindCommittedEdge(id: string, remote?: RemoteBridgeConnectionOptions): void {
		this.committedEdgeId = id;
		this.remoteOpts = remote;
	}

	hasInFlightRuns(): boolean {
		return [...this.projects.values()].some(p => p.sessions.isRunActive());
	}

	async switchEdge(target: SwitchEdgeTarget, handlers: WorkspaceProjectHandlers): Promise<void> {
		if (target.id === this.committedEdgeId && !this.pendingEdgeId && this.engineStatus === 'ready' && this.bridge) {
			return;
		}
		this.switchAbort?.abort();
		const attempt = ++this.edgeAttempt;
		const ac = new AbortController();
		this.switchAbort = ac;
		this.pendingEdgeId = target.id;
		this.engineHandlers = handlers;

		const candidate = this.createBridge();
		const remote = target.remote
			? {
					...target.remote,
					signal: ac.signal,
					timeoutMs: target.remote.timeoutMs ?? CONNECT_DEADLINE_MS
				}
			: undefined;
		const buffered: BridgeEvent[] = [];
		let live = false;
		const isCurrent = () => attempt === this.edgeAttempt && !ac.signal.aborted;

		const liveHandlers: Parameters<BridgeClient['start']>[1] = {
			onEvent: event => {
				if (!isCurrent()) return;
				if (event.type === 'HelloOk' && event.hostHome) this.hostHome = event.hostHome;
				if (!live) {
					buffered.push(event);
					return;
				}
				this.onBridgeEvent(event, handlers);
			},
			onError: message => {
				if (!isCurrent() || !live) return;
				if (this.reconcileTerminalParseFailure(message, handlers)) return;
				if (this.noticeProtocolMismatch(message, handlers)) return;
				this.setEngineStatus('error', message);
				handlers.onError('engine', message);
			},
			onLog: message => {
				if (!isCurrent()) return;
				handlers.onLog?.('engine', message);
			},
			onExit: (code, signal) => {
				if (!isCurrent() || this.switchingEdge || this.shuttingDown) return;
				if (!live) return;
				this.handleEngineExit(candidate, handlers, code, signal);
			}
		};

		try {
			await candidate.start(
				this.hostCwd,
				liveHandlers,
				{
					sessionMode: 'continue',
					remote,
					clientId: this.createClientId(),
					wantEngineId: process.env.FAST_WANT_ENGINE_ID
				}
			);
		} catch (error) {
			candidate.stop();
			if (ac.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
				if (this.pendingEdgeId === target.id && attempt === this.edgeAttempt) {
					this.pendingEdgeId = null;
				}
				throw Object.assign(new Error('aborted'), {name: 'AbortError'});
			}
			if (attempt === this.edgeAttempt) this.pendingEdgeId = null;
			throw error instanceof Error ? error : new Error(String(error));
		}

		if (!isCurrent()) {
			candidate.stop();
			throw Object.assign(new Error('aborted'), {name: 'AbortError'});
		}

		this.commitCandidate(candidate, target, handlers);
		live = true;
		for (const event of buffered) this.onBridgeEvent(event, handlers);
		this.requestWorkspaceMeta();
	}

	private commitCandidate(
		candidate: BridgeClient,
		target: SwitchEdgeTarget,
		handlers: WorkspaceProjectHandlers
	): void {
		this.switchingEdge = true;
		const old = this.bridge;
		if (old && old !== candidate) old.stop();
		this.clearProjectsForSwitch();
		this.bridge = candidate;
		this.committedEdgeId = target.id;
		this.remoteOpts = target.remote;
		this.pendingEdgeId = null;
		this.switchAbort = undefined;
		this.engineHandshakeOk = true;
		this.rebindAttempts = 0;
		this.persistActiveId?.(target.id);
		this.switchingEdge = false;
		this.shuttingDown = false;
		this.engineHandlers = handlers;
		this.setEngineStatus('ready');
	}

	private clearProjectsForSwitch(): void {
		this.failRegisterWaiters(null, 'Edge switched');
		for (const project of this.projects.values()) {
			project.sessions.detachAll();
		}
		this.projects.clear();
		this.activeProjectId = null;
		this.lastReady = null;
		this.pendingSessionsList.clear();
	}

	private handleEngineExit(
		bridge: BridgeClient,
		handlers: WorkspaceProjectHandlers,
		code: number | null,
		signal: NodeJS.Signals | null
	): void {
		if (this.bridge !== bridge) return;
		this.bridge = null;
		const hostDied = code != null || signal != null;
		this.failRegisterWaiters(null, `Connection lost (${code ?? signal ?? 'unknown'})`);
		if (this.rebindResetTimer) {
			clearTimeout(this.rebindResetTimer);
			this.rebindResetTimer = null;
		}
		for (const project of this.projects.values()) {
			project.status = 'exited';
			project.slotLive = false;
			project.error = `Connection lost (${code ?? signal ?? 'unknown'})`;
			project.sessions.markEngineLost(`Connection lost (${code ?? signal ?? 'unknown'})`, {
				failTurns: hostDied
			});
			handlers.onExit(project.id, code, signal);
		}
		if (!this.shuttingDown && !this.switchingEdge && this.engineHandshakeOk) {
			this.scheduleRebind(handlers);
		}
	}

	async openRemoteProject(
		serverPath: string,
		handlers: WorkspaceProjectHandlers
	): Promise<ProjectSnapshot> {
		if (!this.isRemote()) throw new Error('openRemoteProject is only available on a remote edge');
		if (this.pendingEdgeId) throw new Error('Edge switch in progress');
		const raw = serverPath.trim();
		if (!raw) throw new Error('Path is required');
		if (isReservedDefaultFolder(raw)) {
			throw new Error('Cannot open the hidden Default Project as a folder Project');
		}
		const existing = [...this.projects.values()].find(p => sameRemotePath(p.path, raw));
		if (existing) {
			this.focusProject(existing.id);
			return this.snapshot(existing);
		}
		this.engineHandlers = handlers;
		const project = this.adopt.adoptExistingFolder(raw, handlers, undefined, undefined, undefined, {
			isDefault: false,
			skipDisk: true
		}) as OpenProject | undefined;
		if (!project) throw new Error('Failed to adopt remote folder');
		if (!this.bridge || this.engineStatus !== 'ready') {
			this.dropAdoptedRow(project.id);
			throw new Error('Engine not ready');
		}
		try {
			await this.ensureRegisteredAsync(project);
			this.requestWorkspaceMeta();
			return this.snapshot(project);
		} catch (error) {
			this.dropAdoptedRow(project.id);
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	async listHostDir(dirPath?: string) {
		return this.checkout.listHostDir(dirPath);
	}
	async createHostDir(parent: string, name: string) {
		return this.checkout.createHostDir(parent, name);
	}
	private dropAdoptedRow(id: string): void {
		this.projects.delete(id);
		if (this.activeProjectId === id) {
			this.activeProjectId = [...this.projects.keys()][0] ?? null;
		}
	}

	getEngineStatus(): {status: EngineHostStatus; error?: string} {
		return {status: this.engineStatus, error: this.engineError};
	}

	bridgeDiagnostics(): {parseFailures: number; deadLetters: readonly string[]} {
		return this.bridge?.stats() ?? {parseFailures: 0, deadLetters: []};
	}

	/** Host-lane commands talk to the JVM, not a ready session runtime. */
	private hostLaneOpen(): boolean {
		return this.bridge != null;
	}

	/** Host unix conn id for `workspace_file_changed` echo suppress (learned after first Save). */
	connectionId(): string | undefined {
		return this.bridgeConnectionId;
	}

	/** Force Engine into error for restore timeout / hard fail (StatusBar Engine error). */
	failEngine(message: string): void {
		this.setEngineStatus('error', message);
	}

	/**
	 * Clear a sticky restore-timeout error once Bridge is up again
	 * (late workspace_meta after publishFailed must not leave the overlay stuck).
	 */
	recoverEngineHost(): void {
		if (this.bridge && this.engineStatus !== 'ready') {
			this.setEngineStatus('ready');
		}
	}

	/** Folder Projects only — Default Project is Tasks mount, never listed under 项目. */
	listProjects(): ProjectSnapshot[] {
		this.dropMisclassifiedDefaultFolders();
		return [...this.projects.values()]
			.filter(p => {
				if (p.isDefault) return false;
				if (this.isRemote()) return !isReservedDefaultFolder(p.path);
				return !isDefaultProjectPath(p.path, this.homeDir);
			})
			.map(p => this.snapshot(p));
	}

	/** Drop folder rows that wrongly point at the hidden Default path (path rename / Meta stray). */
	private dropMisclassifiedDefaultFolders(): void {
		for (const [id, p] of this.projects) {
			if (p.isDefault) continue;
			const reserved = this.isRemote()
				? isReservedDefaultFolder(p.path)
				: isDefaultProjectPath(p.path, this.homeDir);
			if (!reserved) continue;
			this.projects.delete(id);
			if (this.activeProjectId === id) {
				this.activeProjectId = this.getDefaultProject()?.id ?? null;
			}
		}
	}

	listAllProjects(): ProjectSnapshot[] {
		return [...this.projects.values()].map(p => this.snapshot(p));
	}

	getDefaultProject(): OpenProject | null {
		return [...this.projects.values()].find(p => p.isDefault) ?? null;
	}

	getActive(): OpenProject | null {
		return this.activeProjectId ? this.projects.get(this.activeProjectId) ?? null : null;
	}

	getById(projectId: string): OpenProject | null {
		return this.projects.get(projectId) ?? null;
	}

	/** Shared Bridge client (tests / IPC). */
	getBridge(): BridgeClient | null {
		return this.bridge;
	}

	async dshCall(
		method: string,
		payload: Record<string, unknown> = {},
		sessionId?: string
	): Promise<DshCallResult> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: {code: 'unavailable', message: 'Engine not ready'}};
		}
		const sid =
			sessionId?.trim() ||
			this.getActive()?.sessions.getActiveTask()?.sessionId ||
			undefined;
		const requestId = randomUUID();
		const {token, promise} = this.hostWait.waitRequest(requestId);
		if (
			!this.bridge.send({
				type: 'Call',
				method,
				payload,
				requestId,
				...(sid ? {sessionId: sid} : {})
			})
		) {
			this.hostWait.cancel(token);
			return {ok: false, error: {code: 'unavailable', message: 'Failed to send DshCall'}};
		}
		try {
			const event = await promise;
			if (event.status === 'error' || event.status === 'rejected') {
				const err = event.error;
				if (err && typeof err.code === 'string') {
					return {ok: false, error: err as DshError};
				}
				return {
					ok: false,
					error: {code: event.message || 'error', message: event.message}
				};
			}
			return {ok: true, method: event.method ?? method, value: event.value};
		} catch (e) {
			return {
				ok: false,
				error: {code: 'unavailable', message: e instanceof Error ? e.message : String(e)}
			};
		}
	}

	findProjectForTask(taskId: string): OpenProject | null {
		for (const project of this.projects.values()) {
			const hit =
				project.sessions.listTasks().find(t => t.id === taskId) ??
				project.sessions.listChats().find(t => t.id === taskId);
			if (hit) return project;
		}
		return null;
	}

	/**
	 * Open Tab reconcile (option B): Bind+Attach each listed Task without stealing
	 * focus / activeProject. Close Tab does not Detach — this only (re)claims slot.
	 * `ok` only when the Session is actually Attached (slot hash present).
	 */
	ensureTasksLive(taskIds: string[]): {ok: string[]; skipped: string[]} {
		const ok: string[] = [];
		const skipped: string[] = [];
		const seen = new Set<string>();
		for (const raw of taskIds) {
			const id = raw?.trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const resolved = this.resolveTaskRef(id, id);
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
	}

	/** Resolve Project + live Task id (hydrate may remint local ids; sessionId is stable). */
	resolveTaskRef(
		taskId: string,
		sessionId?: string | null
	): {project: OpenProject; taskId: string} | null {
		const byId = this.findProjectForTask(taskId);
		if (byId) return {project: byId, taskId};
		if (!sessionId) return null;
		const project = this.projectForSession(sessionId);
		if (!project) return null;
		const task =
			project.sessions.listTasks().find(t => t.sessionId === sessionId) ??
			project.sessions.listChats().find(t => t.sessionId === sessionId);
		if (!task) return null;
		return {project, taskId: task.id};
	}

	/**
	 * LivingTask / schedule row click: focus open Project + select Task by Engine sessionId.
	 * `metaProjectId` is Meta resource id (not local folder id). Does not auto-open folders.
	 */
	openLivingSession(
		sessionId: string,
		metaProjectId?: string | null
	):
		| {ok: true; taskId: string; title: string; kind?: string; sessionId: string | null}
		| {ok: false; notice: string} {
		const sid = sessionId.trim();
		if (!sid) return {ok: false, notice: 'sessionId required'};

		let resolved = this.resolveTaskRef(sid, sid);
		if (!resolved && metaProjectId?.trim()) {
			const project = this.projectByMetaId(metaProjectId.trim());
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
		this.focusProject(resolved.project.id);
		const task = resolved.project.sessions.selectTask(resolved.taskId);
		if (!task) return {ok: false, notice: 'Failed to select task'};
		return {
			ok: true,
			taskId: task.id,
			title: task.title,
			kind: task.kind,
			sessionId: task.sessionId
		};
	}

	/** Local OpenProject by Meta project id (incl. default-project). */
	projectByMetaId(metaProjectId: string): OpenProject | null {
		const id = metaProjectId.trim();
		if (!id) return null;
		for (const project of this.projects.values()) {
			if (project.metaProjectId === id) return project;
			if (project.isDefault && id === 'default-project') return project;
		}
		return null;
	}

	tickAllHeartbeats(): void {
		for (const project of this.projects.values()) {
			project.sessions.tickHeartbeat();
		}
	}

	ensureEngine(handlers: WorkspaceProjectHandlers): void {
		this.engineHandlers = handlers;
		if (
			this.bridge &&
			(this.engineStatus === 'ready' ||
				this.engineStatus === 'starting' ||
				this.engineStatus === 'reconnecting')
		) {
			return;
		}
		if (this.bridge) {
			this.bridge.stop();
			this.bridge = null;
		}
		this.startEngine(handlers);
	}

	openProject(workspaceRoot: string, handlers: WorkspaceProjectHandlers): ProjectSnapshot {
		if (this.isRemote()) {
			throw new Error('Cannot open a local folder on a remote edge');
		}
		const normalized = path.resolve(workspaceRoot);
		if (isDefaultProjectPath(normalized, this.homeDir)) {
			throw new Error('Cannot open the hidden Default Project as a folder Project');
		}
		return this.openInternal(normalized, handlers, false);
	}

	ensureDefaultProject(handlers: WorkspaceProjectHandlers): ProjectSnapshot {
		const existing = this.getDefaultProject();
		if (existing) {
			this.focusProject(existing.id);
			return this.snapshot(existing);
		}
		if (this.isRemote()) {
			const home = this.hostHome?.trim();
			if (!home) throw new Error('Remote host home is unknown');
			const root = defaultProjectPathOnHost(home);
			const project = this.adopt.adoptExistingFolder(
				root,
				handlers,
				'default-project',
				undefined,
				'Default Project',
				{isDefault: true, skipDisk: true}
			);
			if (!project) throw new Error('Failed to adopt remote default project');
			const row = project as OpenProject;
			row.sessions.hydrateFromMeta([]);
			this.focusProject(row.id);
			return this.snapshot(row);
		}
		const root = defaultProjectPath(this.homeDir);
		mkdirSync(root, {recursive: true});
		return this.openInternal(root, handlers, true);
	}

	focusProject(projectId: string): boolean {
		if (!this.projects.has(projectId)) return false;
		this.activeProjectId = projectId;
		const project = this.projects.get(projectId);
		// Explicit focus on Default (or any unregistered slot) mounts the workspace.
		if (project) this.ensureRegistered(project);
		return true;
	}

	/** Persist open folder Projects — client prefs only; Engine Meta is authoritative. */
	persistOpenProjectSet(): boolean {
		return false;
	}

	/** Ask Bridge for Meta aggregate (active projects + sessions). */
	requestWorkspaceMeta(): boolean {
		if (!this.bridge || this.engineStatus !== 'ready') return false;
		return this.bridge.send({type: 'GetWorkspaceMeta'});
	}

	/** @deprecated use requestWorkspaceMeta */
	requestOpenProjectSet(): boolean {
		return this.requestWorkspaceMeta();
	}

	closeProject(projectId: string): boolean {
		const project = this.projects.get(projectId);
		if (!project) return false;
		const inFlight = project.sessions.isRunActive();
		project.sessions.detachAll();
		const metaId = project.metaProjectId ?? (project.isDefault ? undefined : project.id);
		if (metaId && this.bridge && this.engineStatus === 'ready' && !project.isDefault) {
			this.bridge.send({
				type: 'UpdateProjectStatus',
				projectId: metaId,
				status: 'closed'
			});
		}
		if (project.workspaceId && this.bridge && !inFlight) {
			this.bridge.send({type: 'UnregisterWorkspace', workspaceId: project.workspaceId});
		}
		this.projects.delete(projectId);
		this.registerFailed.delete(projectId);
		this.failRegisterWaiters(projectId, 'Project closed');
		if (this.activeProjectId === projectId) {
			const next =
				[...this.projects.values()].find(p => !p.isDefault)?.id ??
				this.projects.keys().next().value ??
				null;
			this.activeProjectId = (next as string | null) ?? null;
		}
		return true;
	}

	async stopOwnedEngine(): Promise<void> {
		this.shuttingDown = true;
		if (this.rebindTimer) {
			clearTimeout(this.rebindTimer);
			this.rebindTimer = null;
		}
		if (this.rebindResetTimer) {
			clearTimeout(this.rebindResetTimer);
			this.rebindResetTimer = null;
		}
		if (this.bridge) {
			await this.bridge.stopLocal();
			this.bridge = null;
		}
		await stopOwnedLocal();
		this.closeAll();
	}

	closeAll(): void {
		this.switchAbort?.abort();
		this.pendingEdgeId = null;
		this.shuttingDown = true;
		if (this.rebindTimer) {
			clearTimeout(this.rebindTimer);
			this.rebindTimer = null;
		}
		if (this.rebindResetTimer) {
			clearTimeout(this.rebindResetTimer);
			this.rebindResetTimer = null;
		}
		for (const id of [...this.projects.keys()]) {
			this.projects.get(id)?.sessions.detachAll();
			this.projects.delete(id);
		}
		this.activeProjectId = null;
		this.lastReady = null;
		this.failRegisterWaiters(null, 'Engine shutting down');
		this.bridge?.stop();
		this.bridge = null;
		this.setEngineStatus('exited');
	}

	private snapshot(p: OpenProject): ProjectSnapshot {
		return {
			id: p.id,
			path: p.path,
			status: p.status,
			error: p.error,
			cwd: p.cwd,
			active: p.id === this.activeProjectId,
			isDefault: p.isDefault,
			displayName: p.displayName?.trim() || path.basename(p.path),
			workspaceId: p.workspaceId ?? null
		};
	}

	async listScheduledJobs(projectId?: string | null) {
		return this.schedule.listScheduledJobs(projectId);
	}
	async listTeams(projectId?: string | null) {
		return this.teams.listTeams(projectId);
	}
	async listGoals(projectId?: string | null, status?: string | null) {
		return this.teams.listGoals(projectId, status);
	}
	async listAgents(projectId?: string | null, opts?: {includeArchived?: boolean}) {
		return this.teams.listAgents(projectId, opts);
	}
	async createTeam(input: Parameters<WorkspaceTeams['createTeam']>[0]) {
		return this.teams.createTeam(input);
	}
	async updateTeam(input: Parameters<WorkspaceTeams['updateTeam']>[0]) {
		return this.teams.updateTeam(input);
	}
	async archiveTeam(teamId: string) {
		return this.teams.archiveTeam(teamId);
	}
	async unarchiveTeam(teamId: string) {
		return this.teams.unarchiveTeam(teamId);
	}
	async getTeam(teamId: string) {
		return this.teams.getTeam(teamId);
	}
	async createAgent(input: Parameters<WorkspaceTeams['createAgent']>[0]) {
		return this.teams.createAgent(input);
	}
	async updateAgent(input: Parameters<WorkspaceTeams['updateAgent']>[0]) {
		return this.teams.updateAgent(input);
	}
	async archiveAgent(agentId: string) {
		return this.teams.archiveAgent(agentId);
	}
	async unarchiveAgent(agentId: string) {
		return this.teams.unarchiveAgent(agentId);
	}
	async cloneAgent(input: Parameters<WorkspaceTeams['cloneAgent']>[0]) {
		return this.teams.cloneAgent(input);
	}
	async getAgent(agentId: string) {
		return this.teams.getAgent(agentId);
	}
	async deleteTeam(teamId: string) {
		return this.teams.deleteTeam(teamId);
	}
	async saveAsTeam(input: Parameters<WorkspaceTeams['saveAsTeam']>[0]) {
		return this.teams.saveAsTeam(input);
	}
	async promoteTeam(input: Parameters<WorkspaceTeams['promoteTeam']>[0]) {
		return this.teams.promoteTeam(input);
	}
	async getGoal(goalId: string) {
		return this.teams.getGoal(goalId);
	}
	async deleteAgent(agentId: string) {
		return this.teams.deleteAgent(agentId);
	}
	async stopAgentRun(agentId: string) {
		return this.teams.stopAgentRun(agentId);
	}
	async deleteGoal(goalId: string) {
		return this.teams.deleteGoal(goalId);
	}
	async listLivingTasks() {
		return this.schedule.listLivingTasks();
	}
	async createScheduledJob(input: Parameters<WorkspaceSchedule['createScheduledJob']>[0]) {
		return this.schedule.createScheduledJob(input);
	}
	async pauseScheduledJob(id: string) {
		return this.schedule.pauseScheduledJob(id);
	}
	async resumeScheduledJob(id: string) {
		return this.schedule.resumeScheduledJob(id);
	}
	async cancelScheduledJob(id: string) {
		return this.schedule.cancelScheduledJob(id);
	}
	async fireNowScheduledJob(id: string) {
		return this.schedule.fireNowScheduledJob(id);
	}
	async updateScheduledJobCron(id: string, cronExpr: string, timezone?: string) {
		return this.schedule.updateScheduledJobCron(id, cronExpr, timezone);
	}
	async listScheduledJobRuns(id: string) {
		return this.schedule.listScheduledJobRuns(id);
	}
	async getSettings(scope: SettingsScope, scopeId?: string) {
		return this.catalog.getSettings(scope, scopeId);
	}
	async getBridgePairing() {
		return this.catalog.getBridgePairing();
	}
	async setLanPairing(enabled: boolean) {
		return this.catalog.setLanPairing(enabled);
	}
	async patchSettings(scope: 'global' | 'project', namespace: string, patch: unknown, scopeId?: string) {
		return this.catalog.patchSettings(scope, namespace, patch, scopeId);
	}
	async refreshComposerCatalog() {
		return this.composerHeal.refreshComposerCatalog();
	}
	async listProviders() {
		return this.catalog.listProviders();
	}
	async upsertProvider(input: UpsertProviderInput) {
		return this.catalog.upsertProvider(input);
	}
	async deleteProvider(id: string) {
		return this.catalog.deleteProvider(id);
	}
	async setProviderEnabled(id: string, enabled: boolean) {
		return this.catalog.setProviderEnabled(id, enabled);
	}
	async testProvider(id: string) {
		return this.catalog.testProvider(id);
	}
	async patchProviderModels(id: string, patch: ProviderModelPatch[]) {
		return this.catalog.patchProviderModels(id, patch);
	}
	async searchProviderModels(id: string, query: string) {
		return this.catalog.searchProviderModels(id, query);
	}
	async listSkills() {
		return this.catalog.listSkills();
	}
	async listExtensions() {
		return this.plugins.listExtensions();
	}
	async extensionStatus(id: string) {
		return this.plugins.extensionStatus(id);
	}
	async installExtension(dir: string) {
		return this.plugins.installExtension(dir);
	}
	async listEngines() {
		return this.plugins.listEngines();
	}
	async writeEngine(type: Parameters<WorkspacePlugins['writeEngine']>[0], id: string) {
		return this.plugins.writeEngine(type, id);
	}
	async uninstallExtension(id: string) {
		return this.plugins.uninstallExtension(id);
	}
	async createSkill(input: CreateSkillInput) {
		return this.catalog.createSkill(input);
	}
	async deleteSkill(name: string, scope: string) {
		return this.catalog.deleteSkill(name, scope);
	}
	async setSkillEnabled(name: string, scope: string, enabled: boolean) {
		return this.catalog.setSkillEnabled(name, scope, enabled);
	}
	async searchSkillMarket(query: string) {
		return this.catalog.searchSkillMarket(query);
	}
	async installSkillFromMarket(source: string, scope: string) {
		return this.catalog.installSkillFromMarket(source, scope);
	}
	async uninstallSkillFromMarket(name: string, scope: string) {
		return this.catalog.uninstallSkillFromMarket(name, scope);
	}
	async listRules(projectId: string) {
		return this.checkout.listRules(projectId);
	}
	async addProjectRule(projectId: string, text: string) {
		return this.checkout.addProjectRule(projectId, text);
	}
	async removeRule(projectId: string, ruleId: string) {
		return this.checkout.removeRule(projectId, ruleId);
	}
	async setRuleEnabled(projectId: string, ruleId: string, enabled: boolean) {
		return this.checkout.setRuleEnabled(projectId, ruleId, enabled);
	}
	async listReviewChanges(projectId: string, checkpointId?: string | null, sessionId?: string | null) {
		return this.review.listReviewChanges(projectId, checkpointId, sessionId);
	}
	async getReviewChange(projectId: string, changeId: string) {
		return this.review.getReviewChange(projectId, changeId);
	}
	async listReviewDiff(projectId: string, sinceRevision?: number) {
		return this.review.listReviewDiff(projectId, sinceRevision);
	}
	async getFileReviewDiff(projectId: string, path: string) {
		return this.review.getFileReviewDiff(projectId, path);
	}
	async keepReviewChanges(projectId: string, changeIds: string[], revision: number) {
		return this.review.keepReviewChanges(projectId, changeIds, revision);
	}
	async previewRevert(projectId: string, input: Parameters<WorkspaceReview['previewRevert']>[1]) {
		return this.review.previewRevert(projectId, input);
	}
	async applyRevert(projectId: string, previewId: string, force?: boolean) {
		return this.review.applyRevert(projectId, previewId, force);
	}
	async redoRevert(projectId: string, restoreId: string) {
		return this.review.redoRevert(projectId, restoreId);
	}
	private metaIdFor(projectId: string): string | undefined {
		const project = this.projects.get(projectId);
		if (!project) return undefined;
		return project.metaProjectId ?? (project.isDefault ? 'default-project' : undefined);
	}

	private activeWorkspaceId(): string {
		const project = this.getActive();
		const id = project?.workspaceId?.trim();
		if (!id) throw new Error('project not ready');
		return id.replace(/^workspace:/, '');
	}

	private rememberLocalSave(pathHash: string, relativePath: string, mtime: number): void {
		rememberLocalSave(this.recentLocalSaves, pathHash, relativePath, mtime);
	}

	private isLocalSaveEcho(
		event: Extract<BridgeEvent, {type: 'workspace_file_changed'}>
	): boolean {
		const r = isLocalSaveEcho(this.recentLocalSaves, event, this.bridgeConnectionId);
		if (r.learnConnectionId) this.bridgeConnectionId = r.learnConnectionId;
		return r.suppress;
	}

	async listWorkspaceDir(relativePath?: string) {
		return this.checkout.listWorkspaceDir(relativePath);
	}
	async getWorkspaceFile(relativePath: string) {
		return this.checkout.getWorkspaceFile(relativePath);
	}
	async saveWorkspaceFile(relativePath: string, content: string, mtime?: number, bytes?: number) {
		return this.checkout.saveWorkspaceFile(relativePath, content, mtime, bytes);
	}
	async gitWorkspaceStatus(force?: boolean) {
		return this.checkout.gitWorkspaceStatus(force);
	}
	private applyAvailable(rows: EngineWireRow[]): void {
		const fromRows = rows.filter(r => r.inRegistry).map(r => r.id);
		for (const project of this.projects.values()) {
			const next = new Set(project.sessions.availableEngineIds());
			for (const id of fromRows) next.add(id);
			for (const row of rows) {
				if (!row.inRegistry) next.delete(row.id);
			}
			if (!next.has('fast')) next.add('fast');
			project.sessions.setAvailableEngines([...next]);
		}
	}

	renameProjectDisplayName(projectId: string, displayName: string): boolean {
		const project = this.projects.get(projectId);
		if (!project || project.isDefault) return false;
		const metaId = project.metaProjectId;
		if (!metaId || !this.bridge) return false;
		const trimmed = displayName.trim();
		if (!trimmed) return false;
		const current = project.displayName?.trim() || path.basename(project.path);
		if (trimmed === current) return true;
		project.pendingDisplayName = trimmed;
		const ok = this.bridge.send({
			type: 'SetProjectDisplayName',
			projectId: metaId,
			displayName: trimmed
		});
		if (!ok) delete project.pendingDisplayName;
		return ok;
	}

	private openInternal(
		workspaceRoot: string,
		handlers: WorkspaceProjectHandlers,
		isDefault: boolean
	): ProjectSnapshot {
		if (this.isRemote()) {
			throw new Error('Cannot open a local folder on a remote edge');
		}
		const existing = [...this.projects.values()].find(p => p.path === workspaceRoot);
		if (existing) {
			this.focusProject(existing.id);
			return this.snapshot(existing);
		}

		this.ensureEngine(handlers);

		const id = this.createId();
		const clientId = this.createClientId();
		const sessions = new SessionController({
			clientId,
			send: (command: BridgeCommand) => this.bridge?.send(command) ?? false,
			onChange: () => handlers.onSessionsChanged?.(id),
			workspaceId: () => this.projects.get(id)?.workspaceId,
			projectId: () => {
				const p = this.projects.get(id);
				if (!p) return undefined;
				if (p.isDefault) return p.metaProjectId ?? 'default-project';
				return p.metaProjectId;
			},
			requestRegister: () => {
				const p = this.projects.get(id);
				if (!p) return;
				if (!p.isDefault && !p.metaProjectId && this.bridge && this.engineStatus === 'ready') {
					this.bridge.send({
						type: 'CreateProject',
						projectType: 'coding',
						rootPath: p.path,
						displayName: path.basename(p.path)
					});
				}
				this.ensureRegistered(p);
			},
			discoverHostSkills: () =>
				this.isRemote() ? [] : discoverHostSlashSkills(this.projects.get(id)?.path)
		});

		const project: OpenProject = {
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
		this.projects.set(id, project);
		this.activeProjectId = id;
		sessions.seedHostSlashCatalog();
		// Apply engine-level model chrome from a prior Hello ready (no sessionId path).
		if (this.lastReady) sessions.handleEvent(this.lastReady);
		if (this.engineHandlers) void this.composerHeal.refreshComposerChrome(this.engineHandlers);

		// Meta identity + optional Slot claim (I/O). Slot is not required for sidebar.
		if (!isDefault && this.engineStatus === 'ready' && this.bridge) {
			this.bridge.send({
				type: 'CreateProject',
				projectType: 'coding',
				rootPath: workspaceRoot,
				displayName: path.basename(workspaceRoot)
			});
			this.bridge.send({type: 'RegisterWorkspace', path: workspaceRoot});
		}

		return this.snapshot(project);
	}

	/** Meta adopt: mint a row without stealing active focus (§9.3). */
	private mintAdoptedProject(input: {
		workspaceRoot: string;
		handlers: {onSessionsChanged?: (projectId: string) => void};
		metaProjectId?: string;
		workspaceId?: string;
		displayName?: string;
		isDefault: boolean;
	}): OpenProject {
		this.ensureEngine(input.handlers as WorkspaceProjectHandlers);
		const id = this.createId();
		const clientId = this.createClientId();
		const sessions = new SessionController({
			clientId,
			send: (command: BridgeCommand) => this.bridge?.send(command) ?? false,
			onChange: () => input.handlers.onSessionsChanged?.(id),
			workspaceId: () => this.projects.get(id)?.workspaceId,
			projectId: () => this.projects.get(id)?.metaProjectId,
			requestRegister: () => {
				const p = this.projects.get(id);
				if (!p) return;
				this.ensureRegistered(p);
			},
			discoverHostSkills: () =>
				this.isRemote() ? [] : discoverHostSlashSkills(this.projects.get(id)?.path)
		});
		const project: OpenProject = {
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
		this.projects.set(id, project);
		sessions.seedHostSlashCatalog();
		return project;
	}

	private ensureRegistered(project: OpenProject): void {
		if (this.engineStatus !== 'ready' || !this.bridge) return;
		// Slot is process-local. Meta pathHash / status=ready is not a live claim —
		// skipping here after workspace_meta hydrate left I/O on no-slot (18:33).
		if (project.slotLive) return;
		// Gone ink probe tmp: Meta may still carry a hash. Re-Register paints a banner.
		if (isEchoProbePath(project.path) && project.workspaceId) return;
		this.bridge.send({type: 'RegisterWorkspace', path: project.path});
	}

	/** Claim checkout I/O. Default stays lazy until Task/focus. Probe tmp never claims. */
	private claimSlot(project: OpenProject): void {
		if (project.isDefault && !this.defaultShouldRegister(project)) return;
		this.ensureRegistered(project);
	}

	/** Review I/O waits for RegisterWorkspace accepted on this connection — not Meta pathHash. */
	private ensureRegisteredAsync(project: OpenProject): Promise<void> {
		if (project.slotLive && project.workspaceId) return Promise.resolve();
		const failed = this.registerFailed.get(project.id);
		if (failed) return Promise.reject(new Error(failed));
		this.ensureRegistered(project);
		if (project.slotLive && project.workspaceId) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const waiter: RegisterWaiter = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.dropRegisterWaiter(project.id, waiter);
					reject(new Error('timeout waiting for RegisterWorkspace'));
				}, this.registerWaitMs)
			};
			const waiters = this.registerWaiters.get(project.id) ?? new Set<RegisterWaiter>();
			waiters.add(waiter);
			this.registerWaiters.set(project.id, waiters);
		});
	}

	private settleRegisterWaiters(project: OpenProject): void {
		this.registerFailed.delete(project.id);
		const waiters = this.registerWaiters.get(project.id);
		if (!waiters) return;
		this.registerWaiters.delete(project.id);
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
	}

	/** `projectId: null` fails every pending waiter (engine-wide failure / shutdown). */
	private failRegisterWaiters(projectId: string | null, message: string): void {
		const fail = (id: string, waiters: Set<RegisterWaiter>) => {
			this.registerWaiters.delete(id);
			this.registerFailed.set(id, message);
			for (const waiter of waiters) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error(message));
			}
		};
		if (projectId === null) {
			for (const [id, waiters] of this.registerWaiters) fail(id, waiters);
			return;
		}
		const waiters = this.registerWaiters.get(projectId);
		if (waiters) fail(projectId, waiters);
	}

	private dropRegisterWaiter(projectId: string, waiter: RegisterWaiter): void {
		const waiters = this.registerWaiters.get(projectId);
		if (!waiters) return;
		waiters.delete(waiter);
		if (waiters.size === 0) this.registerWaiters.delete(projectId);
	}

	private defaultShouldRegister(project: OpenProject): boolean {
		if (!project.isDefault) return true;
		const known = [...project.sessions.listTasks(), ...project.sessions.listChats()];
		return known.some(t => Boolean(t.sessionId) || t.pendingNew);
	}

	private startEngine(handlers: WorkspaceProjectHandlers): void {
		this.shuttingDown = false;
		this.engineHandshakeOk = false;
		if (!this.isRemote()) mkdirSync(this.hostCwd, {recursive: true});
		this.setEngineStatus(this.rebindAttempts > 0 ? 'reconnecting' : 'starting');
		const bridge = this.createBridge();
		this.bridge = bridge;
		const remote = this.remoteOpts
			? {...this.remoteOpts, timeoutMs: this.remoteOpts.timeoutMs ?? CONNECT_DEADLINE_MS}
			: undefined;

		void Promise.resolve(
			bridge.start(
				this.hostCwd,
				{
					onEvent: event => {
						if (event.type === 'HelloOk' && event.hostHome) this.hostHome = event.hostHome;
						this.onBridgeEvent(event, handlers);
					},
					onError: message => {
						if (this.switchingEdge) return;
						if (this.reconcileTerminalParseFailure(message, handlers)) return;
						this.setEngineStatus('error', message);
						handlers.onError('engine', message);
					},
					onLog: message => handlers.onLog?.('engine', message),
					onExit: (code, signal) => {
						if (this.switchingEdge || this.shuttingDown) return;
						this.handleEngineExit(bridge, handlers, code, signal);
					}
				},
				{
					sessionMode: 'continue',
					remote,
					clientId: this.createClientId(),
					wantEngineId: process.env.FAST_WANT_ENGINE_ID
				}
			)
		)
			.then(() => {
				if (this.bridge === bridge) this.engineHandshakeOk = true;
			})
			.catch(error => {
				if (this.bridge === bridge) this.bridge = null;
				if (error instanceof Error && error.name === 'AbortError') return;
			});
	}

	/**
	 * Resolve Composer model chrome to a ListProviders row.
	 * Prefer Settings `models.defaultPlatform/defaultModel`, else the provider model
	 * that still carries the yaml `default` alias, else the first enabled DB model.
	 * Never paint the models.yaml nemotron stub.
	 */
	private reconcileTerminalParseFailure(
		message: string,
		handlers: WorkspaceProjectHandlers
	): boolean {
		if (!message.startsWith(TERMINAL_PARSE_FAILURE_PREFIX)) return false;
		for (const project of this.projects.values()) {
			project.sessions.resyncAttached();
		}
		handlers.onLog?.('engine', message);
		return true;
	}

	/** Consecutive Zod failures — notice only, not an engine crash. */
	private noticeProtocolMismatch(
		message: string,
		handlers: WorkspaceProjectHandlers
	): boolean {
		if (!message.startsWith(PROTOCOL_MISMATCH_PREFIX)) return false;
		for (const project of this.projects.values()) {
			project.sessions.noteHelp('errors.protocol.mismatch');
		}
		handlers.onLog?.('engine', message);
		return true;
	}

	private onBridgeEvent(event: BridgeEvent, handlers: WorkspaceProjectHandlers): void {
		if (event.type === 'command_result') {
			if (this.dispatchCommandResult(event, handlers)) return;
		} else if (this.dispatchTypedEvent(event, handlers)) {
			return;
		}
		this.demuxSession(event, handlers);
	}

	private dispatchCommandResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): boolean {
		if (event.requestId) this.hostWait.resolveByRequestId(event);
		if (HostWaitCommands.has(event.name)) {
			const eventCheckout =
				'pathHash' in event && typeof event.pathHash === 'string'
					? this.projectForHash(event.pathHash)?.id
					: undefined;
			this.hostWait.resolveByName(event, eventCheckout);
			handlers.onEvent('engine', event);
			return true;
		}
		if (this.adopt.handleCommand(event, handlers)) return true;
		if (event.name === 'SetSessionTitle' || event.name === 'UpdateSessionStatus') {
			this.fanoutSessionChrome(event, handlers);
			return true;
		}
		return false;
	}

	private dispatchTypedEvent(event: BridgeEvent, handlers: WorkspaceProjectHandlers): boolean {
		return (this.typedBridge[event.type] ?? this.unhandledType)(event, handlers);
	}

	private readonly unhandledType = (_event: BridgeEvent, _handlers: WorkspaceProjectHandlers): boolean =>
		false;

	private readonly typedBridge: Record<
		string,
		(event: BridgeEvent, handlers: WorkspaceProjectHandlers) => boolean
	> = {
		engine_install_log: event => {
			if (event.type !== 'engine_install_log') return false;
			this.engineHandlers?.onEngineInstallLog?.(event);
			return true;
		},
		HelloOk: event => {
			if (event.type !== 'HelloOk') return false;
			if (event.hostHome) this.hostHome = event.hostHome;
			return true;
		},
		ready: (event, handlers) => {
			if (event.type !== 'ready') return false;
			this.handleReady(event, handlers);
			return true;
		},
		workspace_meta: (event, handlers) => {
			if (event.type !== 'workspace_meta') return false;
			this.adopt.applyWorkspaceMeta(event, handlers);
			handlers.onEvent('engine', event);
			return true;
		},
		settings_changed: (event, handlers) => {
			if (event.type !== 'settings_changed') return false;
			if (event.namespace === 'models') void this.composerHeal.refreshComposerChrome(handlers);
			handlers.onEvent('engine', event);
			return true;
		},
		providers_changed: (event, handlers) => {
			this.composerHeal.syncComposerCatalog();
			handlers.onEvent('engine', event);
			return true;
		},
		skills_changed: (event, handlers) => {
			handlers.onEvent('engine', event);
			return true;
		},
		open_project_set: (event, handlers) => {
			handlers.onEvent('engine', event);
			return true;
		},
		tree_advanced: (event, handlers) => this.fanoutCheckoutPush(event, handlers),
		review_changed: (event, handlers) => this.fanoutCheckoutPush(event, handlers),
		workspace_file_changed: (event, handlers) => {
			if (event.type !== 'workspace_file_changed') return false;
			if (this.isLocalSaveEcho(event)) return true;
			this.fanoutCheckoutPush(event, handlers);
			return true;
		},
		host_error: (event, handlers) => {
			if (event.type !== 'host_error') return false;
			handlers.onError('engine', event.message);
			handlers.onEvent('engine', event);
			return true;
		},
		error: (event, handlers) => this.handleBareError(event, handlers),
		sessions_list: (event, handlers) => {
			if (event.type !== 'sessions_list') return false;
			this.adopt.handleSessionsList(event, handlers);
			return true;
		}
	};

	private handleReady(
		event: Extract<BridgeEvent, {type: 'ready'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		// ready is not SessionBind authority — CreateSession command_result + taskId binds.
		// Do not re-GetWorkspaceMeta on every ready (cold-start only on firstReady).
		// Engine-level model chrome must still reach every Project SessionController —
		// Hello ready often has no sessionId, and the old path skipped handleEvent entirely
		// leaving Composer stuck on the placeholder "Default".
		const firstReady = this.engineStatus !== 'ready';
		const wasReconnecting = this.engineStatus === 'reconnecting';
		this.setEngineStatus('ready');
		// Do not zero backoff on the first ready after a drop — a 2s write-stall
		// used to reset this and spin Hello/CreateProject every ~5s.
		this.armStableLease();
		this.lastReady = event;

		for (const project of this.projects.values()) {
			project.status = 'ready';
			project.error = undefined;
			project.sessions.handleEvent(event);
		}

		const active = this.getActive();
		if (active) {
			handlers.onEvent(active.id, event);
			handlers.onSessionsChanged?.(active.id);
		} else {
			handlers.onEvent('engine', event);
		}

		if (!wasReconnecting) {
			void this.composerHeal.refreshComposerChrome(handlers);
		}

		if (firstReady) {
			for (const project of this.projects.values()) {
				if (project.isDefault) continue;
				if (!this.isRemote() && !project.metaProjectId) {
					this.bridge?.send({
						type: 'CreateProject',
						projectType: 'coding',
						rootPath: project.path,
						displayName: path.basename(project.path)
					});
				}
				this.bridge?.send({type: 'RegisterWorkspace', path: project.path});
			}
			this.requestWorkspaceMeta();
		}
	}

	private fanoutCheckoutPush(event: BridgeEvent, handlers: WorkspaceProjectHandlers): boolean {
		const pathHash =
			'pathHash' in event && typeof event.pathHash === 'string' ? event.pathHash : undefined;
		const project = this.projectForHash(pathHash);
		if (project) handlers.onEvent(project.id, event);
		return true;
	}

	private fanoutSessionChrome(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		const sessionId =
			'sessionId' in event && typeof (event as {sessionId?: string}).sessionId === 'string'
				? (event as {sessionId: string}).sessionId
				: undefined;
		const project = sessionId ? this.projectForSession(sessionId) : this.getActive();
		if (project) {
			project.sessions.handleEvent(event);
			handlers.onEvent(project.id, event);
			handlers.onSessionsChanged?.(project.id);
		} else {
			handlers.onEvent('engine', event);
		}
	}

	private handleBareError(event: BridgeEvent, handlers: WorkspaceProjectHandlers): boolean {
		if (event.type !== 'error' || sessionIdFromEvent(event) !== undefined) return false;
		const msg = typeof event.message === 'string' ? event.message : '';
		const pending = [...this.projects.values()].find(p => p.pendingDisplayName);
		if (pending && (msg.includes('SetProjectDisplayName') || msg.includes('Unknown command type'))) {
			delete pending.pendingDisplayName;
			handlers.onError(
				pending.id,
				msg.includes('Unknown command')
					? 'Engine too old for project rename — rebuild/reinstall fast-agent'
					: msg
			);
		}
		handlers.onEvent(pending?.id ?? 'engine', event);
		return true;
	}

	private demuxSession(event: BridgeEvent, handlers: WorkspaceProjectHandlers): void {
		const sessionId =
			sessionIdFromEvent(event) ??
			(event.type === 'command_result' && 'sessionId' in event
				? (event as {sessionId?: string}).sessionId
				: undefined);

		if (isSessionStreamEvent(event.type)) {
			if (!sessionId) {
				handlers.onLog?.('engine', `[session-demux] drop ${event.type} without sessionId`);
				return;
			}
			const project = this.projectForSession(sessionId);
			if (!project) {
				handlers.onLog?.(
					'engine',
					`[session-demux] drop ${event.type} session unmatched: ${sessionId}`
				);
				return;
			}
			project.sessions.handleEvent(event);
			handlers.onEvent(project.id, event);
			return;
		}

		const project = sessionId ? this.projectForSession(sessionId) : this.getActive();
		if (!project) {
			handlers.onEvent('engine', event);
			return;
		}
		project.sessions.handleEvent(event);
		handlers.onEvent(project.id, event);
	}

	private requestProjectSessionsList(project: OpenProject): void {
		this.pendingSessionsList.add(project.id);
		project.sessions.requestSessionsList();
	}

	private projectForSession(sessionId: string | undefined): OpenProject | null {
		if (!sessionId) return null;
		for (const project of this.projects.values()) {
			const hit =
				project.sessions.listTasks().find(t => t.sessionId === sessionId) ??
				project.sessions.listChats().find(t => t.sessionId === sessionId);
			if (hit) return project;
			if (project.sessions.isAttached(sessionId)) return project;
		}
		return null;
	}

	/** The checkout a path hash names, by either alias the engine may have registered it under. */
	private projectForHash(pathHash: string | undefined): OpenProject | null {
		if (!pathHash) return null;
		const hash = pathHash.replace(/^workspace:/, '');
		for (const project of this.projects.values()) {
			if (project.workspaceId === hash || projectHash(project.path) === hash) return project;
		}
		return null;
	}

	private scheduleRebind(handlers: WorkspaceProjectHandlers): void {
		if (this.switchingEdge || this.shuttingDown) return;
		this.setEngineStatus('reconnecting');
		const delay = Math.min(this.rebindBaseMs * 2 ** this.rebindAttempts, 15_000);
		this.rebindAttempts += 1;
		if (this.rebindTimer) clearTimeout(this.rebindTimer);
		this.rebindTimer = setTimeout(() => {
			this.rebindTimer = null;
			this.startEngine(handlers);
		}, delay);
	}

	/** Reset backoff only after the lease survives past a write-stall window. */
	private armStableLease(): void {
		if (this.rebindResetTimer) clearTimeout(this.rebindResetTimer);
		if (this.rebindAttempts === 0) return;
		this.rebindResetTimer = setTimeout(() => {
			this.rebindResetTimer = null;
			this.rebindAttempts = 0;
		}, this.stableLeaseMs);
	}

	private setEngineStatus(status: EngineHostStatus, error?: string): void {
		this.engineStatus = status;
		this.engineError = error;
		this.engineHandlers?.onEngineStatus?.(status, error);
	}
}
