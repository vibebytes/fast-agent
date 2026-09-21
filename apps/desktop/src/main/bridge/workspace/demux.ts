import path from 'node:path';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {EngineHostStatus} from '@fast-ide/session-view';
import type {BridgeClient} from '../BridgeClient.js';
import {isSessionStreamEvent, sessionIdFromEvent} from '../sessionEvents.js';
import type {WorkspaceProjectHandlers} from '../WorkspaceHub.js';
import type {WorkspaceAdopt} from './adopt.js';
import type {ComposerHeal} from './composerHeal.js';
import {HostWaitCommands, type HostWait} from './hostWait.js';

export type DemuxProject = {
	id: string;
	path: string;
	status: string;
	error?: string;
	isDefault: boolean;
	metaProjectId?: string;
	sessions: {handleEvent: (event: BridgeEvent) => void};
};

export type DemuxHost = {
	engineStatus: EngineHostStatus;
	engineHandlers: WorkspaceProjectHandlers | null;
	hostHome?: string;
	lastReady: Extract<BridgeEvent, {type: 'ready'}> | null;
	projects: Map<string, DemuxProject>;
	bridge: BridgeClient | null;
	adopt: WorkspaceAdopt;
	hostWait: HostWait;
	composerHeal: ComposerHeal;
	setEngineStatus: (status: EngineHostStatus, error?: string) => void;
	armStableLease: () => void;
	getActive: () => DemuxProject | null;
	isRemote: () => boolean;
	requestWorkspaceMeta: () => boolean;
	refreshPickerEngines: (handlers: WorkspaceProjectHandlers) => void;
	schedulePickerRefresh: (handlers: WorkspaceProjectHandlers) => void;
	fanoutCheckoutPush: (event: BridgeEvent, handlers: WorkspaceProjectHandlers) => boolean;
	fanoutSessionChrome: (
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	) => void;
	isLocalSaveEcho: (event: Extract<BridgeEvent, {type: 'workspace_file_changed'}>) => boolean;
	handleBareError: (event: BridgeEvent, handlers: WorkspaceProjectHandlers) => boolean;
	projectForHash: (pathHash: string | undefined) => {id: string} | null;
	projectForSession: (sessionId: string | undefined) => DemuxProject | null;
};

export type WorkspaceDemux = {
	dispatchCommandResult: (
		event: Extract<BridgeEvent, {type: 'command_result'}>,
		handlers: WorkspaceProjectHandlers
	) => boolean;
	dispatchTypedEvent: (event: BridgeEvent, handlers: WorkspaceProjectHandlers) => boolean;
	demuxSession: (event: BridgeEvent, handlers: WorkspaceProjectHandlers) => void;
};

