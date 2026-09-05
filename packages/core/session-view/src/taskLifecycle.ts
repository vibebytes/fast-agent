import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

export type EngineKind = 'fast' | 'dsh';

export function parseEngineKind(raw?: string | null): EngineKind {
	return (raw ?? '').trim().toLowerCase() === 'dsh' ? 'dsh' : 'fast';
}

/** Structural view of a Host Task row — enough for lifecycle, no TaskRecord leak. */
export type LifecycleTask = {
	id: string;
	title: string;
	kind: 'task' | 'chat';
	sessionId: string | null;
	listOrder: number;
	pendingNew: boolean;
	createRequested?: boolean;
	autoTitlePending?: boolean;
	engineKind?: EngineKind;
};

/** Delete-only view over Host bookkeeping maps cleaned up alongside a task. */
export type RemovableKeys = {
	delete(key: string): boolean;
	has(key: string): boolean;
};

export type DeleteResult = {ok: boolean; notice?: string};

export interface TaskLifecycleDeps<T extends LifecycleTask> {
	createId(): string;
	now(): number;
	send(cmd: BridgeCommand): boolean;
	projectId(): string | undefined;
	workspaceId(): string | undefined;
	requestRegister(): void;
	requestAttach(task: T, sessionId: string, attempt: number): void;
	selectTask(taskId: string): void;
	getActiveTask(): T | null;
	getActiveTaskId(): string | null;
	setActiveTaskId(taskId: string | null): void;
	setActiveEngineKind(k: EngineKind): void;
	setHelpNotice(notice: string): void;
	onChange(): void;
	taskBySessionId(sessionId: string): T | null;
	taskRunActive(task: T): boolean;
	cancelRunForTask(task: T, reason: string): void;
	forgetTask(taskId: string): void;
	attachedSessionIds: Set<string>;
	seqBySession: RemovableKeys;
	buildEntry(id: string, kind: 'task' | 'chat', title: string, listOrder: number): T;
	deleteWaitMs?: number;
}

/**
 * Host-side task lifecycle: optimistic create, rename, soft-delete, and the
 * command_result bookkeeping (SetSessionTitle / SetEngineKind / UpdateSessionStatus)
 * that settles those optimistic writes. Owns the task map plus its pending maps;
 * the Host stays responsible only for minting rows (`buildEntry`) and its own
 * chrome/watchdog state.
 */
