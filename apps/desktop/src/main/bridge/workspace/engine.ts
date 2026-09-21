import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {CONNECT_DEADLINE_MS} from '../../remoteEdges.js';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {EngineCallError, EngineCallResult, EngineHostStatus, ProjectSnapshot} from '@fast-ide/session-view';
import type {RemoteBridgeConnectionOptions} from '@fastllm/bridge-client';
import type {BridgeClient} from '../BridgeClient.js';
import {isReservedDefaultFolder, sameRemotePath} from '../remotePaths.js';
import type {SwitchEdgeTarget, WorkspaceProjectHandlers} from '../WorkspaceHub.js';
import type {WorkspaceAdopt} from './adopt.js';
import type {HostWait} from './hostWait.js';

export type EngineProject = {
	id: string;
	path: string;
	status: string;
	error?: string;
	sessions: {
		markEngineLost: (msg: string, opts: {failTurns: boolean}) => void;
		detachAll: () => void;
		getActiveTask: () => {sessionId?: string | null} | null;
		engineKind?: string;
	};
	slotLive?: boolean;
};

export type EngineHost = {
	committedEdgeId: string;
	pendingEdgeId: string | null;
	engineStatus: EngineHostStatus;
	bridge: BridgeClient | null;
	switchAbort?: AbortController;
	edgeAttempt: number;
	engineHandlers: WorkspaceProjectHandlers | null;
	hostCwd: string;
	hostHome?: string;
	switchingEdge: boolean;
	shuttingDown: boolean;
	remoteOpts?: RemoteBridgeConnectionOptions;
	engineHandshakeOk: boolean;
	rebindAttempts: number;
	rebindResetTimer: ReturnType<typeof setTimeout> | null;
	persistActiveId?: (id: string) => void;
	createBridge: () => BridgeClient;
	createClientId: () => string;
	isRemote: () => boolean;
	projects: Map<string, EngineProject>;
	activeProjectId: string | null;
	lastReady: Extract<BridgeEvent, {type: 'ready'}> | null;
	pendingSessionsList: Set<string>;
	adopt: WorkspaceAdopt;
	hostWait: HostWait;
	projectOps: {ensureRegisteredAsync: (project: EngineProject) => Promise<void>};
	onBridgeEvent: (event: BridgeEvent, handlers: WorkspaceProjectHandlers) => void;
	reconcileTerminalParseFailure: (message: string, handlers: WorkspaceProjectHandlers) => boolean;
	noticeProtocolMismatch: (message: string, handlers: WorkspaceProjectHandlers) => boolean;
	setEngineStatus: (status: EngineHostStatus, error?: string) => void;
	requestWorkspaceMeta: () => boolean;
	failRegisterWaiters: (projectId: string | null, message: string) => void;
	scheduleRebind: (handlers: WorkspaceProjectHandlers) => void;
	focusProject: (projectId: string) => boolean;
	snapshot: (p: EngineProject) => ProjectSnapshot;
	getActive: () => EngineProject | null;
};

export type WorkspaceEngine = {
	switchEdge: (target: SwitchEdgeTarget, handlers: WorkspaceProjectHandlers) => Promise<void>;
	openRemoteProject: (serverPath: string, handlers: WorkspaceProjectHandlers) => Promise<ProjectSnapshot>;
	engineCall: (
		method: string,
		payload?: Record<string, unknown>,
		sessionId?: string
	) => Promise<EngineCallResult>;
	startEngine: (handlers: WorkspaceProjectHandlers) => void;
	ensureEngine: (handlers: WorkspaceProjectHandlers) => void;
};

