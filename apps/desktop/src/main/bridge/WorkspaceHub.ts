import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {TERMINAL_PARSE_FAILURE_PREFIX, PROTOCOL_MISMATCH_PREFIX, type BridgeEvent} from '@fastllm/bridge-protocol';
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
	EngineCallResult,
	EngineWireRow,
	HostDirResult,
	HostDirCreateResult
} from '@fast-ide/session-view';
import {stopOwnedLocal, type RemoteBridgeConnectionOptions} from '@fastllm/bridge-client';
import {BridgeClient} from './BridgeClient.js';
import {LOCAL_EDGE_ID, edgeCapabilities, type EdgeCapabilities} from '../remoteEdges.js';
import {isReservedDefaultFolder} from './remotePaths.js';
import {isLocalSaveEcho, rememberLocalSave} from './localSaveEcho.js';
import {SessionController} from './SessionController.js';
import {isDefaultProjectPath} from './defaultProject.js';
import {projectHash} from './projectHash.js';
import {sessionIdFromEvent} from './sessionEvents.js';
import {createHostWait, type HostLane, type HostWait} from './workspace/hostWait.js';
import {createTeams, type WorkspaceTeams} from './workspace/teams.js';
import {createSchedule, type WorkspaceSchedule} from './workspace/schedule.js';
import {createCatalog, type WorkspaceCatalog} from './workspace/catalog.js';
import {createPlugins, type WorkspacePlugins} from './workspace/plugins.js';
import {createMcp, type WorkspaceMcp} from './workspace/mcp.js';
import type {McpServerOp} from '@fastllm/bridge-client';
import {createReview, type WorkspaceReview} from './workspace/review.js';
import {createCheckout, type WorkspaceCheckout} from './workspace/checkout.js';
import {createComposerHeal, type ComposerHeal} from './workspace/composerHeal.js';
import {createAdopt, isEchoProbePath, type WorkspaceAdopt} from './workspace/adopt.js';
import {createEngine, type WorkspaceEngine} from './workspace/engine.js';
import {createProjects, type WorkspaceProjects} from './workspace/projects.js';
import {createDemux, type WorkspaceDemux} from './workspace/demux.js';
import {pickerEngineIds} from './workspace/enginePickerIds.js';

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
	/** Hub `waitByRequestId` budget (EngineCall / FS). Tests shorten this to prove the timeout text. */
	requestWaitMs?: number;
	/** RegisterWorkspace waiter. Tests shorten this. */
	registerWaitMs?: number;
	/** First rebind delay (ms). Next attempt doubles, cap 15s. Tests shorten this. */
	rebindBaseMs?: number;
	/** After ready, wait this long before clearing rebind backoff. */
	stableLeaseMs?: number;
	/** Write committed activeId after HelloOk. */
	persistActiveId?: (id: string) => void;
	/** Cloudflare tunnel origin port (cloudflare-tunnel-pairing.md §4.6.3): default BridgeClient opens loopback plaintext `--ws 127.0.0.1:<port>`. */
	loopbackWsPort?: number;
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
	private lastPickerEngineIds: string[] = ['fast'];
	private lastRegistryIds = new Set<string>(['fast']);
	private pickerRefreshTimers: ReturnType<typeof setTimeout>[] = [];
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
	private readonly mcp: WorkspaceMcp;
	private readonly review: WorkspaceReview;
	private readonly checkout: WorkspaceCheckout;
	private readonly composerHeal: ComposerHeal;
	private readonly adopt: WorkspaceAdopt;
	private readonly engine: WorkspaceEngine;
	private readonly projectOps: WorkspaceProjects;
	private readonly demux: WorkspaceDemux;

	constructor(deps: WorkspaceHubDeps = {}) {
		this.createBridge =
			deps.createBridge ?? (() => new BridgeClient({loopbackWsPort: deps.loopbackWsPort}));
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
		this.mcp = createMcp(lane);
		this.review = createReview({
			...lane,
			ensureSlot: async projectId => {
				const project = this.projects.get(projectId);
				if (!project) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
				if (!this.bridge || this.engineStatus !== 'ready') return {ok: false, notice: 'Engine not ready'};
				if (!project.slotLive) {
					try {
						await this.projectOps.ensureRegisteredAsync(project);
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
			mintAdopted: input => this.projectOps.mintAdoptedProject(input),
			pendingSessions: this.pendingSessionsList,
			requestSessionsList: p => this.requestProjectSessionsList(p as OpenProject)
		});
		this.projectOps = createProjects(this as never);
		this.engine = createEngine(this as never);
		this.demux = createDemux(this as never);
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
		return this.engine.switchEdge(target, handlers);
	}

	async openRemoteProject(serverPath: string, handlers: WorkspaceProjectHandlers): Promise<ProjectSnapshot> {
		return this.engine.openRemoteProject(serverPath, handlers);
	}

	async listHostDir(dirPath?: string) {
		return this.checkout.listHostDir(dirPath);
	}
	async createHostDir(parent: string, name: string) {
		return this.checkout.createHostDir(parent, name);
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

	async engineCall(method: string, payload: Record<string, unknown> = {}, sessionId?: string): Promise<EngineCallResult> {
		return this.engine.engineCall(method, payload, sessionId);
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
		return this.projectOps.ensureTasksLive(taskIds);
	}

	/** Resolve Project + live Task id (hydrate may remint local ids; sessionId is stable). */
	resolveTaskRef(taskId: string, sessionId?: string | null): {project: OpenProject; taskId: string} | null {
		return this.projectOps.resolveTaskRef(taskId, sessionId);
	}

	/**
	 * LivingTask / schedule row click: focus open Project + select Task by Engine sessionId.
	 * `metaProjectId` is Meta resource id (not local folder id). Does not auto-open folders.
	 */
	openLivingSession(sessionId: string, metaProjectId?: string | null):
		| {ok: true; taskId: string; title: string; kind?: string; sessionId: string | null}
		| {ok: false; notice: string} {
		return this.projectOps.openLivingSession(sessionId, metaProjectId);
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

	ensureEngine(handlers: WorkspaceProjectHandlers): void { this.engine.ensureEngine(handlers); }

	openProject(workspaceRoot: string, handlers: WorkspaceProjectHandlers): ProjectSnapshot {
		if (this.isRemote()) {
			throw new Error('Cannot open a local folder on a remote edge');
		}
		const normalized = path.resolve(workspaceRoot);
		if (isDefaultProjectPath(normalized, this.homeDir)) {
			throw new Error('Cannot open the hidden Default Project as a folder Project');
		}
		return this.projectOps.openInternal(normalized, handlers, false);
	}

	ensureDefaultProject(handlers: WorkspaceProjectHandlers): ProjectSnapshot { return this.projectOps.ensureDefaultProject(handlers); }

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

	closeProject(projectId: string): boolean { return this.projectOps.closeProject(projectId); }

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

	closeAll(): void { this.projectOps.closeAll(); }

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
		const result = await this.catalog.upsertProvider(input);
		if (result.ok) this.composerHeal.invalidateComposerCatalog();
		return result;
	}
	async deleteProvider(id: string) {
		const result = await this.catalog.deleteProvider(id);
		if (result.ok) this.composerHeal.invalidateComposerCatalog();
		return result;
	}
	async setProviderEnabled(id: string, enabled: boolean) {
		const result = await this.catalog.setProviderEnabled(id, enabled);
		if (result.ok) this.composerHeal.invalidateComposerCatalog();
		return result;
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
	async listMcpServers() {
		return this.mcp.listMcpServers();
	}
	async mcpServerControl(name: string, op: string) {
		return this.mcp.mcpServerControl(name, op as McpServerOp);
	}
	async mcpServerPut(name: string, config: unknown) {
		return this.mcp.mcpServerPut(name, config);
	}
	async mcpServerEnabled(name: string, enabled: boolean) {
		return this.mcp.mcpServerEnabled(name, enabled);
	}
	async mcpServerDelete(name: string) {
		return this.mcp.mcpServerDelete(name);
	}
	async mcpConfigImport(payload: unknown) {
		return this.mcp.mcpConfigImport(payload);
	}
	async mcpConfigReload() {
		return this.mcp.mcpConfigReload();
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
		this.lastPickerEngineIds = pickerEngineIds(rows);
		const registry = new Set(
			rows.filter(r => r.inRegistry).map(r => r.id.trim().toLowerCase()).filter(Boolean)
		);
		const gained = [...registry].filter(id => !this.lastRegistryIds.has(id));
		this.lastRegistryIds = registry;
		for (const project of this.projects.values()) {
			project.sessions.setAvailableEngines(this.lastPickerEngineIds);
			const kind = project.sessions.engineKind;
			if (kind && gained.includes(kind)) project.sessions.rebindPickedEngine();
		}
	}

	private stampAvailableEngines(sessions: SessionController): void {
		sessions.setAvailableEngines(this.lastPickerEngineIds);
	}

	private refreshPickerEngines(handlers: WorkspaceProjectHandlers): void {
		void this.listEngines().then(() => {
			const id = this.getActive()?.id ?? 'engine';
			handlers.onSessionsChanged?.(id);
		});
	}

	private clearPickerRefresh(): void {
		for (const timer of this.pickerRefreshTimers) clearTimeout(timer);
		this.pickerRefreshTimers = [];
	}

	private schedulePickerRefresh(handlers: WorkspaceProjectHandlers): void {
		this.clearPickerRefresh();
		for (const ms of [2_000, 6_000]) {
			this.pickerRefreshTimers.push(
				setTimeout(() => {
					if (this.shuttingDown || this.engineStatus !== 'ready') return;
					this.refreshPickerEngines(handlers);
				}, ms)
			);
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
			if (this.demux.dispatchCommandResult(event, handlers)) return;
		} else if (this.demux.dispatchTypedEvent(event, handlers)) {
			return;
		}
		this.demux.demuxSession(event, handlers);
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
			this.engine.startEngine(handlers);
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