export function createTaskLifecycle<T extends LifecycleTask>(deps: TaskLifecycleDeps<T>) {
	const deleteWaitMs = deps.deleteWaitMs ?? 30_000;
	const tasks = new Map<string, T>();
	/** Optimistic rename revert keyed by Engine sessionId. */
	const pendingTitleBySession = new Map<string, {taskId: string; previous: string}>();
	/** Optimistic engineKind revert keyed by Engine sessionId. */
	const pendingEngineBySession = new Map<string, EngineKind>();
	/** Soft-delete waiters keyed by Engine sessionId. */
	const pendingDeleteBySession = new Map<
		string,
		{
			taskId: string;
			resolve: (result: DeleteResult) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();

	const listTasks = (): T[] =>
		[...tasks.values()].filter(t => t.kind === 'task').sort((a, b) => b.listOrder - a.listOrder);

	const listChats = (): T[] => [...tasks.values()].filter(t => t.kind === 'chat');

	const createTask = (title: string): T => createEntry(title.trim() || 'New task', 'task');

	const createChat = (title: string): T => createEntry(title.trim() || 'New chat', 'chat');

	/**
	 * Rename Task/Chat display title on Engine Session.
	 * Requires sessionId (pendingNew Tasks cannot rename yet).
	 */
	const renameTask = (taskId: string, title: string): boolean => {
		const task = tasks.get(taskId);
		if (!task?.sessionId || task.pendingNew) return false;
		const trimmed = title.trim();
		if (!trimmed || trimmed === task.title) return trimmed === task.title;
		const previous = task.title;
		task.title = trimmed;
		tasks.set(taskId, task);
		pendingTitleBySession.set(task.sessionId, {taskId, previous});
		const ok = deps.send({
			type: 'SetSessionTitle',
			sessionId: task.sessionId,
			title: trimmed
		});
		if (!ok) {
			task.title = previous;
			tasks.set(taskId, task);
			pendingTitleBySession.delete(task.sessionId);
			return false;
		}
		deps.onChange();
		return true;
	};

	/**
	 * Soft-delete Engine Session, or discard an unbound optimistic create.
	 * Resolves after accepted/error `UpdateSessionStatus` (or immediately for pending create).
	 */
	const deleteTask = (taskId: string): Promise<DeleteResult> => {
		const task = tasks.get(taskId);
		if (!task) return Promise.resolve({ok: false, notice: 'Task not found'});

		if (task.pendingNew && !task.sessionId) {
			const ok = failPendingCreate(taskId);
			return Promise.resolve(ok ? {ok: true} : {ok: false, notice: 'Cannot discard pending task'});
		}

		if (!task.sessionId || task.pendingNew) {
			return Promise.resolve({ok: false, notice: 'Cannot delete until session is ready'});
		}

		const sessionId = task.sessionId;
		if (pendingDeleteBySession.has(sessionId)) {
			return Promise.resolve({ok: false, notice: 'Delete already in progress'});
		}

		if (deps.taskRunActive(task) && deps.attachedSessionIds.has(sessionId)) {
			deps.cancelRunForTask(task, 'cancelled before delete');
		}

		return new Promise<DeleteResult>(resolve => {
			const timer = setTimeout(() => {
				const pending = pendingDeleteBySession.get(sessionId);
				if (!pending || pending.taskId !== taskId) return;
				pendingDeleteBySession.delete(sessionId);
				pending.resolve({ok: false, notice: 'Delete timed out'});
			}, deleteWaitMs);

			pendingDeleteBySession.set(sessionId, {taskId, resolve, timer});
			const ok = deps.send({
				type: 'UpdateSessionStatus',
				sessionId,
				status: 'deleted'
			});
			if (!ok) {
				clearTimeout(timer);
				pendingDeleteBySession.delete(sessionId);
				resolve({ok: false, notice: 'Engine not connected'});
			}
		});
	};

	/** Resolve a soft-delete waiter; apply removal on success, surface notice otherwise. */
	const settleDelete = (sessionId: string, result: DeleteResult): void => {
		const pending = pendingDeleteBySession.get(sessionId);
		if (!pending) return;
		clearTimeout(pending.timer);
		pendingDeleteBySession.delete(sessionId);
		if (result.ok) {
			applyDeletedTask(pending.taskId);
		} else if (result.notice) {
			deps.setHelpNotice(result.notice);
			deps.onChange();
		}
		pending.resolve(result);
	};

	/** Remove Task after Engine accepted soft-delete; focus next sibling when needed. */
	const applyDeletedTask = (taskId: string): void => {
		const task = tasks.get(taskId);
		if (!task) {
			deps.onChange();
			return;
		}
		const ordered = listTasks();
		const idx = ordered.findIndex(t => t.id === taskId);
		if (task.sessionId) {
			deps.attachedSessionIds.delete(task.sessionId);
			pendingTitleBySession.delete(task.sessionId);
			deps.seqBySession.delete(task.sessionId);
		}
		tasks.delete(taskId);
		deps.forgetTask(taskId);

		if (deps.getActiveTaskId() === taskId) {
			const remaining = listTasks();
			const next =
				(idx >= 0 && idx < remaining.length ? remaining[idx] : undefined) ??
				(idx > 0 ? remaining[idx - 1] : undefined) ??
				remaining[0] ??
				listChats()[0];
			if (next) {
				deps.selectTask(next.id);
			} else {
				deps.setActiveTaskId(null);
			}
		}
		deps.onChange();
	};

	/** Monotonic listOrder so each create stays newest-first and never collides. */
	const nextListOrder = (): number => {
		let n = deps.now();
		for (const t of tasks.values()) {
			if (t.listOrder >= n) n = t.listOrder + 1;
		}
		return n;
	};

	const createEntry = (title: string, kind: 'task' | 'chat'): T => {
		const id = deps.createId();
		const listOrder = nextListOrder();
		const task = deps.buildEntry(id, kind, title, listOrder);
		tasks.set(id, task);
		deps.setActiveTaskId(id);
		const projectId = deps.projectId();
		if (projectId) {
			task.createRequested = true;
			tasks.set(id, task);
			sendCreateSession(projectId, title, id);
		} else {
			// Meta project id not stamped yet — ask Hub to ensure Meta + slot, then retry.
			deps.requestRegister();
		}
		return task;
	};

	/**
	 * CreateSession payload. Path-hash on `workspaceId` is Slot bind only — Engine
	 * `splitCreateWorkspace` never forwards hosted/boot hashes to Meta as UUID.
	 * When Slot is live this skips GetWorkspaceMeta in adoptCreatedSession.
	 */
	const sendCreateSession = (projectId: string, title: string, taskId: string): boolean => {
		const workspaceId = deps.workspaceId()?.replace(/^workspace:/, '').trim();
		const engineKind = tasks.get(taskId)?.engineKind;
		return deps.send({
			type: 'CreateSession',
			projectId,
			title,
			taskId,
			...(workspaceId ? {workspaceId} : {}),
			...(engineKind === 'dsh' ? {engineKind: 'dsh'} : {})
		});
	};

	/**
	 * Sole SessionBind authority: CreateSession / NewSession command_result.
	 * `taskId` must match the local optimistic Task row exactly.
	 * When Engine already bound to the project path-hash, Attach only — Bind would
	 * re-run ensureCodingProjectFull + Meta + ensureAsync on every New Task.
	 */
	const acceptNewSession = (sessionId: string, taskId: string, engineBoundHash?: string): T | null => {
		const pending = tasks.get(taskId);
		if (!pending?.pendingNew || pending.sessionId) return null;
		const workspaceId = deps.workspaceId()?.replace(/^workspace:/, '').trim();
		const bound = engineBoundHash?.replace(/^workspace:/, '').trim() || undefined;
		if (workspaceId && bound && workspaceId === bound) {
			// adoptCreatedSession already pinned — Attach restores for Thin Client.
		} else if (workspaceId) {
			// Slot known but Engine bind hash missing/mismatch — Bind before Attach.
			deps.send({
				type: 'BindSessionWorkspace',
				sessionId,
				workspaceId
			});
		} else {
			deps.requestRegister();
		}
		deps.requestAttach(pending, sessionId, 0);
		return pending;
	};

	/** Drop unbound optimistic create; optionally by taskId, else the sole unbound pending. */
	const failPendingCreate = (taskId?: string): boolean => {
		const target =
			taskId != null
				? tasks.get(taskId)
				: [...tasks.values()].find(t => t.pendingNew && !t.sessionId);
		if (!target?.pendingNew || target.sessionId) return false;
		tasks.delete(target.id);
		if (deps.getActiveTaskId() === target.id) {
			const next = listTasks()[0] ?? listChats()[0];
			deps.setActiveTaskId(next?.id ?? null);
		}
		deps.onChange();
		return true;
	};

	/** Re-send CreateSession for a pending create once projectId is known. */
	const retryPendingNew = (): boolean => {
		const task = deps.getActiveTask();
		const projectId = deps.projectId();
		// Skip if CreateSession already in flight — duplicate accepted results were
		// misreported as「创建失败」while the first bind already served chat.
		if (!task?.pendingNew || task.sessionId || !projectId || task.createRequested) return false;
		task.createRequested = true;
		tasks.set(task.id, task);
		return sendCreateSession(projectId, task.title, task.id);
	};

	/** Stage the active chrome engineKind as the revert value for a SetEngineKind send. */
	const stageEngineChange = (sessionId: string, engineKind: EngineKind): void => {
		pendingEngineBySession.set(sessionId, engineKind);
	};

	const rejectPendingDeletes = (notice: string): void => {
		for (const pending of pendingDeleteBySession.values()) {
			clearTimeout(pending.timer);
			pending.resolve({ok: false, notice});
		}
		pendingDeleteBySession.clear();
	};

	/**
	 * Settle optimistic task writes for command_result events:
	 * UpdateSessionStatus (delete), SetSessionTitle (rename), SetEngineKind.
	 * Returns stop=true with the touched task (or active) when the event was consumed.
	 */
	const handleCommandResult = (
		event: BridgeEvent
	): {stop: true; task: T | null} | {stop: false} => {
		if (event.type === 'command_result' && event.name === 'UpdateSessionStatus') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			if (sid && pendingDeleteBySession.has(sid)) {
				if (event.status === 'error') {
					settleDelete(sid, {ok: false, notice: event.message ?? 'Delete failed'});
				} else {
					settleDelete(sid, {ok: true});
				}
				return {stop: true, task: deps.getActiveTask()};
			}
			return {stop: true, task: deps.getActiveTask()};
		}

		if (event.type === 'command_result' && event.name === 'SetSessionTitle') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			if (sid) {
				const pending = pendingTitleBySession.get(sid);
				const task =
					(pending ? tasks.get(pending.taskId) : null) ?? deps.taskBySessionId(sid) ?? null;
				if (task) {
					if (event.status === 'error' && pending) {
						task.title = pending.previous;
						deps.setHelpNotice(event.message ?? 'errors.session.rename_failed');
						tasks.set(task.id, task);
					} else if (event.status !== 'error') {
						if (pending) task.autoTitlePending = false;
						const resolvedTitle =
							'title' in event && typeof event.title === 'string' ? event.title.trim() : '';
						if (resolvedTitle) {
							task.title = resolvedTitle;
						}
						tasks.set(task.id, task);
					}
					pendingTitleBySession.delete(sid);
					deps.onChange();
					return {stop: true, task};
				}
				pendingTitleBySession.delete(sid);
			}
			return {stop: true, task: deps.getActiveTask()};
		}

		if (event.type === 'command_result' && event.name === 'SetEngineKind') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const pending = sid ? pendingEngineBySession.get(sid) : undefined;
			if (sid) pendingEngineBySession.delete(sid);
			const task = (sid ? deps.taskBySessionId(sid) : null) ?? deps.getActiveTask();
			if (event.status === 'rejected' || event.status === 'error') {
				if (pending != null && task) {
					task.engineKind = pending;
					tasks.set(task.id, task);
					if (deps.getActiveTask()?.id === task.id) deps.setActiveEngineKind(pending);
					deps.onChange();
				}
			} else if (task) {
				const k = parseEngineKind(event.message);
				task.engineKind = k;
				tasks.set(task.id, task);
				if (deps.getActiveTask()?.id === task.id) deps.setActiveEngineKind(k);
				deps.onChange();
			}
			return {stop: true, task: deps.getActiveTask()};
		}

		return {stop: false};
	};

	return {
		tasks,
		listTasks,
		listChats,
		nextListOrder,
		createTask,
		createChat,
		renameTask,
		deleteTask,
		acceptNewSession,
		failPendingCreate,
		retryPendingNew,
		applyDeletedTask,
		stageEngineChange,
		rejectPendingDeletes,
		handleCommandResult
	};
}
