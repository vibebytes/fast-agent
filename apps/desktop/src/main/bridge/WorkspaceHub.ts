import {existsSync, mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
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
import type {RemoteBridgeConnectionOptions} from '@fastllm/bridge-client';
import {BridgeClient} from './BridgeClient.js';
import {CONNECT_DEADLINE_MS, LOCAL_EDGE_ID, edgeCapabilities, type EdgeCapabilities} from '../remoteEdges.js';
import {isReservedDefaultFolder, sameRemotePath} from './remotePaths.js';
import {discoverHostSlashSkills} from './hostSkillDiscovery.js';
import {isLocalSaveEcho, rememberLocalSave} from './localSaveEcho.js';
import {isUnresolvedModelDisplay} from '../../shared/defaultModel.js';
import {catalogFromProviders} from './modelCatalog.js';
import {isPlaceholderModelDisplay, pickIdList, SessionController} from './SessionController.js';
import {matchCatalogEntry} from '../../shared/modelMatch.js';
import {defaultProjectPath, defaultProjectPathOnHost, isDefaultProjectPath} from './defaultProject.js';
import {projectHash} from './projectHash.js';
import {isSessionStreamEvent, sessionIdFromEvent} from './sessionStreamEvents.js';

export type {AmbientRule, EngineHostStatus, ProjectSnapshot, ProjectStatus};

/** Taken off the protocol rather than restated, so a daemon field cannot drift away unnoticed. */
type ReviewPayload = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['review']>;
type ExtWireRow = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['extensions']>[number];
type ExtWireNote = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['ledger']>[number];

/**
 * How long a restore may take before it reads as failed. Longer than the read wait because this one
 * writes the work tree, and a large undo on a slow disk is still working.
 */
const RestoreWaitMs = 60_000;

/** How long a review op waits for a missing slot registration before giving up. */
const RegisterWaitMs = 12_000;

/**
 * `command_result` names answered to a host caller rather than to an attached session.
 *
 * These replies are sent with `stampSession = false`, so they carry no sessionId and the session demux
 * would otherwise hand them to whichever Task is focused. A name missing from here does not fail
 * loudly — its caller just waits out its timeout — so anything added to the invoke surface belongs
 * here too.
 */
const HostWaitCommands = new Set([
	'GetSettings',
	'PatchSettings',
	'ListProviders',
	'UpsertProvider',
	'DeleteProvider',
	'SetProviderEnabled',
	'TestProvider',
	'PatchProviderModels',
	'SearchProviderModels',
	'ListSkills',
	'CreateSkill',
	'DeleteSkill',
	'SetSkillEnabled',
	'SearchSkillMarket',
	'InstallSkillFromMarket',
	'UninstallSkillFromMarket',
	'ListExtensions',
	'ExtensionStatus',
	'InstallExtension',
	'UninstallExtension',
	'ListEngines',
	'EnableEngine',
	'DisableEngine',
	'StartEngine',
	'StopEngine',
	'SetDefaultEngine',
	'InstallEngine',
	'UninstallEngine',
	'CancelEngineInstall',
	'ListHostDir',
	'CreateHostDir',
	'ListRules',
	'AddRule',
	'RemoveRule',
	'SetRuleEnabled',
	'ListScheduledJobs',
	'CreateScheduledJob',
	'ListLivingTasks',
	'ListScheduledJobRuns',
	'PauseScheduledJob',
	'ResumeScheduledJob',
	'CancelScheduledJob',
	'FireNowScheduledJob',
	'UpdateScheduledJobCron',
	'ListTeams',
	'ListGoals',
	'ListAgents',
	'CreateTeam',
	'UpdateTeam',
	'ArchiveTeam',
	'UnarchiveTeam',
	'GetTeam',
	'CreateAgent',
	'UpdateAgent',
	'ArchiveAgent',
	'UnarchiveAgent',
	'CloneAgent',
	'GetAgent',
	'DeleteTeam',
	'SaveAsTeam',
	'PromoteTeam',
	'DeleteAgent',
	'StopAgentRun',
	'DeleteGoal',
	'ListReviewChanges',
	'GetReviewChange',
	'KeepChanges',
	'PreviewRevert',
	'ApplyRevert',
	'RedoRevert',
	'ListWorkspaceDir',
	'GetWorkspaceFile',
	'SaveWorkspaceFile',
	'GitWorkspaceStatus',
	'DshCall'
]);

const WorkspaceFsCodes = new Set<string>([
	'outside',
	'too-large',
	'binary',
	'conflict',
	'missing',
	'no-slot',
	'busy',
	'is-dir',
	'not-found',
	'not-dir',
	'denied',
	'invalid',
	'exists'
]);

function asFsCode(raw: unknown): WorkspaceFsCode | undefined {
	return typeof raw === 'string' && WorkspaceFsCodes.has(raw) ? (raw as WorkspaceFsCode) : undefined;
}

/** Engine `RegisterWorkspace` / CreateProject when the root is gone (probe tmp, deleted folder). */
function registerMissingDir(message: string): string | undefined {
	const m = /^not a directory:\s*(.+)$/.exec(message.trim());
	const dir = m?.[1]?.trim();
	return dir || undefined;
}

/** ink / EnsureProject probe tmp — Meta may keep a pathHash after the dir is gone. */
function isEchoProbePath(p: string): boolean {
	return /queue-echo-probe-/.test(p);
}

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
	private ruleWaiters = new Map<
		string,
		{
			names: Set<string>;
			/** Meta project id — match command_result.projectId when stamped. */
			projectId?: string;
			/** Open Project id — match the checkout `command_result.pathHash` resolves to (review). */
			checkoutProjectId?: string;
			resolve: (event: Extract<BridgeEvent, {type: 'command_result'}>) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	/** Parallel FS waits — match `command_result.requestId`, not name. */
	private requestWaiters = new Map<
		string,
		{
			requestId: string;
			resolve: (event: Extract<BridgeEvent, {type: 'command_result'}>) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private ruleWaitSeq = 0;
	/** Host connection id learned from our own Save echoes (`workspace_file_changed.connectionId`). */
	private bridgeConnectionId: string | undefined;
	/** Recent local Save fingerprints for echo suppress before connectionId is known. */
	private recentLocalSaves = new Map<string, number>();
	/** SCM chrome cache — keyed by bare workspaceId (same as ListWorkspaceDir root). */
	private readonly gitNotUntil = new Map<string, number>();
	private readonly gitFresh = new Map<string, {at: number; snapshot: GitStatus | null}>();
	private readonly gitInFlight = new Map<string, Promise<GitStatus | null>>();
	/** Bumps on each probe so a superseded in-flight reply cannot clobber a newer cache write. */
	private readonly gitGen = new Map<string, number>();
	/** Serialize Rules IPC so concurrent List/Add/Remove cannot cross-resolve waiters. */
	private ruleOpTail: Promise<void> = Promise.resolve();
	/** Per-checkout review tail — same reason, but two checkouts need not wait on each other. */
	private readonly reviewTails = new Map<string, Promise<void>>();
	/** Review ops parked until the project's RegisterWorkspace result mints a slot hash. */
	private readonly registerWaiters = new Map<string, Set<RegisterWaiter>>();
	/** Projects whose RegisterWorkspace already failed — later review ops fail fast instead of re-waiting. */
	private readonly registerFailed = new Map<string, string>();

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
					clientId: this.createClientId()
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
		const project = this.adoptExistingFolder(raw, handlers, undefined, undefined, undefined, {
			isDefault: false,
			skipDisk: true
		});
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

	async listHostDir(dirPath?: string): Promise<HostDirResult> {
		if (!this.isRemote()) {
			return {ok: false, error: 'host:listDir is only available on a remote edge', code: 'denied', entries: []};
		}
		if (this.pendingEdgeId) {
			return {ok: false, error: 'Edge switch in progress', code: 'denied', entries: []};
		}
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: 'Engine not ready', code: 'denied', entries: []};
		}
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(
			requestId,
			// Production default min(12s, 8s)=8s. Tests shorten requestWaitMs so timeout is not 8s.
			Math.min(this.requestWaitMs, CONNECT_DEADLINE_MS)
		);
		if (
			!this.bridge.send({
				type: 'ListHostDir',
				requestId,
				...(dirPath?.trim() ? {path: dirPath.trim()} : {})
			})
		) {
			this.cancelWait(token);
			return {ok: false, error: 'Failed to send ListHostDir', entries: []};
		}
		try {
			const event = await promise;
			const message = event.message ?? '';
			if (/unknown command/i.test(message)) {
				return {
					ok: false,
					error: message,
					code: 'unknown-command',
					fallback: true,
					home: this.hostHome,
					entries: []
				};
			}
			const fs = event.fs;
			const code = asFsCode(fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || code) {
				const mapped =
					code === 'not-found' || code === 'not-dir' || code === 'denied' || code === 'invalid'
						? code
						: undefined;
				return {
					ok: false,
					error: message || code || 'ListHostDir failed',
					code: mapped,
					home: typeof fs?.home === 'string' ? fs.home : this.hostHome,
					entries: []
				};
			}
			const home = typeof fs?.home === 'string' ? fs.home : (this.hostHome ?? '');
			const listed = typeof fs?.path === 'string' ? fs.path : (dirPath?.trim() || home);
			const entries = Array.isArray(fs?.entries)
				? fs.entries
						.filter(e => e.kind === 'dir' && !isReservedDefaultFolder(e.path ?? e.name))
						.map(e => ({
							name: e.name,
							path: e.path ?? e.relativePath ?? e.name,
							kind: 'dir' as const
						}))
				: [];
			if (home && !this.hostHome) this.hostHome = home;
			return {ok: true, path: listed, home, entries, truncated: fs?.truncated};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				error: message,
				code: 'timeout',
				home: this.hostHome,
				entries: []
			};
		}
	}

	async createHostDir(parent: string, name: string): Promise<HostDirCreateResult> {
		if (!this.isRemote()) {
			return {ok: false, error: 'host:createDir is only available on a remote edge', code: 'denied'};
		}
		if (this.pendingEdgeId) {
			return {ok: false, error: 'Edge switch in progress', code: 'denied'};
		}
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: 'Engine not ready', code: 'denied'};
		}
		const folder = parent.trim();
		const segment = name.trim();
		if (!folder || !segment) return {ok: false, error: 'invalid', code: 'invalid'};
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(
			requestId,
			Math.min(this.requestWaitMs, CONNECT_DEADLINE_MS)
		);
		if (!this.bridge.send({type: 'CreateHostDir', requestId, parent: folder, name: segment})) {
			this.cancelWait(token);
			return {ok: false, error: 'Failed to send create directory'};
		}
		try {
			const event = await promise;
			const message = event.message ?? '';
			if (/unknown command/i.test(message)) {
				return {
					ok: false,
					error: message,
					code: 'unknown-command',
					fallback: true,
					home: this.hostHome
				};
			}
			const fs = event.fs;
			const code = asFsCode(fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || code) {
				const mapped =
					code === 'not-found' ||
					code === 'not-dir' ||
					code === 'denied' ||
					code === 'invalid' ||
					code === 'exists'
						? code
						: undefined;
				return {
					ok: false,
					error: message || code || 'create directory failed',
					code: mapped,
					home: typeof fs?.home === 'string' ? fs.home : this.hostHome
				};
			}
			const created =
				typeof fs?.path === 'string' && fs.path.trim()
					? fs.path
					: `${folder.replace(/[/\\]+$/, '')}/${segment}`;
			const home = typeof fs?.home === 'string' ? fs.home : (this.hostHome ?? '');
			if (home && !this.hostHome) this.hostHome = home;
			return {
				ok: true,
				path: created,
				home,
				name: typeof fs?.name === 'string' ? fs.name : segment
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {ok: false, error: message, code: 'timeout', home: this.hostHome};
		}
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
		const {token, promise} = this.waitByRequestId(requestId);
		if (
			!this.bridge.send({
				type: 'Call',
				method,
				payload,
				requestId,
				...(sid ? {sessionId: sid} : {})
			})
		) {
			this.cancelWait(token);
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
			const project = this.adoptExistingFolder(root, handlers, 'default-project', undefined, 'Default Project', {
				isDefault: true,
				skipDisk: true
			});
			if (!project) throw new Error('Failed to adopt remote default project');
			project.sessions.hydrateFromMeta([]);
			this.focusProject(project.id);
			return this.snapshot(project);
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

	private runRuleOp<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.ruleOpTail.then(fn, fn);
		this.ruleOpTail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async listScheduledJobs(projectId?: string | null): Promise<
		| {
				ok: true;
				jobs: Array<{
					id: string;
					kind: string;
					status: string;
					sessionId: string;
					projectId?: string | null;
					cronExpr?: string | null;
					timezone?: string | null;
					nextFireAt?: string | null;
					title?: string | null;
					promptText?: string | null;
					targetKind?: string | null;
					targetRef?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const metaId = projectId ? this.metaIdFor(projectId) : undefined;
		if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['ListScheduledJobs'], metaId);
		const sent = this.bridge.send({
			type: 'ListScheduledJobs',
			...(metaId ? {projectId: metaId} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListScheduledJobs'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const jobs = Array.isArray(event.scheduledJobs) ? event.scheduledJobs : [];
			return {
				ok: true,
				jobs: jobs.map(j => {
					const row = j as {
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
						projectDisplayName?: string | null;
					};
					const meta = row.projectId?.trim();
					const open = meta ? this.projectByMetaId(meta) : null;
					const projectDisplayName =
						open?.displayName?.trim() ||
						(open ? path.basename(open.path) : undefined) ||
						row.projectDisplayName ||
						undefined;
					return {...row, ...(projectDisplayName ? {projectDisplayName} : {})};
				})
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listTeams(projectId?: string | null): Promise<{ok: true; teams: TeamRow[]} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const metaId = projectId ? this.metaIdFor(projectId) : undefined;
		if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['ListTeams'], metaId);
		const sent = this.bridge.send({
			type: 'ListTeams',
			...(metaId ? {projectId: metaId} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListTeams'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const teams = Array.isArray(event.teams) ? event.teams : [];
			return {
				ok: true,
				teams: teams.map(t => this.enrichTeam(t as TeamRow))
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listGoals(
		projectId?: string | null,
		status?: string | null
	): Promise<
		| {
				ok: true;
				goals: Array<{
					id: string;
					status: string;
					name?: string | null;
					statement?: string | null;
					acceptance?: string | null;
					originSessionId?: string | null;
					controlSessionId?: string | null;
					teamId?: string | null;
					projectId?: string | null;
					projectDisplayName?: string | null;
					currentStepIds?: string[] | null;
					activeRunIds?: string[] | null;
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId?: string | string[] | null;
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId?: string | string[] | null;
					confirmedAt?: string | null;
					createdAt?: string | null;
					resultSummary?: string | null;
					escalateActions?: string[];
					workflowJson?: string | null;
					budgetJson?: string | null;
					progressJson?: string | null;
					loopAgentId?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const metaId = projectId ? this.metaIdFor(projectId) : undefined;
		if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['ListGoals'], metaId);
		const sent = this.bridge.send({
			type: 'ListGoals',
			...(metaId ? {projectId: metaId} : {}),
			...(status?.trim() ? {status: status.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListGoals'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const goals = Array.isArray(event.goals) ? event.goals : [];
			return {
				ok: true,
				goals: goals.map(g => {
					const row = g as {
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						acceptance?: string | null;
						originSessionId?: string | null;
						controlSessionId?: string | null;
						teamId?: string | null;
						projectId?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						currentStepId?: string | string[] | null;
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
						createdAt?: string | null;
						resultSummary?: string | null;
						escalateActions?: string[];
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						loopAgentId?: string | null;
					};
					return {
						...row,
						currentStepIds: pickIdList(row.currentStepIds, row.currentStepId),
						activeRunIds: pickIdList(row.activeRunIds, row.activeRunId),
						...this.projectDisplayEnrich(row.projectId)
					};
				})
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listAgents(
		projectId?: string | null,
		opts?: {includeArchived?: boolean}
	): Promise<{ok: true; agents: AgentRow[]} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const metaId = projectId ? this.metaIdFor(projectId) : undefined;
		if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['ListAgents'], metaId);
		const sent = this.bridge.send({
			type: 'ListAgents',
			...(metaId ? {projectId: metaId} : {}),
			...(opts?.includeArchived ? {includeArchived: true} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListAgents'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const agents = Array.isArray(event.agents) ? event.agents : [];
			return {
				ok: true,
				agents: agents.map(a => this.enrichAgent(a as AgentRow))
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async createTeam(input: {
		name: string;
		projectId: string;
		description?: string;
		workspaceId?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const name = input.name.trim();
		if (!name) return {ok: false, notice: 'name required'};
		const metaId = this.metaIdFor(input.projectId);
		if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const hasMembers = Boolean(input.members?.length);
		const {token, promise} = this.waitCommandResult(
			['CreateTeam'],
			metaId,
			hasMembers ? 30_000 : 12_000
		);
		const sent = this.bridge.send({
			type: 'CreateTeam',
			name,
			projectId: metaId,
			...(input.description?.trim() ? {description: input.description.trim()} : {}),
			...(input.workspaceId?.trim() ? {workspaceId: input.workspaceId.trim()} : {}),
			...(hasMembers ? {members: input.members} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send CreateTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	async updateTeam(input: {
		teamId: string;
		name?: string;
		description?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const teamId = input.teamId.trim();
		if (!teamId) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult(['UpdateTeam']);
		const sent = this.bridge.send({
			type: 'UpdateTeam',
			teamId,
			...(input.name?.trim() ? {name: input.name.trim()} : {}),
			...(input.description !== undefined ? {description: input.description} : {}),
			...(input.members ? {members: input.members} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UpdateTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	async archiveTeam(teamId: string): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		return this.teamStatusOp('ArchiveTeam', teamId);
	}

	async unarchiveTeam(teamId: string): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		return this.teamStatusOp('UnarchiveTeam', teamId);
	}

	async getTeam(teamId: string): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = teamId.trim();
		if (!id) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult(['GetTeam']);
		const sent = this.bridge.send({type: 'GetTeam', teamId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send GetTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	async createAgent(input: {
		name: string;
		projectId: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
	}): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const name = input.name.trim();
		if (!name) return {ok: false, notice: 'name required'};
		const metaId = this.metaIdFor(input.projectId);
		if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['CreateAgent'], metaId);
		const sent = this.bridge.send({
			type: 'CreateAgent',
			name,
			projectId: metaId,
			...(input.model?.trim() ? {model: input.model.trim()} : {}),
			...(input.teamRole?.trim() ? {teamRole: input.teamRole.trim()} : {}),
			...(input.teamId?.trim() ? {teamId: input.teamId.trim()} : {}),
			...(input.taskBrief?.trim() ? {taskBrief: input.taskBrief.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send CreateAgent'};
		}
		return this.awaitAgentResult(promise);
	}

	async updateAgent(input: {
		agentId: string;
		name?: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
		systemPrompt?: string;
		maxTurns?: number;
	}): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const agentId = input.agentId.trim();
		if (!agentId) return {ok: false, notice: 'agentId required'};
		const {token, promise} = this.waitCommandResult(['UpdateAgent']);
		const sent = this.bridge.send({
			type: 'UpdateAgent',
			agentId,
			...(input.name?.trim() ? {name: input.name.trim()} : {}),
			...(input.model !== undefined ? {model: input.model} : {}),
			...(input.teamRole !== undefined ? {teamRole: input.teamRole} : {}),
			...(input.teamId !== undefined ? {teamId: input.teamId} : {}),
			...(input.taskBrief !== undefined ? {taskBrief: input.taskBrief} : {}),
			...(input.systemPrompt !== undefined ? {systemPrompt: input.systemPrompt} : {}),
			...(input.maxTurns !== undefined ? {maxTurns: input.maxTurns} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UpdateAgent'};
		}
		return this.awaitAgentResult(promise);
	}

	async archiveAgent(agentId: string): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		return this.agentStatusOp('ArchiveAgent', agentId);
	}

	async unarchiveAgent(agentId: string): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		return this.agentStatusOp('UnarchiveAgent', agentId);
	}

	async cloneAgent(input: {
		sourceId: string;
		teamId: string;
		name?: string;
	}): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const sourceId = input.sourceId.trim();
		const teamId = input.teamId.trim();
		if (!sourceId) return {ok: false, notice: 'sourceId required'};
		if (!teamId) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult(['CloneAgent']);
		const sent = this.bridge.send({
			type: 'CloneAgent',
			sourceId,
			teamId,
			...(input.name?.trim() ? {name: input.name.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send CloneAgent'};
		}
		return this.awaitAgentResult(promise);
	}

	async getAgent(agentId: string): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = agentId.trim();
		if (!id) return {ok: false, notice: 'agentId required'};
		const {token, promise} = this.waitCommandResult(['GetAgent']);
		const sent = this.bridge.send({type: 'GetAgent', agentId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send GetAgent'};
		}
		return this.awaitAgentResult(promise);
	}

	async deleteTeam(teamId: string): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = teamId.trim();
		if (!id) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult(['DeleteTeam']);
		const sent = this.bridge.send({type: 'DeleteTeam', teamId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send DeleteTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	async saveAsTeam(input: {
		sourceTeamId: string;
		name?: string;
	}): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const sourceTeamId = input.sourceTeamId.trim();
		if (!sourceTeamId) return {ok: false, notice: 'sourceTeamId required'};
		const {token, promise} = this.waitCommandResult(['SaveAsTeam'], undefined, 30_000);
		const sent = this.bridge.send({
			type: 'SaveAsTeam',
			sourceTeamId,
			...(input.name?.trim() ? {name: input.name.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send SaveAsTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	async promoteTeam(input: {
		teamId: string;
		name?: string;
	}): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const teamId = input.teamId.trim();
		if (!teamId) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult(['PromoteTeam'], undefined, 30_000);
		const sent = this.bridge.send({
			type: 'PromoteTeam',
			teamId,
			...(input.name?.trim() ? {name: input.name.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send PromoteTeam'};
		}
		return this.awaitTeamResult(promise);
	}

	/** Deep-link / detail: Bridge GoalStatus → single Goal row. */
	async getGoal(goalId: string): Promise<
		| {
				ok: true;
				goal: {
					id: string;
					status: string;
					name?: string | null;
					statement?: string | null;
					projectId?: string | null;
					projectDisplayName?: string | null;
					teamId?: string | null;
					originSessionId?: string | null;
					workflowJson?: string | null;
					budgetJson?: string | null;
					progressJson?: string | null;
					currentStepIds?: string[] | null;
					activeRunIds?: string[] | null;
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId?: string | string[] | null;
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId?: string | string[] | null;
					confirmedAt?: string | null;
				};
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = goalId.trim();
		if (!id) return {ok: false, notice: 'goalId required'};
		const {token, promise} = this.waitCommandResult(['GoalStatus']);
		const sent = this.bridge.send({type: 'GoalStatus', goalId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send GoalStatus'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const g = event.goal as
				| {
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						projectId?: string | null;
						teamId?: string | null;
						originSessionId?: string | null;
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						currentStepId?: string | string[] | null;
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
				  }
				| undefined;
			if (!g?.id) return {ok: false, notice: 'GoalStatus returned no goal'};
			return {
				ok: true,
				goal: {
					...g,
					currentStepIds: pickIdList(g.currentStepIds, g.currentStepId),
					activeRunIds: pickIdList(g.activeRunIds, g.activeRunId),
					...this.projectDisplayEnrich(g.projectId)
				}
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async deleteAgent(agentId: string): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = agentId.trim();
		if (!id) return {ok: false, notice: 'agentId required'};
		const {token, promise} = this.waitCommandResult(['DeleteAgent']);
		const sent = this.bridge.send({type: 'DeleteAgent', agentId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send DeleteAgent'};
		}
		return this.awaitAgentResult(promise);
	}

	async stopAgentRun(
		agentId: string
	): Promise<{ok: true; notice?: string} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = agentId.trim();
		if (!id) return {ok: false, notice: 'agentId required'};
		const {token, promise} = this.waitCommandResult(['StopAgentRun']);
		const sent = this.bridge.send({type: 'StopAgentRun', agentId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send StopAgentRun'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true, notice: event.message};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async deleteGoal(goalId: string): Promise<
		| {
				ok: true;
				goal: {id: string; status: string; name?: string | null; projectId?: string | null};
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = goalId.trim();
		if (!id) return {ok: false, notice: 'goalId required'};
		const {token, promise} = this.waitCommandResult(['DeleteGoal']);
		const sent = this.bridge.send({type: 'DeleteGoal', goalId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send DeleteGoal'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const goal = event.goal as
				| {id: string; status: string; name?: string | null; projectId?: string | null}
				| undefined;
			if (!goal?.id) return {ok: false, notice: 'No goal in result'};
			return {ok: true, goal};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	private enrichTeam(row: TeamRow): TeamRow {
		return {...row, ...this.projectDisplayEnrich(row.projectId)};
	}

	private enrichAgent(row: AgentRow): AgentRow {
		return {...row, ...this.projectDisplayEnrich(row.projectId)};
	}

	private async awaitTeamResult(
		promise: Promise<Extract<BridgeEvent, {type: 'command_result'}>>
	): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const team = event.team;
			if (!team || typeof team !== 'object') return {ok: false, notice: 'No team in result'};
			return {ok: true, team: this.enrichTeam(team as TeamRow)};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	private async awaitAgentResult(
		promise: Promise<Extract<BridgeEvent, {type: 'command_result'}>>
	): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const agent = event.agent;
			if (!agent || typeof agent !== 'object') return {ok: false, notice: 'No agent in result'};
			return {ok: true, agent: this.enrichAgent(agent as AgentRow)};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	private async teamStatusOp(
		type: 'ArchiveTeam' | 'UnarchiveTeam',
		teamId: string
	): Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = teamId.trim();
		if (!id) return {ok: false, notice: 'teamId required'};
		const {token, promise} = this.waitCommandResult([type]);
		const sent = this.bridge.send({type, teamId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: `Failed to send ${type}`};
		}
		return this.awaitTeamResult(promise);
	}

	private async agentStatusOp(
		type: 'ArchiveAgent' | 'UnarchiveAgent',
		agentId: string
	): Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const id = agentId.trim();
		if (!id) return {ok: false, notice: 'agentId required'};
		const {token, promise} = this.waitCommandResult([type]);
		const sent = this.bridge.send({type, agentId: id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: `Failed to send ${type}`};
		}
		return this.awaitAgentResult(promise);
	}

	private projectDisplayEnrich(metaProjectId?: string | null): {projectDisplayName?: string} {
		const meta = metaProjectId?.trim();
		if (!meta) return {};
		const open = this.projectByMetaId(meta);
		const projectDisplayName =
			open?.displayName?.trim() || (open ? path.basename(open.path) : undefined) || undefined;
		return projectDisplayName ? {projectDisplayName} : {};
	}

	async listLivingTasks(): Promise<
		| {
				ok: true;
				projects: Array<{projectId: string; displayName?: string; sessions?: unknown[]}>;
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		// LivingTasks walks Meta sessions with per-session asks — allow Bridge's 20s budget + margin.
		const {token, promise} = this.waitCommandResult(['ListLivingTasks'], undefined, 45_000);
		const sent = this.bridge.send({type: 'ListLivingTasks'});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListLivingTasks'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const raw = Array.isArray(event.livingTasks) ? event.livingTasks : [];
			const projects = raw.map(p => {
				const o = p as {projectId?: string; displayName?: string; sessions?: unknown[]};
				const projectId = String(o.projectId ?? '');
				const open = projectId ? this.projectByMetaId(projectId) : null;
				const fromMeta = o.displayName != null ? String(o.displayName).trim() : '';
				const fromOpen =
					open?.displayName?.trim() || (open ? path.basename(open.path) : '');
				const displayName =
					(fromOpen && !/^[0-9a-f-]{30,}$/i.test(fromOpen) ? fromOpen : '') ||
					(fromMeta && !/^[0-9a-f-]{30,}$/i.test(fromMeta) ? fromMeta : '') ||
					fromOpen ||
					fromMeta ||
					undefined;
				return {
					projectId,
					...(displayName ? {displayName} : {}),
					...(Array.isArray(o.sessions) ? {sessions: o.sessions} : {})
				};
			});
			return {ok: true, projects};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async createScheduledJob(input: {
		kind: string;
		cronExpr: string;
		timezone?: string;
		recurring?: boolean;
		targetKind: string;
		targetRef?: string;
		promptText?: string;
		targetArgsJson?: string;
		maxFires?: number;
		title?: string;
		fireImmediately?: boolean;
		sessionId?: string;
		projectId?: string;
	}): Promise<
		| {
				ok: true;
				job: {
					id: string;
					kind: string;
					status: string;
					sessionId: string;
					projectId?: string | null;
					projectDisplayName?: string | null;
					cronExpr?: string | null;
					timezone?: string | null;
					nextFireAt?: string | null;
					title?: string | null;
					promptText?: string | null;
					targetKind?: string | null;
					targetRef?: string | null;
				};
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const kind = input.kind.trim();
		const cronExpr = input.cronExpr.trim();
		const targetKind = input.targetKind.trim();
		if (!kind) return {ok: false, notice: 'kind required'};
		if (!cronExpr) return {ok: false, notice: 'cronExpr required'};
		if (!targetKind) return {ok: false, notice: 'targetKind required'};
		const folderProjectId = input.projectId?.trim();
		const metaId = folderProjectId ? this.metaIdFor(folderProjectId) : undefined;
		if (folderProjectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		const {token, promise} = this.waitCommandResult(['CreateScheduledJob'], metaId);
		const sent = this.bridge.send({
			type: 'CreateScheduledJob',
			kind,
			cronExpr,
			targetKind,
			...(input.timezone?.trim() ? {timezone: input.timezone.trim()} : {}),
			...(input.recurring !== undefined ? {recurring: input.recurring} : {}),
			...(input.targetRef?.trim() ? {targetRef: input.targetRef.trim()} : {}),
			...(input.promptText?.trim() ? {promptText: input.promptText.trim()} : {}),
			...(input.targetArgsJson?.trim() ? {targetArgsJson: input.targetArgsJson.trim()} : {}),
			...(input.maxFires !== undefined ? {maxFires: input.maxFires} : {}),
			...(input.title?.trim() ? {title: input.title.trim()} : {}),
			...(input.fireImmediately !== undefined ? {fireImmediately: input.fireImmediately} : {}),
			...(input.sessionId?.trim() ? {sessionId: input.sessionId.trim()} : {}),
			...(metaId ? {projectId: metaId} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send CreateScheduledJob'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const jobs = Array.isArray(event.scheduledJobs) ? event.scheduledJobs : [];
			const raw = jobs[0] as
				| {
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
						projectDisplayName?: string | null;
				  }
				| undefined;
			if (!raw?.id) return {ok: false, notice: 'No job in CreateScheduledJob result'};
			const meta = raw.projectId?.trim();
			const open = meta ? this.projectByMetaId(meta) : null;
			const projectDisplayName =
				open?.displayName?.trim() ||
				(open ? path.basename(open.path) : undefined) ||
				raw.projectDisplayName ||
				undefined;
			return {
				ok: true,
				job: {...raw, ...(projectDisplayName ? {projectDisplayName} : {})}
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async pauseScheduledJob(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.scheduledJobOp('PauseScheduledJob', id);
	}

	async resumeScheduledJob(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.scheduledJobOp('ResumeScheduledJob', id);
	}

	async cancelScheduledJob(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.scheduledJobOp('CancelScheduledJob', id);
	}

	async fireNowScheduledJob(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.scheduledJobOp('FireNowScheduledJob', id);
	}

	async updateScheduledJobCron(
		id: string,
		cronExpr: string,
		timezone?: string
	): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = cronExpr.trim();
		if (!trimmed) return {ok: false, notice: 'cronExpr required'};
		const {token, promise} = this.waitCommandResult(['UpdateScheduledJobCron']);
		const sent = this.bridge.send({
			type: 'UpdateScheduledJobCron',
			id,
			cronExpr: trimmed,
			...(timezone?.trim() ? {timezone: timezone.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UpdateScheduledJobCron'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listScheduledJobRuns(id: string): Promise<
		| {
				ok: true;
				runs: Array<{
					id: string;
					jobId: string;
					sessionId: string;
					status: string;
					startedAt?: string | null;
					finishedAt?: string | null;
					summary?: string | null;
					error?: string | null;
					runId?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ListScheduledJobRuns']);
		const sent = this.bridge.send({type: 'ListScheduledJobRuns', id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListScheduledJobRuns'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const runs = Array.isArray(event.scheduledJobRuns) ? event.scheduledJobRuns : [];
			return {ok: true, runs};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	private async scheduledJobOp(
		type: 'PauseScheduledJob' | 'ResumeScheduledJob' | 'CancelScheduledJob' | 'FireNowScheduledJob',
		id: string
	): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult([type]);
		const sent = this.bridge.send({type, id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: `Failed to send ${type}`};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	/** Settings-center documents of one scope (`effective` = project merged over global). */
	async getSettings(
		scope: SettingsScope,
		scopeId?: string
	): Promise<{ok: true; settings: SettingsDoc[]} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['GetSettings']);
		const sent = this.bridge.send({
			type: 'GetSettings',
			scope,
			...(scopeId?.trim() ? {scopeId: scopeId.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send GetSettings'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const settings = Array.isArray(event.settings) ? (event.settings as SettingsDoc[]) : [];
			return {ok: true, settings};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	/** RFC 7386 merge-patch one settings namespace (`null` deletes a field). */
	async patchSettings(
		scope: 'global' | 'project',
		namespace: string,
		patch: unknown,
		scopeId?: string
	): Promise<{ok: true; setting: SettingsDoc} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const ns = namespace.trim();
		if (!ns) return {ok: false, notice: 'namespace required'};
		const {token, promise} = this.waitCommandResult(['PatchSettings']);
		const sent = this.bridge.send({
			type: 'PatchSettings',
			scope,
			namespace: ns,
			patchJson: JSON.stringify(patch ?? {}),
			...(scopeId?.trim() ? {scopeId: scopeId.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send PatchSettings'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const setting = Array.isArray(event.settings)
				? (event.settings[0] as SettingsDoc | undefined)
				: undefined;
			if (!setting) return {ok: false, notice: 'PatchSettings returned no document'};
			return {ok: true, setting};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	/** Composer model picker — same enabled list as Settings. */
	refreshComposerCatalog(): Promise<void> {
		return this.syncComposerCatalogFromProviders();
	}

	/** Settings-center model providers (never includes ciphertext). */
	async listProviders(): Promise<
		{ok: true; providers: ProviderRow[]} | {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ListProviders']);
		const sent = this.bridge.send({type: 'ListProviders'});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListProviders'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true, providers: this.providersFromEvent(event)};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async upsertProvider(
		input: UpsertProviderInput
	): Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const name = String(input.name ?? '').trim();
		if (!name) return {ok: false, notice: 'name required'};
		const {token, promise} = this.waitCommandResult(['UpsertProvider']);
		const sent = this.bridge.send({
			type: 'UpsertProvider',
			name,
			...(input.id?.trim() ? {id: input.id.trim()} : {}),
			...(input.presetKey?.trim() ? {presetKey: input.presetKey.trim()} : {}),
			...(input.baseUrl?.trim() ? {baseUrl: input.baseUrl.trim()} : {}),
			...(input.kind?.trim() ? {kind: input.kind.trim()} : {}),
			...(input.metaJson?.trim() ? {metaJson: input.metaJson.trim()} : {}),
			...(input.credential?.trim() ? {credential: input.credential.trim()} : {}),
			...(input.seedModelsJson?.trim() ? {seedModelsJson: input.seedModelsJson.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UpsertProvider'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const provider = this.providersFromEvent(event)[0];
			if (!provider) return {ok: false, notice: 'UpsertProvider returned no provider'};
			return {ok: true, provider};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async deleteProvider(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = id.trim();
		if (!trimmed) return {ok: false, notice: 'id required'};
		const {token, promise} = this.waitCommandResult(['DeleteProvider']);
		const sent = this.bridge.send({type: 'DeleteProvider', id: trimmed});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send DeleteProvider'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async setProviderEnabled(
		id: string,
		enabled: boolean
	): Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = id.trim();
		if (!trimmed) return {ok: false, notice: 'id required'};
		const {token, promise} = this.waitCommandResult(['SetProviderEnabled']);
		const sent = this.bridge.send({type: 'SetProviderEnabled', id: trimmed, enabled});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send SetProviderEnabled'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const provider = this.providersFromEvent(event)[0];
			if (!provider) return {ok: false, notice: 'SetProviderEnabled returned no provider'};
			return {ok: true, provider};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async testProvider(
		id: string
	): Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = id.trim();
		if (!trimmed) return {ok: false, notice: 'id required'};
		const {token, promise} = this.waitCommandResult(['TestProvider']);
		const sent = this.bridge.send({type: 'TestProvider', id: trimmed});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send TestProvider'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const provider = this.providersFromEvent(event)[0];
			if (!provider) return {ok: false, notice: 'TestProvider returned no provider'};
			return {ok: true, provider};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async patchProviderModels(
		id: string,
		patch: ProviderModelPatch[]
	): Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = id.trim();
		if (!trimmed) return {ok: false, notice: 'id required'};
		const {token, promise} = this.waitCommandResult(['PatchProviderModels']);
		const sent = this.bridge.send({
			type: 'PatchProviderModels',
			id: trimmed,
			patchJson: JSON.stringify(patch ?? [])
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send PatchProviderModels'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const provider = this.providersFromEvent(event)[0];
			if (!provider) return {ok: false, notice: 'PatchProviderModels returned no provider'};
			return {ok: true, provider};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async searchProviderModels(
		id: string,
		query: string
	): Promise<{ok: true; searchModels: SearchModelRow[]} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmed = id.trim();
		if (!trimmed) return {ok: false, notice: 'id required'};
		const {token, promise} = this.waitCommandResult(['SearchProviderModels']);
		const sent = this.bridge.send({
			type: 'SearchProviderModels',
			id: trimmed,
			query: String(query ?? '')
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send SearchProviderModels'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const raw = (event as {searchModels?: SearchModelRow[]}).searchModels;
			return {ok: true, searchModels: Array.isArray(raw) ? raw : []};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	/** Settings-center skills (disk SoT + Skills.sh market). */
	async listSkills(): Promise<{ok: true; skills: SkillRow[]} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ListSkills']);
		const sent = this.bridge.send({type: 'ListSkills'});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListSkills'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true, skills: this.skillsFromEvent(event)};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listExtensions(): Promise<
		{ok: true; extensions: ExtWireRow[]; ledger: ExtWireNote[]} | {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ListExtensions']);
		const sent = this.bridge.send({type: 'ListExtensions'});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListExtensions'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {
				ok: true,
				extensions: this.extensionsFromEvent(event),
				ledger: this.ledgerFromEvent(event)
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async extensionStatus(
		id: string
	): Promise<{ok: true; extension: ExtWireRow | null} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ExtensionStatus']);
		const sent = this.bridge.send({type: 'ExtensionStatus', id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ExtensionStatus'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true, extension: this.extensionsFromEvent(event)[0] ?? null};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async installExtension(dir: string): Promise<{ok: true; id: string} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['InstallExtension']);
		const sent = this.bridge.send({type: 'InstallExtension', dir});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send InstallExtension'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const name = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir;
			return {ok: true, id: name};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async listEngines(): Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}> {
		if (!this.hostLaneOpen()) {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['ListEngines']);
		const bridge = this.bridge;
		if (!bridge) {
			this.cancelWait(token);
			return {ok: false, notice: 'Engine not ready'};
		}
		const sent = bridge.send({type: 'ListEngines'});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send ListEngines'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const engines = this.enginesFromEvent(event);
			this.applyAvailable(engines);
			return {ok: true, engines};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async writeEngine(
		type:
			| 'EnableEngine'
			| 'DisableEngine'
			| 'StartEngine'
			| 'StopEngine'
			| 'SetDefaultEngine'
			| 'InstallEngine'
			| 'UninstallEngine'
			| 'CancelEngineInstall',
		id: string
	): Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}> {
		if (!this.hostLaneOpen()) {
			return {ok: false, notice: 'Engine not ready'};
		}
		const timeoutMs = type === 'InstallEngine' ? 15 * 60_000 : 12_000;
		const {token, promise} = this.waitCommandResult([type], undefined, timeoutMs);
		const bridge = this.bridge;
		if (!bridge) {
			this.cancelWait(token);
			return {ok: false, notice: 'Engine not ready'};
		}
		const sent = bridge.send({type, id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: `Failed to send ${type}`};
		}
		try {
			const event = await promise;
			if (event.status === 'error' || event.status === 'rejected') {
				return {ok: false, notice: event.message};
			}
			const engines = this.enginesFromEvent(event);
			this.applyAvailable(engines);
			return {ok: true, engines};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async uninstallExtension(id: string): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['UninstallExtension']);
		const sent = this.bridge.send({type: 'UninstallExtension', id});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UninstallExtension'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async createSkill(
		input: CreateSkillInput
	): Promise<{ok: true; skill: SkillRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const name = String(input.name ?? '').trim();
		const scope = String(input.scope ?? '').trim();
		if (!name) return {ok: false, notice: 'name required'};
		if (!scope) return {ok: false, notice: 'scope required'};
		const {token, promise} = this.waitCommandResult(['CreateSkill']);
		const sent = this.bridge.send({
			type: 'CreateSkill',
			name,
			scope,
			...(input.template?.trim() ? {template: input.template.trim()} : {})
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send CreateSkill'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const skill = this.skillsFromEvent(event)[0];
			if (!skill) return {ok: false, notice: 'CreateSkill returned no skill'};
			return {ok: true, skill};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async deleteSkill(name: string, scope: string): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmedName = name.trim();
		const trimmedScope = scope.trim();
		if (!trimmedName) return {ok: false, notice: 'name required'};
		if (!trimmedScope) return {ok: false, notice: 'scope required'};
		const {token, promise} = this.waitCommandResult(['DeleteSkill']);
		const sent = this.bridge.send({
			type: 'DeleteSkill',
			name: trimmedName,
			scope: trimmedScope
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send DeleteSkill'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async setSkillEnabled(
		name: string,
		scope: string,
		enabled: boolean
	): Promise<{ok: true; skill: SkillRow} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmedName = name.trim();
		const trimmedScope = scope.trim();
		if (!trimmedName) return {ok: false, notice: 'name required'};
		if (!trimmedScope) return {ok: false, notice: 'scope required'};
		const {token, promise} = this.waitCommandResult(['SetSkillEnabled']);
		const sent = this.bridge.send({
			type: 'SetSkillEnabled',
			name: trimmedName,
			scope: trimmedScope,
			enabled
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send SetSkillEnabled'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			const skill = this.skillsFromEvent(event)[0];
			if (!skill) return {ok: false, notice: 'SetSkillEnabled returned no skill'};
			return {ok: true, skill};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async searchSkillMarket(
		query: string
	): Promise<
		{ok: true; marketSkills: MarketSkillRow[]; message?: string} | {ok: false; notice: string}
	> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const {token, promise} = this.waitCommandResult(['SearchSkillMarket'], undefined, 20_000);
		const sent = this.bridge.send({
			type: 'SearchSkillMarket',
			query: String(query ?? '')
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send SearchSkillMarket'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {
				ok: true,
				marketSkills: this.marketSkillsFromEvent(event),
				...(typeof event.message === 'string' ? {message: event.message} : {})
			};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async installSkillFromMarket(
		source: string,
		scope: string
	): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmedSource = source.trim();
		const trimmedScope = scope.trim();
		if (!trimmedSource) return {ok: false, notice: 'source required'};
		if (!trimmedScope) return {ok: false, notice: 'scope required'};
		const {token, promise} = this.waitCommandResult(
			['InstallSkillFromMarket'],
			undefined,
			120_000
		);
		const sent = this.bridge.send({
			type: 'InstallSkillFromMarket',
			source: trimmedSource,
			scope: trimmedScope
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send InstallSkillFromMarket'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	async uninstallSkillFromMarket(
		name: string,
		scope: string
	): Promise<{ok: true} | {ok: false; notice: string}> {
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, notice: 'Engine not ready'};
		}
		const trimmedName = name.trim();
		const trimmedScope = scope.trim();
		if (!trimmedName) return {ok: false, notice: 'name required'};
		if (!trimmedScope) return {ok: false, notice: 'scope required'};
		const {token, promise} = this.waitCommandResult(['UninstallSkillFromMarket']);
		const sent = this.bridge.send({
			type: 'UninstallSkillFromMarket',
			name: trimmedName,
			scope: trimmedScope
		});
		if (!sent) {
			this.cancelWait(token);
			return {ok: false, notice: 'Failed to send UninstallSkillFromMarket'};
		}
		try {
			const event = await promise;
			if (event.status === 'error') return {ok: false, notice: event.message};
			return {ok: true};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	/** List ambient Rules (global ∪ project) for a folder Project. */
	async listRules(
		projectId: string
	): Promise<{ok: true; rules: AmbientRule[]; replace: true} | {ok: false; notice: string}> {
		return this.runRuleOp(async () => {
			const metaId = this.metaIdFor(projectId);
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			if (!this.bridge || this.engineStatus !== 'ready') {
				return {ok: false, notice: 'Engine not ready'};
			}
			const {token, promise} = this.waitCommandResult(['ListRules'], metaId);
			const sent = this.bridge.send({type: 'ListRules', projectId: metaId});
			if (!sent) {
				this.cancelWait(token);
				return {ok: false, notice: 'Failed to send ListRules'};
			}
			try {
				const event = await promise;
				if (event.status === 'error') return {ok: false, notice: event.message};
				return {ok: true, rules: this.rulesFromEvent(event), replace: true};
			} catch (e) {
				return {ok: false, notice: e instanceof Error ? e.message : String(e)};
			}
		});
	}

	async addProjectRule(
		projectId: string,
		text: string
	): Promise<{ok: true; rules: AmbientRule[]; replace: boolean} | {ok: false; notice: string}> {
		return this.runRuleOp(async () => {
			const metaId = this.metaIdFor(projectId);
			const trimmed = text.trim();
			if (!trimmed) return {ok: false, notice: 'text required'};
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			if (!this.bridge || this.engineStatus !== 'ready') {
				return {ok: false, notice: 'Engine not ready'};
			}
			const {token, promise} = this.waitCommandResult(['AddRule'], metaId);
			const sent = this.bridge.send({
				type: 'AddRule',
				scope: 'project',
				projectId: metaId,
				text: trimmed
			});
			if (!sent) {
				this.cancelWait(token);
				return {ok: false, notice: 'Failed to send AddRule'};
			}
			try {
				const event = await promise;
				if (event.status === 'error') return {ok: false, notice: event.message};
				const added = this.rulesFromEvent(event);
				// Best-effort full refresh; Add already persisted — never fail the op on List miss.
				const list = this.waitCommandResult(['ListRules'], metaId);
				const listSent = this.bridge!.send({type: 'ListRules', projectId: metaId});
				if (!listSent) {
					this.cancelWait(list.token);
					return {ok: true, rules: added, replace: false};
				}
				try {
					const listed = await list.promise;
					if (listed.status === 'error') return {ok: true, rules: added, replace: false};
					return {ok: true, rules: this.rulesFromEvent(listed), replace: true};
				} catch {
					return {ok: true, rules: added, replace: false};
				}
			} catch (e) {
				return {ok: false, notice: e instanceof Error ? e.message : String(e)};
			}
		});
	}

	async removeRule(projectId: string, ruleId: string): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.runRuleOp(async () => {
			const metaId = this.metaIdFor(projectId);
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			if (!this.bridge || this.engineStatus !== 'ready') {
				return {ok: false, notice: 'Engine not ready'};
			}
			const {token, promise} = this.waitCommandResult(['RemoveRule'], metaId);
			const sent = this.bridge.send({type: 'RemoveRule', id: ruleId});
			if (!sent) {
				this.cancelWait(token);
				return {ok: false, notice: 'Failed to send RemoveRule'};
			}
			try {
				const event = await promise;
				if (event.status === 'error') return {ok: false, notice: event.message};
				return {ok: true};
			} catch (e) {
				return {ok: false, notice: e instanceof Error ? e.message : String(e)};
			}
		});
	}

	async setRuleEnabled(
		projectId: string,
		ruleId: string,
		enabled: boolean
	): Promise<{ok: true} | {ok: false; notice: string}> {
		return this.runRuleOp(async () => {
			const metaId = this.metaIdFor(projectId);
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			if (!this.bridge || this.engineStatus !== 'ready') {
				return {ok: false, notice: 'Engine not ready'};
			}
			const {token, promise} = this.waitCommandResult(['SetRuleEnabled'], metaId);
			const sent = this.bridge.send({type: 'SetRuleEnabled', id: ruleId, enabled});
			if (!sent) {
				this.cancelWait(token);
				return {ok: false, notice: 'Failed to send SetRuleEnabled'};
			}
			try {
				const event = await promise;
				if (event.status === 'error') return {ok: false, notice: event.message};
				return {ok: true};
			} catch (e) {
				return {ok: false, notice: e instanceof Error ? e.message : String(e)};
			}
		});
	}

	// ── Agent change review ──
	//
	// The renderer names a Project; the hash it maps to is what the daemon takes. Decision
	// commands never carry a path. GetFileReviewDiff's path is a selector among this checkout's
	// undecided review rows — it cannot write, and it cannot read a file that is not already
	// on the review list.

	async listReviewChanges(
		projectId: string,
		checkpointId?: string | null,
		sessionId?: string | null
	): Promise<{ok: true; list: ReviewList} | ReviewRefusal> {
		return this.reviewOp(projectId, 'ListReviewChanges', hash => ({
			type: 'ListReviewChanges',
			workspaceId: hash,
			...(checkpointId ? {checkpointId} : {}),
			...(sessionId ? {sessionId} : {})
		})).then(answer =>
			answer.ok
				? {
						ok: true as const,
						list: {
							revision: answer.review.revision ?? 0,
							changes: (answer.review.changes ?? []) as ReviewList['changes'],
							available: answer.review.available !== false,
							checkpoints: (answer.review.checkpoints ?? []) as ReviewList['checkpoints']
						}
				  }
				: answer
		);
	}

	async getReviewChange(
		projectId: string,
		changeId: string
	): Promise<{ok: true; change: ReviewChangeDetail} | ReviewRefusal> {
		const answer = await this.reviewOp(projectId, 'GetReviewChange', hash => ({
			type: 'GetReviewChange',
			workspaceId: hash,
			changeId
		}));
		if (!answer.ok) return answer;
		const change = answer.review.change as ReviewChangeDetail | null | undefined;
		return change ? {ok: true, change} : {ok: false, notice: 'Change no longer in the review list'};
	}

	async listReviewDiff(
		projectId: string,
		sinceRevision?: number
	): Promise<{ok: true; diff: ReviewDiffSnapshot} | ReviewRefusal> {
		const answer = await this.reviewOp(projectId, 'ListReviewDiff', hash => ({
			type: 'ListReviewDiff',
			workspaceId: hash,
			...(sinceRevision !== undefined ? {sinceRevision} : {})
		}));
		if (!answer.ok) return answer;
		const diff = answer.review.diff as ReviewDiffSnapshot | null | undefined;
		return diff
			? {ok: true, diff}
			: {ok: false, notice: 'The review diff is not available for this checkout'};
	}

	async getFileReviewDiff(
		projectId: string,
		path: string
	): Promise<{ok: true; file: FileReviewDiff} | ReviewRefusal> {
		const answer = await this.reviewOp(projectId, 'GetFileReviewDiff', hash => ({
			type: 'GetFileReviewDiff',
			workspaceId: hash,
			path
		}));
		if (!answer.ok) return answer;
		const file = answer.review.file as FileReviewDiff | null | undefined;
		return file
			? {ok: true, file}
			: {ok: false, notice: 'No pending review diff for this file'};
	}

	async keepReviewChanges(
		projectId: string,
		changeIds: string[],
		revision: number
	): Promise<{ok: true} | ReviewRefusal> {
		const answer = await this.reviewOp(projectId, 'KeepChanges', hash => ({
			type: 'KeepChanges',
			workspaceId: hash,
			changeIds,
			revision
		}));
		return answer.ok ? {ok: true} : answer;
	}

	async previewRevert(
		projectId: string,
		input: {
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
		}
	): Promise<{ok: true; preview: ReviewPreview} | ReviewRefusal> {
		const answer = await this.reviewOp(projectId, 'PreviewRevert', hash => ({
			type: 'PreviewRevert',
			workspaceId: hash,
			target: input.target,
			revision: input.revision,
			...(input.checkpointId ? {checkpointId: input.checkpointId} : {}),
			...(input.changeIds ? {changeIds: input.changeIds} : {})
		}));
		if (!answer.ok) return answer;
		const preview = answer.review.preview as ReviewPreview | undefined;
		return preview ? {ok: true, preview} : {ok: false, notice: 'Engine returned no undo plan'};
	}

	async applyRevert(
		projectId: string,
		previewId: string,
		force?: boolean
	): Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal> {
		return this.restoring(projectId, 'ApplyRevert', hash => ({
			type: 'ApplyRevert',
			workspaceId: hash,
			previewId,
			...(force ? {force: true} : {})
		}));
	}

	async redoRevert(
		projectId: string,
		restoreId: string
	): Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal> {
		return this.restoring(projectId, 'RedoRevert', hash => ({
			type: 'RedoRevert',
			workspaceId: hash,
			restoreId
		}));
	}

	private async restoring(
		projectId: string,
		name: 'ApplyRevert' | 'RedoRevert',
		command: (hash: string) => BridgeCommand
	): Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal> {
		// Writes files, so it gets the long wait: a slow disk must not read to the user as a failed undo
		// while the daemon is still writing.
		const answer = await this.reviewOp(projectId, name, command, RestoreWaitMs);
		if (!answer.ok) return answer;
		const restored = answer.review.restored;
		return restored
			? {ok: true, restored: {restoreId: restored.restoreId, revision: restored.revision}}
			: {ok: false, notice: 'Engine reported no restore'};
	}

	/**
	 * One review command, resolved by name and checkout hash.
	 *
	 * Serialized per checkout because these replies carry no request id: two diffs opened in a row
	 * would otherwise be told apart only by command name, and each could take the other's payload.
	 */
	private reviewOp(
		projectId: string,
		name: string,
		command: (hash: string) => BridgeCommand,
		timeoutMs?: number
	): Promise<{ok: true; review: ReviewPayload} | ReviewRefusal> {
		const run = (this.reviewTails.get(projectId) ?? Promise.resolve()).then(
			() => this.sendReview(projectId, name, command, timeoutMs),
			() => this.sendReview(projectId, name, command, timeoutMs)
		);
		this.reviewTails.set(
			projectId,
			run.then(
				() => undefined,
				() => undefined
			)
		);
		return run;
	}

	private async sendReview(
		projectId: string,
		name: string,
		command: (hash: string) => BridgeCommand,
		timeoutMs?: number
	): Promise<{ok: true; review: ReviewPayload} | ReviewRefusal> {
		const project = this.projects.get(projectId);
		if (!project) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		if (!this.bridge || this.engineStatus !== 'ready') return {ok: false, notice: 'Engine not ready'};
		if (!project.slotLive) {
			// Reviews.slot() looks up this process's Slot, not Meta. A pathHash
			// stamped from workspace_meta (or a sibling project's hash) is not a claim.
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
		const {token, promise} = this.waitCommandResult([name], undefined, timeoutMs, projectId);
		if (!this.bridge.send(command(hash))) {
			this.cancelWait(token);
			return {ok: false, notice: `Failed to send ${name}`};
		}
		try {
			const event = await promise;
			const review = (event.review ?? {}) as ReviewPayload;
			// `unavailable` is not a failure to retry: checkpoints are off, so nothing was recorded and
			// nothing here can be undone. The drawer has to say that instead of offering an undo.
			if (event.status === 'unavailable' || review.available === false) {
				return {ok: false, notice: event.message, unavailable: true};
			}
			if (event.status === 'error' || event.status === 'rejected') {
				return {
					ok: false,
					notice: event.message,
					revision: review.revision,
					conflicts: review.conflicts,
					movedPaths: review.movedPaths,
					// Retrying cannot bring a pruned snapshot back, so the client is told to stop
					// offering this restore point rather than to try again.
					expired: review.expired
				};
			}
			return {ok: true, review};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	}

	private metaIdFor(projectId: string): string | undefined {
		const project = this.projects.get(projectId);
		if (!project) return undefined;
		return project.metaProjectId ?? (project.isDefault ? 'default-project' : undefined);
	}

	private waitCommandResult(
		names: string[],
		projectId?: string,
		timeoutMs = 12_000,
		checkoutProjectId?: string
	): {token: string; promise: Promise<Extract<BridgeEvent, {type: 'command_result'}>>} {
		const token = `rule-wait-${++this.ruleWaitSeq}`;
		const promise = new Promise<Extract<BridgeEvent, {type: 'command_result'}>>((resolve, reject) => {
			const entry = {
				names: new Set(names),
				projectId,
				checkoutProjectId,
				resolve,
				reject,
				timer: setTimeout(() => {
					this.ruleWaiters.delete(token);
					reject(new Error(`timeout waiting for ${names.join('/')}`));
				}, timeoutMs)
			};
			this.ruleWaiters.set(token, entry);
		});
		return {token, promise};
	}

	/**
	 * Parallel FS command wait — correlates by `command_result.requestId` (not name).
	 * Same token/timeout/`cancelWait` contract as `waitCommandResult`.
	 */
	private waitByRequestId(
		requestId: string,
		timeoutMs = this.requestWaitMs
	): {token: string; promise: Promise<Extract<BridgeEvent, {type: 'command_result'}>>} {
		const token = `req-wait-${++this.ruleWaitSeq}`;
		const promise = new Promise<Extract<BridgeEvent, {type: 'command_result'}>>((resolve, reject) => {
			const entry = {
				requestId,
				resolve,
				reject,
				timer: setTimeout(() => {
					this.requestWaiters.delete(token);
					reject(new Error(`timeout waiting for requestId ${requestId}`));
				}, timeoutMs)
			};
			this.requestWaiters.set(token, entry);
		});
		return {token, promise};
	}

	private cancelWait(token: string): void {
		const rule = this.ruleWaiters.get(token);
		if (rule) {
			this.ruleWaiters.delete(token);
			clearTimeout(rule.timer);
			rule.reject(new Error('send failed'));
			return;
		}
		const req = this.requestWaiters.get(token);
		if (!req) return;
		this.requestWaiters.delete(token);
		clearTimeout(req.timer);
		req.reject(new Error('send failed'));
	}

	private resolveRuleWaiters(event: Extract<BridgeEvent, {type: 'command_result'}>): void {
		const eventProjectId =
			'projectId' in event && typeof event.projectId === 'string' ? event.projectId : undefined;
		// Review replies carry no sessionId and no Meta projectId — the checkout hash is what says which
		// of several open Projects the answer is about.
		const eventCheckout =
			'pathHash' in event && typeof event.pathHash === 'string'
				? this.projectForHash(event.pathHash)?.id
				: undefined;
		for (const [token, entry] of this.ruleWaiters) {
			if (!entry.names.has(event.name)) continue;
			// When both sides stamp Meta projectId, require a match (avoids cross-project steal).
			if (entry.projectId && eventProjectId && entry.projectId !== eventProjectId) continue;
			if (entry.checkoutProjectId && eventCheckout && entry.checkoutProjectId !== eventCheckout) continue;
			this.ruleWaiters.delete(token);
			clearTimeout(entry.timer);
			entry.resolve(event);
			return;
		}
	}

	private resolveRequestWaiters(event: Extract<BridgeEvent, {type: 'command_result'}>): void {
		const requestId = event.requestId;
		if (!requestId) return;
		for (const [token, entry] of this.requestWaiters) {
			if (entry.requestId !== requestId) continue;
			this.requestWaiters.delete(token);
			clearTimeout(entry.timer);
			entry.resolve(event);
			return;
		}
	}

	/** Active Project host stamp only — never `projectHash(project.path)`. */
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

	async listWorkspaceDir(relativePath?: string): Promise<ListWorkspaceDirResult> {
		let workspaceId: string;
		try {
			workspaceId = this.activeWorkspaceId();
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e),
				entries: []
			};
		}
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: 'Engine not ready', entries: []};
		}
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(requestId);
		if (
			!this.bridge.send({
				type: 'ListWorkspaceDir',
				requestId,
				workspaceId,
				...(relativePath != null && relativePath !== '' ? {relativePath} : {})
			})
		) {
			this.cancelWait(token);
			return {ok: false, error: 'Failed to send ListWorkspaceDir', entries: []};
		}
		try {
			const event = await promise;
			const fs = event.fs;
			const code = asFsCode(fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || code) {
				return {
					ok: false,
					error: event.message || code || 'ListWorkspaceDir failed',
					code,
					entries: []
				};
			}
			const entries = Array.isArray(fs?.entries)
				? fs.entries.map(e => ({
						name: e.name,
						kind: e.kind,
						relativePath: e.relativePath,
						...(e.mtime != null ? {mtime: e.mtime} : {})
					}))
				: [];
			return {
				ok: true,
				relativePath: fs?.relativePath ?? relativePath ?? '',
				entries,
				...(fs?.truncated === true ? {truncated: true} : {})
			};
		} catch (e) {
			return {
				ok: false,
				error: e instanceof Error ? e.message : String(e),
				entries: []
			};
		}
	}

	async getWorkspaceFile(relativePath: string): Promise<GetWorkspaceFileResult> {
		let workspaceId: string;
		try {
			workspaceId = this.activeWorkspaceId();
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: 'Engine not ready'};
		}
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(requestId);
		if (
			!this.bridge.send({
				type: 'GetWorkspaceFile',
				requestId,
				workspaceId,
				relativePath
			})
		) {
			this.cancelWait(token);
			return {ok: false, error: 'Failed to send GetWorkspaceFile'};
		}
		try {
			const event = await promise;
			const fs = event.fs;
			const code = asFsCode(fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || code) {
				return {
					ok: false,
					error: event.message || code || 'GetWorkspaceFile failed',
					code
				};
			}
			if (typeof fs?.content !== 'string' || typeof fs.mtime !== 'number') {
				return {ok: false, error: 'GetWorkspaceFile missing content/mtime'};
			}
			return {
				ok: true,
				relativePath: fs.relativePath ?? relativePath,
				content: fs.content,
				mtime: fs.mtime,
				...(typeof fs.bytes === 'number' ? {bytes: fs.bytes} : {})
			};
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
	}

	async saveWorkspaceFile(
		relativePath: string,
		content: string,
		mtime?: number,
		bytes?: number
	): Promise<SaveWorkspaceFileResult> {
		let workspaceId: string;
		try {
			workspaceId = this.activeWorkspaceId();
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
		if (!this.bridge || this.engineStatus !== 'ready') {
			return {ok: false, error: 'Engine not ready'};
		}
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(requestId);
		if (
			!this.bridge.send({
				type: 'SaveWorkspaceFile',
				requestId,
				workspaceId,
				relativePath,
				content,
				...(mtime != null ? {mtime} : {}),
				...(bytes != null ? {bytes} : {})
			})
		) {
			this.cancelWait(token);
			return {ok: false, error: 'Failed to send SaveWorkspaceFile'};
		}
		try {
			const event = await promise;
			const fs = event.fs;
			const code = asFsCode(fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || code) {
				return {
					ok: false,
					error: event.message || code || 'SaveWorkspaceFile failed',
					code,
					...(typeof fs?.mtime === 'number' ? {mtime: fs.mtime} : {})
				};
			}
			if (typeof fs?.mtime !== 'number' || typeof fs.bytes !== 'number') {
				return {ok: false, error: 'SaveWorkspaceFile missing mtime/bytes'};
			}
			const pathHash = event.pathHash ?? workspaceId;
			this.rememberLocalSave(pathHash, fs.relativePath ?? relativePath, fs.mtime);
			return {
				ok: true,
				relativePath: fs.relativePath ?? relativePath,
				mtime: fs.mtime,
				bytes: fs.bytes
			};
		} catch (e) {
			return {ok: false, error: e instanceof Error ? e.message : String(e)};
		}
	}

	/**
	 * Slot-rooted SCM chrome (status bar + file-tree dots). Same workspaceId as ListWorkspaceDir.
	 * Caches: fresh 3s / not-git 5min / inFlight — force clears that key.
	 */
	async gitWorkspaceStatus(force?: boolean): Promise<GitStatus | null> {
		let workspaceId: string;
		try {
			workspaceId = this.activeWorkspaceId();
		} catch {
			return null;
		}
		if (!this.bridge || this.engineStatus !== 'ready') return null;

		const key = workspaceId;
		if (!force) {
			const until = this.gitNotUntil.get(key);
			if (until !== undefined && Date.now() < until) return null;
			const hit = this.gitFresh.get(key);
			if (hit && Date.now() - hit.at < WorkspaceHub.GIT_FRESH_TTL_MS) return hit.snapshot;
			const pending = this.gitInFlight.get(key);
			if (pending) return pending;
		} else {
			this.gitNotUntil.delete(key);
			// Expire fresh TTL but keep last snapshot so soft-fail can fall back.
			const hit = this.gitFresh.get(key);
			if (hit) this.gitFresh.set(key, {at: 0, snapshot: hit.snapshot});
		}

		const gen = (this.gitGen.get(key) ?? 0) + 1;
		this.gitGen.set(key, gen);
		const probe = this.probeGitWorkspaceStatus(workspaceId, key, gen);
		this.gitInFlight.set(key, probe);
		try {
			return await probe;
		} finally {
			if (this.gitInFlight.get(key) === probe) this.gitInFlight.delete(key);
		}
	}

	private static readonly GIT_FRESH_TTL_MS = 3_000;
	private static readonly GIT_NOT_GIT_TTL_MS = 5 * 60_000;

	private async probeGitWorkspaceStatus(
		workspaceId: string,
		key: string,
		gen: number
	): Promise<GitStatus | null> {
		const requestId = randomUUID();
		const {token, promise} = this.waitByRequestId(requestId);
		if (
			!this.bridge?.send({
				type: 'GitWorkspaceStatus',
				requestId,
				workspaceId
			})
		) {
			this.cancelWait(token);
			return this.gitSoftKeep(key, gen);
		}
		try {
			const event = await promise;
			const fsCode = asFsCode(event.fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || fsCode === 'no-slot') {
				// Soft / NoSlot — do not arm not-git TTL; keep last good chrome when present.
				return this.gitSoftKeep(key, gen);
			}
			const git = (
				event as {
					git?: {
						available?: boolean;
						branch?: string;
						dirty?: boolean;
						files?: Array<{path: string; kind: 'modified' | 'added' | 'deleted'}>;
					};
				}
			).git;
			// Long not-git TTL only when Engine explicitly says available:false (not a work tree).
			if (git?.available === false) {
				this.gitCacheWrite(key, gen, null, true);
				return null;
			}
			if (!git) {
				return this.gitSoftKeep(key, gen);
			}
			const branch = git.branch?.trim() ?? '';
			if (!branch) {
				return this.gitSoftKeep(key, gen);
			}
			const files = Array.isArray(git.files) ? git.files : [];
			const snapshot: GitStatus = {
				branch,
				dirty: git.dirty === true || files.length > 0,
				files
			};
			this.gitCacheWrite(key, gen, snapshot, false);
			return snapshot;
		} catch {
			return this.gitSoftKeep(key, gen);
		}
	}

	/** Soft failure: 3s backoff, preserve last good snapshot so chrome does not blink off. */
	private gitSoftKeep(key: string, gen: number): GitStatus | null {
		const keep = this.gitFresh.get(key)?.snapshot ?? null;
		this.gitCacheWrite(key, gen, keep, false);
		return keep;
	}

	private gitCacheWrite(
		key: string,
		gen: number,
		snapshot: GitStatus | null,
		notGit: boolean
	): void {
		if (this.gitGen.get(key) !== gen) return;
		if (notGit) {
			this.gitNotUntil.set(key, Date.now() + WorkspaceHub.GIT_NOT_GIT_TTL_MS);
		} else {
			this.gitNotUntil.delete(key);
		}
		this.gitFresh.set(key, {at: Date.now(), snapshot});
	}

	private providersFromEvent(
		event: Extract<BridgeEvent, {type: 'command_result'}>
	): ProviderRow[] {
		const raw = (event as {providers?: ProviderRow[]}).providers;
		return Array.isArray(raw) ? (raw as ProviderRow[]) : [];
	}

	private skillsFromEvent(event: Extract<BridgeEvent, {type: 'command_result'}>): SkillRow[] {
		const raw = (event as {skills?: SkillRow[]}).skills;
		return Array.isArray(raw) ? (raw as SkillRow[]) : [];
	}

	private extensionsFromEvent(event: Extract<BridgeEvent, {type: 'command_result'}>): ExtWireRow[] {
		const raw = event.extensions;
		return Array.isArray(raw) ? raw : [];
	}

	private enginesFromEvent(event: Extract<BridgeEvent, {type: 'command_result'}>): EngineWireRow[] {
		const raw = event.engines;
		return Array.isArray(raw) ? (raw as EngineWireRow[]) : [];
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

	private ledgerFromEvent(event: Extract<BridgeEvent, {type: 'command_result'}>): ExtWireNote[] {
		const raw = event.ledger;
		return Array.isArray(raw) ? raw : [];
	}

	private marketSkillsFromEvent(
		event: Extract<BridgeEvent, {type: 'command_result'}>
	): MarketSkillRow[] {
		const raw = (event as {marketSkills?: MarketSkillRow[]}).marketSkills;
		return Array.isArray(raw) ? (raw as MarketSkillRow[]) : [];
	}

	private rulesFromEvent(event: Extract<BridgeEvent, {type: 'command_result'}>): AmbientRule[] {
		const raw = (event as {rules?: AmbientRule[]}).rules;
		return Array.isArray(raw) ? raw : [];
	}

	/**
	 * Rename Project display name on Engine Meta.
	 * UI refreshes after SetProjectDisplayName command_result (not optimistic).
	 */
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
		if (this.engineHandlers) void this.refreshComposerChrome(this.engineHandlers);

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
					clientId: this.createClientId()
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
	private async healDefaultModelChrome(handlers: WorkspaceProjectHandlers): Promise<void> {
		const needsHeal = [...this.projects.values()].some(p => this.chromeNeedsHeal(p.sessions));
		if (!needsHeal) return;
		if (![...this.projects.values()].some(p => p.sessions.modelCatalog.length > 0)) return;

		let model = 'default';
		let display = '';

		const settings = await this.getSettings('global');
		if (settings.ok) {
			const doc = settings.settings.find(s => s.namespace === 'models');
			const payload =
				doc?.payload && typeof doc.payload === 'object'
					? (doc.payload as Record<string, unknown>)
					: {};
			const platform =
				typeof payload.defaultPlatform === 'string' ? payload.defaultPlatform.trim() : '';
			const modelId =
				typeof payload.defaultModel === 'string' ? payload.defaultModel.trim() : '';
			if (platform && modelId) {
				model = `${platform}/${modelId}`;
				display = `${platform}/${modelId}`;
			}
		}

		if (isUnresolvedModelDisplay(display)) {
			const providers = await this.listProviders();
			if (providers.ok) {
				for (const p of providers.providers) {
					if (!p.enabled) continue;
					const hit = (p.models ?? []).find(
						m =>
							m.enabled &&
							(m.aliases ?? []).some(a => a.toLowerCase() === 'default')
					);
					if (!hit) continue;
					model = `${p.id}/${hit.modelId}`;
					display = (hit.displayName || hit.modelId).trim() || `${p.id}/${hit.modelId}`;
					break;
				}
				if (isUnresolvedModelDisplay(display)) {
					const first = this.firstEnabledProviderModel(providers.providers);
					if (first) {
						model = first.model;
						display = first.display;
					}
				}
			}
		}

		if (isUnresolvedModelDisplay(display)) return;

		let healed = false;
		for (const project of this.projects.values()) {
			if (project.sessions.healDefaultModelDisplay(model, display)) healed = true;
		}
		if (!healed) return;
		const active = this.getActive();
		if (active) handlers.onSessionsChanged?.(active.id);
		else handlers.onSessionsChanged?.('engine');
	}

	private chromeNeedsHeal(sessions: SessionController): boolean {
		const cat = sessions.modelCatalog;
		const inCatalog =
			cat.length > 0 &&
			cat.some(
				e => matchCatalogEntry(e, sessions.model) || matchCatalogEntry(e, sessions.modelDisplay)
			);
		if (inCatalog) return false;
		if (
			isUnresolvedModelDisplay(sessions.modelDisplay) ||
			isPlaceholderModelDisplay(sessions.model)
		) {
			return true;
		}
		return cat.length > 0;
	}

	private firstEnabledProviderModel(
		providers: Array<{id: string; enabled: boolean; models?: Array<{
			modelId: string;
			displayName?: string;
			enabled: boolean;
		}>}>
	): {model: string; display: string} | null {
		for (const p of providers) {
			if (!p.enabled) continue;
			const hit = (p.models ?? []).find(m => m.enabled);
			if (!hit) continue;
			const model = `${p.id}/${hit.modelId}`;
			const display = (hit.displayName || hit.modelId).trim() || model;
			return {model, display};
		}
		return null;
	}

	/** Settings/provider mutations → Composer options = enabled models from ListProviders. */
	private syncComposerCatalog(): void {
		void this.syncComposerCatalogFromProviders();
	}

	private async refreshComposerChrome(handlers: WorkspaceProjectHandlers): Promise<void> {
		await this.syncComposerCatalogFromProviders();
		await this.healDefaultModelChrome(handlers);
	}

	private syncComposerCatalogFromProviders(): Promise<void> {
		if (this.composerCatalogSync) return this.composerCatalogSync;
		if (!this.bridge || this.engineStatus !== 'ready') return Promise.resolve();
		const run = this.loadComposerCatalogFromProviders();
		const wrapped = run.finally(() => {
			if (this.composerCatalogSync === wrapped) this.composerCatalogSync = null;
		});
		this.composerCatalogSync = wrapped;
		return wrapped;
	}

	private async loadComposerCatalogFromProviders(): Promise<void> {
		const res = await this.listProviders();
		if (!res.ok) {
			// Settings reads ListProviders. Falling back to yaml `/model` here is how
			// Anthropic yaml rows leaked into Composer while Models page showed DB.
			return;
		}
		if (res.providers.length > 0) {
			const current = this.getActive()?.sessions.model ?? '';
			const catalog = catalogFromProviders(res.providers, current);
			for (const project of this.projects.values()) {
				project.sessions.applyProviderCatalog(catalog);
			}
			return;
		}
		for (const project of this.projects.values()) {
			project.sessions.requestModelList();
		}
	}

	private onBridgeEvent(event: BridgeEvent, handlers: WorkspaceProjectHandlers): void {
		if (event.type === 'engine_install_log') {
			this.engineHandlers?.onEngineInstallLog?.(event);
			return;
		}
		if (event.type === 'HelloOk') {
			if (event.hostHome) this.hostHome = event.hostHome;
			return;
		}
		if (event.type === 'ready') {
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

			// Hello may still carry the bare `default` alias — resolve the real label from
			// Settings / Providers so Composer shows the default model name, not "default".
			if (!wasReconnecting) {
				void this.refreshComposerChrome(handlers);
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
			return;
		}

		if (event.type === 'workspace_meta') {
			this.applyWorkspaceMeta(event, handlers);
			handlers.onEvent('engine', event);
			return;
		}

		// Host-level: PatchSettings fan-out — no session demux.
		if (event.type === 'settings_changed') {
			if (event.namespace === 'models') {
				void this.refreshComposerChrome(handlers);
			}
			handlers.onEvent('engine', event);
			return;
		}

		// Host-level: provider mutation fan-out — no session demux.
		if (event.type === 'providers_changed') {
			this.syncComposerCatalog();
			handlers.onEvent('engine', event);
			return;
		}

		// Host-level: skill mutation fan-out — no session demux.
		if (event.type === 'skills_changed') {
			handlers.onEvent('engine', event);
			return;
		}

		if (event.type === 'open_project_set') {
			// Legacy — ignored; Meta uses workspace_meta.
			handlers.onEvent('engine', event);
			return;
		}

		// Checkpoint push carries no sessionId: it belongs to a checkout, not a conversation. Falling
		// through to the active project would tell the wrong drawer its change list moved.
		if (event.type === 'tree_advanced' || event.type === 'review_changed') {
			const project = this.projectForHash(event.pathHash);
			if (project) handlers.onEvent(project.id, event);
			return;
		}

		// Editor FS watch / Save broadcast — checkout-scoped, same demux as review pushes.
		if (event.type === 'workspace_file_changed') {
			if (this.isLocalSaveEcho(event)) return;
			const project = this.projectForHash(event.pathHash);
			if (project) handlers.onEvent(project.id, event);
			return;
		}

		// Parallel FS replies correlate by requestId before name-based host waits.
		if (event.type === 'command_result' && event.requestId) {
			this.resolveRequestWaiters(event);
		}

		// Host Meta/schedule/teams/review waits — must resolve before session demux (stampSession=false → no sessionId).
		if (event.type === 'command_result' && HostWaitCommands.has(event.name)) {
			this.resolveRuleWaiters(event);
			handlers.onEvent('engine', event);
			return;
		}

		if (event.type === 'command_result' && event.name === 'CreateProject') {
			this.handleCreateProjectResult(event, handlers);
			return;
		}

		if (event.type === 'command_result' && event.name === 'RegisterWorkspace') {
			this.handleRegisterResult(event, handlers);
			return;
		}

		if (
			event.type === 'command_result' &&
			(event.name === 'CreateSession' || event.name === 'NewSession')
		) {
			this.handleCreateSessionResult(event, handlers);
			return;
		}

		if (
			event.type === 'command_result' &&
			(event.name === 'SetSessionTitle' || event.name === 'UpdateSessionStatus')
		) {
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
			return;
		}

		if (event.type === 'command_result' && event.name === 'SetProjectDisplayName') {
			this.handleSetProjectDisplayNameResult(event, handlers);
			return;
		}

		if (event.type === 'error') {
			const msg = typeof event.message === 'string' ? event.message : '';
			const pending = [...this.projects.values()].find(p => p.pendingDisplayName);
			if (
				pending &&
				(msg.includes('SetProjectDisplayName') || msg.includes('Unknown command type'))
			) {
				delete pending.pendingDisplayName;
				handlers.onError(
					pending.id,
					msg.includes('Unknown command')
						? 'Engine too old for project rename — rebuild/reinstall fast-agent'
						: msg
				);
			}
			handlers.onEvent(pending?.id ?? 'engine', event);
			return;
		}

		if (event.type === 'sessions_list') {
			this.handleSessionsList(event, handlers);
			return;
		}

		const sessionId =
			sessionIdFromEvent(event) ??
			(event.type === 'command_result' && 'sessionId' in event
				? (event as {sessionId?: string}).sessionId
				: undefined);

		if (isSessionStreamEvent(event.type)) {
			if (!sessionId) {
				handlers.onLog?.(
					'engine',
					`[session-demux] drop ${event.type} without sessionId`
				);
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

	private handleCreateSessionResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		const projectId =
			'projectId' in event && typeof (event as {projectId?: string}).projectId === 'string'
				? (event as {projectId: string}).projectId
				: undefined;
		const workspaceId =
			'workspaceId' in event && typeof (event as {workspaceId?: string}).workspaceId === 'string'
				? (event as {workspaceId: string}).workspaceId
				: undefined;
		const sessionId =
			'sessionId' in event && typeof (event as {sessionId?: string}).sessionId === 'string'
				? (event as {sessionId: string}).sessionId
				: undefined;
		const taskId =
			'taskId' in event && typeof (event as {taskId?: string}).taskId === 'string'
				? (event as {taskId: string}).taskId
				: undefined;
		const hash = workspaceId?.replace(/^workspace:/, '');
		const project =
			(taskId
				? [...this.projects.values()].find(p => p.sessions.listTasks().some(t => t.id === taskId))
				: undefined) ??
			(projectId
				? [...this.projects.values()].find(
						p => p.metaProjectId === projectId || (p.isDefault && projectId === 'default-project')
					)
				: undefined) ??
			(hash
				? [...this.projects.values()].find(p => p.workspaceId === hash || projectHash(p.path) === hash)
				: undefined) ??
			this.getActive();

		const failCreate = (projectHint: OpenProject | null | undefined, detailRaw?: string) => {
			const target = projectHint ?? this.getActive();
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
			this.settleRegisterWaiters(project);
		}
		if (projectId) project.metaProjectId = projectId;
		project.status = 'ready';
		project.error = undefined;
		// Engine adoptCreatedSession already binds before this result — pass hash so
		// acceptNewSession can Attach without a redundant BindSessionWorkspace round-trip.
		const bound = project.sessions.acceptNewSession(sessionId, taskId, hash);
		if (!bound) {
			// Duplicate CreateSession (e.g. retryPendingNew race): first result already
			// bound the row — any sessionId on that task means create succeeded.
			const row =
				project.sessions.listTasks().find(t => t.id === taskId) ??
				project.sessions.listChats().find(t => t.id === taskId);
			if (!row?.sessionId) {
				failCreate(project, event.message);
				return;
			}
		}
		// Clear sticky「创建失败」from a prior failed CreateSession (bridgeError).
		handlers.onError(project.id, '');
		handlers.onEvent(project.id, event);
		handlers.onSessionsChanged?.(project.id);
	}

	/** @deprecated alias */
	private handleNewSessionResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		this.handleCreateSessionResult(event, handlers);
	}

	private handleSetProjectDisplayNameResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		const metaProjectId =
			'projectId' in event && typeof (event as {projectId?: string}).projectId === 'string'
				? (event as {projectId: string}).projectId
				: undefined;
		const fromEvent =
			'displayName' in event && typeof (event as {displayName?: string}).displayName === 'string'
				? (event as {displayName: string}).displayName.trim()
				: '';
		const project = metaProjectId
			? [...this.projects.values()].find(p => p.metaProjectId === metaProjectId)
			: [...this.projects.values()].find(p => p.pendingDisplayName);
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
			if (!ok) {
				handlers.onError(project.id, event.message ?? 'SetProjectDisplayName failed');
			}
			handlers.onEvent(project.id, event);
			return;
		}
		handlers.onEvent('engine', event);
	}

	private handleCreateProjectResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		const projectId =
			'projectId' in event && typeof (event as {projectId?: string}).projectId === 'string'
				? (event as {projectId: string}).projectId
				: undefined;
		const workspaceId =
			'workspaceId' in event && typeof (event as {workspaceId?: string}).workspaceId === 'string'
				? (event as {workspaceId: string}).workspaceId
				: undefined;
		const pathHash =
			'pathHash' in event && typeof (event as {pathHash?: string}).pathHash === 'string'
				? (event as {pathHash: string}).pathHash
				: undefined;
		if (event.status !== 'accepted' || !projectId) {
			handlers.onError('engine', event.message ?? 'CreateProject failed');
			return;
		}
		const hash = (pathHash ?? workspaceId)?.replace(/^workspace:/, '');
		const project =
			(hash
				? [...this.projects.values()].find(p => projectHash(p.path) === hash)
				: undefined) ??
			(this.getActive() && !this.getActive()!.isDefault && !this.getActive()!.metaProjectId
				? this.getActive()!
				: undefined) ??
			[...this.projects.values()].find(p => !p.isDefault && !p.metaProjectId);
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
	}

	private applyWorkspaceMeta(
		event: Extract<BridgeEvent, {type: 'workspace_meta'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		const sessionsByProject = event.sessionsByProjectId ?? {};
		const remote = this.isRemote();
		for (const meta of event.projects) {
			const rawRoot = meta.workspace?.rootPath?.trim();
			const rootPath = remote
				? rawRoot ||
					(meta.isDefault && this.hostHome ? defaultProjectPathOnHost(this.hostHome) : undefined)
				: rawRoot
					? path.resolve(rawRoot)
					: meta.isDefault
						? defaultProjectPath(this.homeDir)
						: undefined;
			if (!rootPath && !meta.isDefault) continue;

			let project =
				[...this.projects.values()].find(p => p.metaProjectId === meta.id) ??
				(remote && meta.workspace?.pathHash
					? [...this.projects.values()].find(
							p =>
								p.workspaceId === meta.workspace?.pathHash ||
								projectHash(p.path) === meta.workspace?.pathHash
						)
					: undefined) ??
				(meta.isDefault && !remote
					? (this.getDefaultProject() ?? undefined)
					: rootPath
						? [...this.projects.values()].find(p =>
								remote
									? sameRemotePath(p.path, rootPath)
									: !p.isDefault && path.resolve(p.path) === rootPath
							)
						: undefined);

			if (!project && remote && rootPath) {
				if (!meta.isDefault && isReservedDefaultFolder(rootPath)) continue;
				project = this.adoptExistingFolder(
					rootPath,
					handlers,
					meta.id,
					meta.workspace?.pathHash,
					meta.displayName,
					{isDefault: Boolean(meta.isDefault), skipDisk: true}
				);
			} else if (!project && !remote && meta.isDefault) {
				this.ensureDefaultProject(handlers);
				project = this.getDefaultProject() ?? undefined;
			} else if (
				!project &&
				!remote &&
				!meta.isDefault &&
				rootPath &&
				existsSync(rootPath) &&
				!isDefaultProjectPath(rootPath, this.homeDir)
			) {
				project = this.adoptExistingFolder(
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
					this.settleRegisterWaiters(project);
				}
			} else if (meta.workspace?.pathHash === minted) {
				project.workspaceId = minted;
			}
			this.claimSlot(project);
			const metaName = meta.displayName?.trim();
			project.displayName =
				metaName || path.basename(rootPath ?? project.path);
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
	}

	/** Open a folder already known to Meta — no CreateProject; optional Slot register. */
	private adoptExistingFolder(
		workspaceRoot: string,
		handlers: WorkspaceProjectHandlers,
		metaProjectId?: string,
		pathHash?: string | null,
		displayName?: string | null,
		opts?: {isDefault?: boolean; skipDisk?: boolean}
	): OpenProject | undefined {
		const skipDisk = Boolean(opts?.skipDisk || this.isRemote());
		const existing = [...this.projects.values()].find(p =>
			skipDisk ? sameRemotePath(p.path, workspaceRoot) : path.resolve(p.path) === workspaceRoot
		);
		const stamp =
			pathHash &&
			(isEchoProbePath(workspaceRoot) || pathHash === projectHash(workspaceRoot))
				? pathHash
				: undefined;
		if (existing) {
			if (metaProjectId) existing.metaProjectId = metaProjectId;
			if (stamp) existing.workspaceId = stamp;
			existing.displayName = displayName?.trim() || path.basename(workspaceRoot);
			existing.status = 'ready';
			if (opts?.isDefault) existing.isDefault = true;
			this.claimSlot(existing);
			return existing;
		}
		this.ensureEngine(handlers);
		const id = this.createId();
		const clientId = this.createClientId();
		const sessions = new SessionController({
			clientId,
			send: (command: BridgeCommand) => this.bridge?.send(command) ?? false,
			onChange: () => handlers.onSessionsChanged?.(id),
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
			path: workspaceRoot,
			status: 'ready',
			sessions,
			clientId,
			isDefault: Boolean(opts?.isDefault),
			cwd: workspaceRoot,
			metaProjectId,
			workspaceId: stamp,
			displayName: displayName?.trim() || path.basename(workspaceRoot)
		};
		this.projects.set(id, project);
		// ink EnsureProject → workspace_meta adopt: never steal active focus (§9.3).
		sessions.seedHostSlashCatalog();
		// Sidebar can show from Meta pathHash; I/O still needs a process-local Slot.
		// Probe tmp is skipped inside ensureRegistered so a gone queue-echo-probe
		// does not paint an engine-wide banner.
		this.claimSlot(project);
		return project;
	}

	private handleRegisterResult(
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		if (event.status !== 'accepted' || !event.message) {
			const message = event.message ?? 'RegisterWorkspace failed';
			const missing = registerMissingDir(message);
			const hit = missing
				? [...this.projects.values()].find(
						p =>
							sameRemotePath(p.path, missing) || path.resolve(p.path) === path.resolve(missing)
					)
				: undefined;
			if (hit) {
				hit.status = 'error';
				hit.error = message;
				this.failRegisterWaiters(hit.id, message);
				if (!this.registerFailed.has(hit.id)) this.registerFailed.set(hit.id, message);
				handlers.onSessionsChanged?.(hit.id);
				return;
			}
			// The failure names no path — every parked review op has to give up.
			this.failRegisterWaiters(null, message);
			handlers.onError('engine', message);
			return;
		}
		const hash = event.message;
		const project = [...this.projects.values()].find(p => projectHash(p.path) === hash);
		if (!project) {
			handlers.onError('engine', `RegisterWorkspace hash unmatched: ${hash}`);
			return;
		}

		project.workspaceId = hash;
		project.slotLive = true;
		project.status = 'ready';
		project.error = undefined;
		project.cwd = project.path;
		this.settleRegisterWaiters(project);

		// Open Tab is the Bind/Attach working set (option B). Do NOT Bind every
		// inventory stub here — renderer reconcile calls ensureTasksLive(openTabs).
		// Hub only re-selects the Hub-active Task (cold default / pending create).
		const active = project.sessions.getActiveTask();
		if (active?.pendingNew && !active.sessionId) {
			project.sessions.retryPendingNew();
		} else if (active?.sessionId) {
			project.sessions.selectTask(active.id);
		} else if (!project.isDefault) {
			this.requestProjectSessionsList(project);
		}

		handlers.onEvent(project.id, event);
		handlers.onSessionsChanged?.(project.id);
	}

	private requestProjectSessionsList(project: OpenProject): void {
		this.pendingSessionsList.add(project.id);
		project.sessions.requestSessionsList();
	}

	private handleSessionsList(
		event: Extract<BridgeEvent, {type: 'sessions_list'}>,
		handlers: WorkspaceProjectHandlers
	): void {
		// One list may cover every registered workspace (Engine lists all hashes),
		// or a single hash when requestSessionsList passed workspaceId.
		let matched = false;
		for (const project of this.projects.values()) {
			const root = path.resolve(project.path);
			const filtered = event.sessions.filter(s => {
				if (!s.cwd) return false;
				return path.resolve(s.cwd) === root;
			});
			if (filtered.length === 0) continue;
			this.pendingSessionsList.delete(project.id);
			matched = true;
			project.sessions.hydrateFromSessionsList(filtered);
			const active = project.sessions.getActiveTask();
			if (active?.sessionId) {
				project.sessions.selectTask(active.id);
			}
			handlers.onEvent(project.id, event);
			handlers.onSessionsChanged?.(project.id);
		}
		// Filtered empty response: hydrate only the oldest pending Project.
		// Per-workspace `sessions` requests must not clear every other Project's waiter.
		if (event.sessions.length === 0 && this.pendingSessionsList.size > 0) {
			const id = this.pendingSessionsList.values().next().value as string;
			this.pendingSessionsList.delete(id);
			const project = this.projects.get(id);
			if (project) {
				matched = true;
				project.sessions.hydrateFromSessionsList([]);
				handlers.onEvent(project.id, event);
				handlers.onSessionsChanged?.(project.id);
			}
		}
		if (!matched) {
			handlers.onEvent('engine', event);
		}
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