export function createEngine(h: EngineHost): WorkspaceEngine {
	const commitCandidate = (
		candidate: BridgeClient,
		target: SwitchEdgeTarget,
		handlers: WorkspaceProjectHandlers
	): void => {
		h.switchingEdge = true;
		const old = h.bridge;
		if (old && old !== candidate) old.stop();
		clearProjectsForSwitch();
		h.bridge = candidate;
		h.committedEdgeId = target.id;
		h.remoteOpts = target.remote;
		h.pendingEdgeId = null;
		h.switchAbort = undefined;
		h.engineHandshakeOk = true;
		h.rebindAttempts = 0;
		h.persistActiveId?.(target.id);
		h.switchingEdge = false;
		h.shuttingDown = false;
		h.engineHandlers = handlers;
		h.setEngineStatus('ready');
	};

	const clearProjectsForSwitch = (): void => {
		h.failRegisterWaiters(null, 'Edge switched');
		for (const project of h.projects.values()) {
			project.sessions.detachAll();
		}
		h.projects.clear();
		h.activeProjectId = null;
		h.lastReady = null;
		h.pendingSessionsList.clear();
	};

	const dropAdoptedRow = (id: string): void => {
		h.projects.delete(id);
		if (h.activeProjectId === id) {
			h.activeProjectId = [...h.projects.keys()][0] ?? null;
		}
	};

	const handleEngineExit = (
		bridge: BridgeClient,
		handlers: WorkspaceProjectHandlers,
		code: number | null,
		signal: NodeJS.Signals | null
	): void => {
		if (h.bridge !== bridge) return;
		h.bridge = null;
		const hostDied = code != null || signal != null;
		h.failRegisterWaiters(null, `Connection lost (${code ?? signal ?? 'unknown'})`);
		if (h.rebindResetTimer) {
			clearTimeout(h.rebindResetTimer);
			h.rebindResetTimer = null;
		}
		for (const project of h.projects.values()) {
			project.status = 'exited';
			project.slotLive = false;
			project.error = `Connection lost (${code ?? signal ?? 'unknown'})`;
			project.sessions.markEngineLost(`Connection lost (${code ?? signal ?? 'unknown'})`, {
				failTurns: hostDied
			});
			handlers.onExit(project.id, code, signal);
		}
		if (!h.shuttingDown && !h.switchingEdge && h.engineHandshakeOk) {
			h.scheduleRebind(handlers);
		}
	};

	const startEngine = (handlers: WorkspaceProjectHandlers): void => {
		h.shuttingDown = false;
		h.engineHandshakeOk = false;
		if (!h.isRemote()) mkdirSync(h.hostCwd, {recursive: true});
		h.setEngineStatus(h.rebindAttempts > 0 ? 'reconnecting' : 'starting');
		const bridge = h.createBridge();
		h.bridge = bridge;
		const remote = h.remoteOpts
			? {...h.remoteOpts, timeoutMs: h.remoteOpts.timeoutMs ?? CONNECT_DEADLINE_MS}
			: undefined;

		void Promise.resolve(
			bridge.start(
				h.hostCwd,
				{
					onEvent: event => {
						if (event.type === 'HelloOk' && event.hostHome) h.hostHome = event.hostHome;
						h.onBridgeEvent(event, handlers);
					},
					onError: message => {
						if (h.switchingEdge) return;
						if (h.reconcileTerminalParseFailure(message, handlers)) return;
						h.setEngineStatus('error', message);
						handlers.onError('engine', message);
					},
					onLog: message => handlers.onLog?.('engine', message),
					onExit: (code, signal) => {
						if (h.switchingEdge || h.shuttingDown) return;
						handleEngineExit(bridge, handlers, code, signal);
					}
				},
				{
					sessionMode: 'continue',
					remote,
					clientId: h.createClientId(),
					wantEngineId: process.env.FAST_WANT_ENGINE_ID
				}
			)
		)
			.then(() => {
				if (h.bridge === bridge) h.engineHandshakeOk = true;
			})
			.catch(error => {
				if (h.bridge === bridge) h.bridge = null;
				if (error instanceof Error && error.name === 'AbortError') return;
			});
	};

	const ensureEngine = (handlers: WorkspaceProjectHandlers): void => {
		h.engineHandlers = handlers;
		if (
			h.bridge &&
			(h.engineStatus === 'ready' ||
				h.engineStatus === 'starting' ||
				h.engineStatus === 'reconnecting')
		) {
			return;
		}
		if (h.bridge) {
			h.bridge.stop();
			h.bridge = null;
		}
		startEngine(handlers);
	};

	return {
		startEngine,
		ensureEngine,
		async switchEdge(target: SwitchEdgeTarget, handlers: WorkspaceProjectHandlers): Promise<void> {
			if (target.id === h.committedEdgeId && !h.pendingEdgeId && h.engineStatus === 'ready' && h.bridge) {
				return;
			}
			h.switchAbort?.abort();
			const attempt = ++h.edgeAttempt;
			const ac = new AbortController();
			h.switchAbort = ac;
			h.pendingEdgeId = target.id;
			h.engineHandlers = handlers;

			const candidate = h.createBridge();
			const remote = target.remote
				? {
						...target.remote,
						signal: ac.signal,
						timeoutMs: target.remote.timeoutMs ?? CONNECT_DEADLINE_MS
					}
				: undefined;
			const buffered: BridgeEvent[] = [];
			let live = false;
			const isCurrent = () => attempt === h.edgeAttempt && !ac.signal.aborted;

			const liveHandlers: Parameters<BridgeClient['start']>[1] = {
				onEvent: event => {
					if (!isCurrent()) return;
					if (event.type === 'HelloOk' && event.hostHome) h.hostHome = event.hostHome;
					if (!live) {
						buffered.push(event);
						return;
					}
					h.onBridgeEvent(event, handlers);
				},
				onError: message => {
					if (!isCurrent() || !live) return;
					if (h.reconcileTerminalParseFailure(message, handlers)) return;
					if (h.noticeProtocolMismatch(message, handlers)) return;
					h.setEngineStatus('error', message);
					handlers.onError('engine', message);
				},
				onLog: message => {
					if (!isCurrent()) return;
					handlers.onLog?.('engine', message);
				},
				onExit: (code, signal) => {
					if (!isCurrent() || h.switchingEdge || h.shuttingDown) return;
					if (!live) return;
					handleEngineExit(candidate, handlers, code, signal);
				}
			};

			try {
				await candidate.start(
					h.hostCwd,
					liveHandlers,
					{
						sessionMode: 'continue',
						remote,
						clientId: h.createClientId(),
						wantEngineId: process.env.FAST_WANT_ENGINE_ID
					}
				);
			} catch (error) {
				candidate.stop();
				if (ac.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
					if (h.pendingEdgeId === target.id && attempt === h.edgeAttempt) {
						h.pendingEdgeId = null;
					}
					throw Object.assign(new Error('aborted'), {name: 'AbortError'});
				}
				if (attempt === h.edgeAttempt) h.pendingEdgeId = null;
				throw error instanceof Error ? error : new Error(String(error));
			}

			if (!isCurrent()) {
				candidate.stop();
				throw Object.assign(new Error('aborted'), {name: 'AbortError'});
			}

			commitCandidate(candidate, target, handlers);
			live = true;
			for (const event of buffered) h.onBridgeEvent(event, handlers);
			h.requestWorkspaceMeta();
		},

		async openRemoteProject(
			serverPath: string,
			handlers: WorkspaceProjectHandlers
		): Promise<ProjectSnapshot> {
			if (!h.isRemote()) throw new Error('openRemoteProject is only available on a remote edge');
			if (h.pendingEdgeId) throw new Error('Edge switch in progress');
			const raw = serverPath.trim();
			if (!raw) throw new Error('Path is required');
			if (isReservedDefaultFolder(raw)) {
				throw new Error('Cannot open the hidden Default Project as a folder Project');
			}
			const existing = [...h.projects.values()].find(p => sameRemotePath(p.path, raw));
			if (existing) {
				h.focusProject(existing.id);
				return h.snapshot(existing);
			}
			h.engineHandlers = handlers;
			const project = h.adopt.adoptExistingFolder(raw, handlers, undefined, undefined, undefined, {
				isDefault: false,
				skipDisk: true
			}) as EngineProject | undefined;
			if (!project) throw new Error('Failed to adopt remote folder');
			if (!h.bridge || h.engineStatus !== 'ready') {
				dropAdoptedRow(project.id);
				throw new Error('Engine not ready');
			}
			try {
				await h.projectOps.ensureRegisteredAsync(project);
				h.requestWorkspaceMeta();
				return h.snapshot(project);
			} catch (error) {
				dropAdoptedRow(project.id);
				throw error instanceof Error ? error : new Error(String(error));
			}
		},

		async engineCall(
			method: string,
			payload: Record<string, unknown> = {},
			sessionId?: string
		): Promise<EngineCallResult> {
			if (!h.bridge || h.engineStatus !== 'ready') {
				return {ok: false, error: {code: 'unavailable', message: 'Engine not ready'}};
			}
			const sessions = h.getActive()?.sessions;
			const sid = sessionId?.trim() || sessions?.getActiveTask()?.sessionId || undefined;
			const engineKind = sessions?.engineKind;
			const requestId = randomUUID();
			const {token, promise} = h.hostWait.waitRequest(requestId);
			if (
				!h.bridge.send({
					type: 'EngineCall',
					method,
					payload,
					requestId,
					...(sid ? {sessionId: sid} : {}),
					...(engineKind ? {engineKind} : {})
				})
			) {
				h.hostWait.cancel(token);
				return {ok: false, error: {code: 'unavailable', message: 'Failed to send EngineCall'}};
			}
			try {
				const event = await promise;
				if (event.status === 'error' || event.status === 'rejected') {
					const err = event.error;
					if (err && typeof err.code === 'string') {
						return {ok: false, error: err as EngineCallError};
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
	};
}
