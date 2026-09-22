import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {isSessionStreamEvent} from '@fastllm/bridge-protocol';

export type AttachableTask = {
	id: string;
	sessionId: string | null;
	pendingNew: boolean;
	pendingAttach: boolean;
	lastEventSeq: number;
};

export function sessionIdFromEvent(event: BridgeEvent): string | undefined {
	if ('sessionId' in event && typeof (event as {sessionId?: unknown}).sessionId === 'string') {
		return (event as {sessionId: string}).sessionId;
	}
	return undefined;
}

export type SessionAttachStore = {
	bind(sessionId: string): void;
	unbind(sessionId: string): void;
	isAttached(sessionId: string | null | undefined): boolean;
	markRestored(sessionId: string): void;
	isRestored(sessionId: string | null | undefined): boolean;
	ids(): string[];
	first(): string | undefined;
	size(): number;
	clear(): void;
	/** True while a Bind for this session is outstanding, or until `now` passes the 5s budget. */
	bindInFlight(sessionId: string, now: number): boolean;
	/**
	 * True from Bind send until `session_restored` (or the 5s budget).
	 * `clearBind` does not end it: Bind acks in tens of ms, restore does not.
	 */
	liveInFlight(sessionId: string, now: number): boolean;
	armBind(sessionId: string, now: number): void;
	clearBind(sessionId: string): void;
	/** End the restore window early (Bind error). */
	releaseLive(sessionId: string): void;
	/** Count a failed Bind. True while another attempt is still allowed (3 total). */
	noteBindFailure(sessionId: string): boolean;
	resetBindFailure(sessionId: string): void;
};

export function createSessionAttachStore(): SessionAttachStore {
	const attached = new Set<string>();
	const restored = new Set<string>();
	const bindSentAt = new Map<string, number>();
	const liveSentAt = new Map<string, number>();
	const bindFailures = new Map<string, number>();
	const bindBudgetMs = 5_000;
	const bindRetryCap = 3;
	return {
		bind(sessionId) {
			attached.add(sessionId);
		},
		unbind(sessionId) {
			attached.delete(sessionId);
		},
		isAttached(sessionId) {
			return sessionId != null && attached.has(sessionId);
		},
		markRestored(sessionId) {
			restored.add(sessionId);
			liveSentAt.delete(sessionId);
		},
		isRestored(sessionId) {
			return sessionId != null && restored.has(sessionId);
		},
		ids() {
			return [...attached];
		},
		first() {
			for (const id of attached) return id;
			return undefined;
		},
		size() {
			return attached.size;
		},
		clear() {
			attached.clear();
			restored.clear();
			bindSentAt.clear();
			liveSentAt.clear();
			bindFailures.clear();
		},
		bindInFlight(sessionId, now) {
			const at = bindSentAt.get(sessionId);
			if (at == null) return false;
			if (now - at >= bindBudgetMs) {
				bindSentAt.delete(sessionId);
				return false;
			}
			return true;
		},
		liveInFlight(sessionId, now) {
			const at = liveSentAt.get(sessionId);
			if (at == null) return false;
			if (now - at >= bindBudgetMs) {
				liveSentAt.delete(sessionId);
				return false;
			}
			return true;
		},
		armBind(sessionId, now) {
			bindSentAt.set(sessionId, now);
			liveSentAt.set(sessionId, now);
		},
		clearBind(sessionId) {
			bindSentAt.delete(sessionId);
		},
		releaseLive(sessionId) {
			liveSentAt.delete(sessionId);
		},
		noteBindFailure(sessionId) {
			const n = (bindFailures.get(sessionId) ?? 0) + 1;
			bindFailures.set(sessionId, n);
			return n < bindRetryCap;
		},
		resetBindFailure(sessionId) {
			bindFailures.delete(sessionId);
		}
	};
}

export type ResolveTaskDeps<T extends AttachableTask> = {
	findTaskBySession(sessionId: string): T | null;
	getActiveTask(): T | null;
};

export function resolveEventTask<T extends AttachableTask>(
	event: BridgeEvent,
	eventSession: string | undefined,
	deps: ResolveTaskDeps<T>
): T | null {
	if (eventSession) {
		const bySession = deps.findTaskBySession(eventSession);
		if (bySession) return bySession;
		if (isSessionStreamEvent(event.type)) return null;
		if (event.type === 'session_restored' || event.type === 'session_history_page') {
			return null;
		}
	}
	return deps.getActiveTask();
}