export function createDemux(h: DemuxHost): WorkspaceDemux {
	const unhandledType = (_event: BridgeEvent, _handlers: WorkspaceProjectHandlers): boolean =>
		false;

	const handleReady = (
		event: Extract<BridgeEvent, {type: 'ready'}>,
		handlers: WorkspaceProjectHandlers
	): void => {
		// ready is not SessionBind authority — CreateSession command_result + taskId binds.
		// Do not re-GetWorkspaceMeta on every ready (cold-start only on firstReady).
		// Engine-level model chrome must still reach every Project SessionController —
		// Hello ready often has no sessionId, and the old path skipped handleEvent entirely
		// leaving Composer stuck on the placeholder "Default".
		const firstReady = h.engineStatus !== 'ready';
		const wasReconnecting = h.engineStatus === 'reconnecting';
		h.setEngineStatus('ready');
		// Do not zero backoff on the first ready after a drop — a 2s write-stall
		// used to reset this and spin Hello/CreateProject every ~5s.
		h.armStableLease();
		h.lastReady = event;

		for (const project of h.projects.values()) {
			project.status = 'ready';
			project.error = undefined;
			project.sessions.handleEvent(event);
		}

		const active = h.getActive();
		if (active) {
			handlers.onEvent(active.id, event);
			handlers.onSessionsChanged?.(active.id);
		} else {
			handlers.onEvent('engine', event);
		}

		if (!wasReconnecting) {
			void h.composerHeal.refreshComposerChrome(handlers);
		}

		if (firstReady) {
			for (const project of h.projects.values()) {
				if (project.isDefault) continue;
				if (!h.isRemote() && !project.metaProjectId) {
					h.bridge?.send({
						type: 'CreateProject',
						projectType: 'coding',
						rootPath: project.path,
						displayName: path.basename(project.path)
					});
				}
				h.bridge?.send({type: 'RegisterWorkspace', path: project.path});
			}
			h.requestWorkspaceMeta();
			h.refreshPickerEngines(handlers);
			h.schedulePickerRefresh(handlers);
		} else if (wasReconnecting) {
			h.refreshPickerEngines(handlers);
		}
	};

	const typedBridge: Record<
		string,
		(event: BridgeEvent, handlers: WorkspaceProjectHandlers) => boolean
	> = {
		engine_install_log: event => {
			if (event.type !== 'engine_install_log') return false;
			h.engineHandlers?.onEngineInstallLog?.(event);
			return true;
		},
		HelloOk: event => {
			if (event.type !== 'HelloOk') return false;
			if (event.hostHome) h.hostHome = event.hostHome;
			return true;
		},
		ready: (event, handlers) => {
			if (event.type !== 'ready') return false;
			handleReady(event, handlers);
			return true;
		},
		workspace_meta: (event, handlers) => {
			if (event.type !== 'workspace_meta') return false;
			h.adopt.applyWorkspaceMeta(event, handlers);
			handlers.onEvent('engine', event);
			return true;
		},
		settings_changed: (event, handlers) => {
			if (event.type !== 'settings_changed') return false;
			if (event.namespace === 'models') void h.composerHeal.refreshComposerChrome(handlers);
			handlers.onEvent('engine', event);
			return true;
		},
		providers_changed: (event, handlers) => {
			h.composerHeal.syncComposerCatalog();
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
		tree_advanced: (event, handlers) => h.fanoutCheckoutPush(event, handlers),
		review_changed: (event, handlers) => h.fanoutCheckoutPush(event, handlers),
		workspace_file_changed: (event, handlers) => {
			if (event.type !== 'workspace_file_changed') return false;
			if (h.isLocalSaveEcho(event)) return true;
			h.fanoutCheckoutPush(event, handlers);
			return true;
		},
		host_error: (event, handlers) => {
			if (event.type !== 'host_error') return false;
			h.hostWait.hostError(event.message);
			handlers.onError('engine', event.message);
			handlers.onEvent('engine', event);
			return true;
		},
		error: (event, handlers) => h.handleBareError(event, handlers),
		sessions_list: (event, handlers) => {
			if (event.type !== 'sessions_list') return false;
			h.adopt.handleSessionsList(event, handlers);
			return true;
		}
	};

	return {
		dispatchCommandResult(
			event: Extract<BridgeEvent, {type: 'command_result'}>,
			handlers: WorkspaceProjectHandlers
		): boolean {
			if (event.requestId) h.hostWait.resolveByRequestId(event);
			if (HostWaitCommands.has(event.name)) {
				const eventCheckout =
					'pathHash' in event && typeof event.pathHash === 'string'
						? h.projectForHash(event.pathHash)?.id
						: undefined;
				h.hostWait.resolveByName(event, eventCheckout);
				handlers.onEvent('engine', event);
				return true;
			}
			if (h.adopt.handleCommand(event, handlers)) return true;
			if (event.name === 'SetSessionTitle' || event.name === 'UpdateSessionStatus') {
				h.fanoutSessionChrome(event, handlers);
				return true;
			}
			return false;
		},
		dispatchTypedEvent(event: BridgeEvent, handlers: WorkspaceProjectHandlers): boolean {
			return (typedBridge[event.type] ?? unhandledType)(event, handlers);
		},
		demuxSession(event: BridgeEvent, handlers: WorkspaceProjectHandlers): void {
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
				const project = h.projectForSession(sessionId);
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

			const project = sessionId ? h.projectForSession(sessionId) : h.getActive();
			if (!project) {
				handlers.onEvent('engine', event);
				return;
			}
			project.sessions.handleEvent(event);
			handlers.onEvent(project.id, event);
		}
	};
}
