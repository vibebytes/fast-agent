/**
 * Unix Thin Client session bootstrap after Machine-scoped Bridge Hello/ready.
 * Pure state machine — AgentProcess owns send/side-effects.
 */
import type {BridgeCommand, BridgeEvent} from './protocol.js';
import {latestActiveSession, type SessionLaunchConfig} from './sessionLaunch.js';

export type WorkspaceMetaEvent = Extract<BridgeEvent, {type: 'workspace_meta'}>;

export type UnixBootstrap = {
	ensureProjectSent: boolean;
	sessionBootstrapped: boolean;
	pendingContinueProjectId?: string;
	lastMeta?: WorkspaceMetaEvent;
};

export function emptyUnixBootstrap(): UnixBootstrap {
	return {ensureProjectSent: false, sessionBootstrapped: false};
}

export type UnixBootstrapStep = {
	bootstrap: UnixBootstrap;
	/** Event to forward to UI (undefined = drop). */
	forward?: BridgeEvent;
	sends: BridgeCommand[];
};

/**
 * Drive EnsureProject → CreateSession/Attach for a project-scoped ink session.
 * Strips host boot sessionId from `ready` (daemon --continue cwd ≠ ink cwd).
 */
export function stepUnixBootstrap(
	bootstrap: UnixBootstrap,
	event: BridgeEvent,
	opts: {
		cwd: string;
		clientId: string;
		sessionConfig: SessionLaunchConfig;
		displayName: string;
		stopped?: boolean;
	}
): UnixBootstrapStep {
	if (opts.stopped) return {bootstrap, forward: event, sends: []};

	let next = bootstrap;
	const sends: BridgeCommand[] = [];
	let forward: BridgeEvent | undefined = event;

	if (event.type === 'ready' || event.type === 'HelloOk') {
		if (!next.ensureProjectSent) {
			next = {...next, ensureProjectSent: true};
			sends.push({
				type: 'EnsureProject',
				path: opts.cwd,
				projectType: 'coding',
				displayName: opts.displayName
			});
		}
	}

	if (event.type === 'ready') {
		// Machine ready is fan-out (often IDE's snapshot). Never adopt peer
		// sessionId/cwd — that yields queue> + footer path from IDE + 引擎无响应.
		forward = {
			...event,
			sessionId: undefined,
			sessionTitle: undefined,
			restoredMessageCount: undefined,
			cwd: undefined
		};
	}

	if (event.type === 'workspace_meta') {
		next = {...next, lastMeta: event};
		const cont = finishContinue(next, event, opts);
		next = cont.bootstrap;
		sends.push(...cont.sends);
	}

	if (event.type === 'command_result' && event.name === 'EnsureProject') {
		if (event.status === 'accepted' && event.projectId) {
			const boot = beginProjectSession(next, event.projectId, opts);
			next = boot.bootstrap;
			sends.push(...boot.sends);
		}
	}

	if (
		event.type === 'command_result' &&
		event.name === 'CreateSession' &&
		event.status === 'accepted' &&
		event.sessionId
	) {
		next = {
			...next,
			sessionBootstrapped: true,
			pendingContinueProjectId: undefined
		};
		sends.push({
			type: 'AttachSession',
			sessionId: event.sessionId,
			clientId: opts.clientId,
			lastEventSeq: 0,
			limit: 50
		});
	}

	return {bootstrap: next, forward, sends};
}

function beginProjectSession(
	bootstrap: UnixBootstrap,
	projectId: string,
	opts: {
		clientId: string;
		sessionConfig: SessionLaunchConfig;
		displayName: string;
	}
): {bootstrap: UnixBootstrap; sends: BridgeCommand[]} {
	if (bootstrap.sessionBootstrapped) return {bootstrap, sends: []};

	const mode = opts.sessionConfig.mode;
	if (mode === 'resume' && opts.sessionConfig.sessionId) {
		return {
			bootstrap: {...bootstrap, sessionBootstrapped: true, pendingContinueProjectId: undefined},
			sends: [
				{
					type: 'AttachSession',
					sessionId: opts.sessionConfig.sessionId,
					clientId: opts.clientId,
					lastEventSeq: 0,
					limit: 50
				}
			]
		};
	}

	if (mode === 'new') {
		return {
			bootstrap,
			sends: [{type: 'CreateSession', projectId, title: opts.displayName}]
		};
	}

	// continue: meta may have raced ahead of EnsureProject command_result (IDE fan-out).
	const pending = {...bootstrap, pendingContinueProjectId: projectId};
	if (pending.lastMeta) {
		return finishContinue(pending, pending.lastMeta, opts);
	}
	return {
		bootstrap: pending,
		sends: [{type: 'GetWorkspaceMeta'}]
	};
}

function finishContinue(
	bootstrap: UnixBootstrap,
	event: WorkspaceMetaEvent,
	opts: {clientId: string; displayName: string}
): {bootstrap: UnixBootstrap; sends: BridgeCommand[]} {
	const projectId = bootstrap.pendingContinueProjectId;
	if (!projectId || bootstrap.sessionBootstrapped) return {bootstrap, sends: []};

	const latest = latestActiveSession(event.sessionsByProjectId?.[projectId] ?? []);
	if (latest) {
		return {
			bootstrap: {
				...bootstrap,
				sessionBootstrapped: true,
				pendingContinueProjectId: undefined
			},
			sends: [
				{
					type: 'AttachSession',
					sessionId: latest.id,
					clientId: opts.clientId,
					lastEventSeq: 0,
					limit: 50
				}
			]
		};
	}

	return {
		bootstrap: {...bootstrap, pendingContinueProjectId: undefined},
		sends: [{type: 'CreateSession', projectId, title: opts.displayName}]
	};
}