export type SettleAttachedDeps<T extends AttachableTask> = ResolveTaskDeps<T> & {
	attach: SessionAttachStore;
	settleTask(task: T): void;
};

/**
 * Attached ack: bind the Session and settle pendingAttach/pendingNew on the
 * matching task. Never claim an unbound pendingNew from a stray Attached (ISO-4/8).
 */
export function settleAttachedEvent<T extends AttachableTask>(
	event: BridgeEvent,
	deps: SettleAttachedDeps<T>
): void {
	if (event.type !== 'Attached' || !event.sessionId) return;
	deps.attach.bind(event.sessionId);
	const existing = deps.findTaskBySession(event.sessionId);
	if (existing) {
		existing.pendingAttach = false;
		existing.pendingNew = false;
		deps.settleTask(existing);
		return;
	}
	const active = deps.getActiveTask();
	if (active?.pendingAttach && active.sessionId === event.sessionId) {
		active.pendingAttach = false;
		active.pendingNew = false;
		deps.settleTask(active);
	}
}

/** First `session_restored` window. Matches engine `MessageExchangeWindows.DefaultLimit`. */
export const AttachHistoryLimit = 8;

export type AttachRequest<T extends AttachableTask> = {
	tasks: Map<string, T>;
	task: T;
	sessionId: string;
	lastEventSeq?: number;
	send(command: BridgeCommand): boolean;
	clientId: string;
	attach: SessionAttachStore;
	settleTask(task: T): void;
	/** Override the restore window. Default is {@link AttachHistoryLimit}. */
	limit?: number;
};

/**
 * Bind+Attach a Task's Session. Drops hydrate stubs that raced in for the same
 * Session (ready/meta before bind). A successful AttachSession write is enough
 * to treat the session as attached (some engines delay or coalesce the ack).
 */
export function requestSessionAttach<T extends AttachableTask>(req: AttachRequest<T>): boolean {
	for (const [id, other] of req.tasks) {
		if (id !== req.task.id && other.sessionId === req.sessionId) req.tasks.delete(id);
	}
	req.task.sessionId = req.sessionId;
	req.task.pendingNew = false;
	req.task.pendingAttach = true;
	req.tasks.set(req.task.id, req.task);
	const ok = req.send({
		type: 'AttachSession',
		sessionId: req.sessionId,
		clientId: req.clientId,
		lastEventSeq: req.lastEventSeq ?? 0,
		limit: req.limit ?? AttachHistoryLimit
	});
	if (ok) {
		req.attach.bind(req.sessionId);
		req.task.pendingAttach = false;
		req.tasks.set(req.task.id, req.task);
	}
	return ok;
}

/** Detach targets: attached sessions first, then bound-but-unattached, deduped in order. */
export function detachTargets(
	attachedIds: Iterable<string>,
	taskSessionIds: Iterable<string | null | undefined>
): string[] {
	const seen = new Set<string>();
	for (const sessionId of attachedIds) {
		seen.add(sessionId);
	}
	for (const sessionId of taskSessionIds) {
		if (sessionId && !seen.has(sessionId)) seen.add(sessionId);
	}
	return [...seen];
}

/** Re-Attach every attached session (Hub reconnect / resync). */
export function resyncSessionAttach<T extends AttachableTask>(
	attach: SessionAttachStore,
	findTaskBySession: (sessionId: string) => T | null | undefined,
	request: (task: T, sessionId: string, lastEventSeq: number) => void
): void {
	for (const sessionId of attach.ids()) {
		const task = findTaskBySession(sessionId);
		if (task) request(task, sessionId, task.lastEventSeq);
	}
}

/** Detach everything the Host knows about (engine lost / reset), then drop the attach set. */
export function detachAllSessions(
	attach: SessionAttachStore,
	taskSessionIds: Iterable<string | null | undefined>,
	send: (command: BridgeCommand) => boolean,
	clientId: string
): void {
	for (const sessionId of detachTargets(attach.ids(), taskSessionIds)) {
		send({type: 'DetachSession', sessionId, clientId});
	}
	attach.clear();
}

/** Heartbeat every attached session; true when at least one write went out. */
export function heartbeatAttached(
	attach: SessionAttachStore,
	send: (command: BridgeCommand) => boolean,
	clientId: string,
	atMillis: number
): boolean {
	if (attach.size() === 0) return false;
	let any = false;
	for (const sessionId of attach.ids()) {
		any = send({type: 'Heartbeat', sessionId, clientId, atMillis}) || any;
	}
	return any;
}
