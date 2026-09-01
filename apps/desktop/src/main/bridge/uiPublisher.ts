/**
 * UI Publisher — owns all renderer-bound publish policy (ADR-0005).
 * Dependencies: WorkspaceHub (read) + injected send. Electron window plumbing stays in the host.
 */
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {
	ComposerGate,
	TasksMeta,
	TasksSnapshot,
	TranscriptPatch,
	TranscriptTailPatch,
	UiSend,
	WorkspaceFocus
} from '@fast-ide/session-view';
import {concreteModelDisplay} from '../../shared/defaultModel.js';
import type {SystemNotifyPort} from '../notify/systemNotifier.js';
import type {WorkspaceHub} from './WorkspaceHub.js';
import type {TaskView} from './SessionController.js';
import {rerunErrorCode} from './SessionController.js';
import {
	CONTENT_PATCH_COALESCE_MS,
	classifyBridgeEventForUi,
	createCoalescedPublisher
} from './uiPublish.js';

export type IdleGate = ComposerGate;

export const IDLE_GATE: IdleGate = {
	runState: 'idle',
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};

export type UiPublisherDeps = {
	hub: WorkspaceHub;
	send: UiSend;
	/** OS notification sink (systemNotifier) — optional so node tests run bare. */
	notify?: SystemNotifyPort;
	coalesceMs?: number;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
};

function mapEntry(
	entry: {
		id: string;
		title: string;
		kind: 'task' | 'chat';
		sessionId: string | null;
		lastModified?: string;
	},
	activeId: string | null,
	taskRunState?: ((taskId: string) => 'running' | 'completed-unseen' | null) | null
) {
	const runState = taskRunState?.(entry.id) ?? null;
	return {
		id: entry.id,
		title: entry.title,
		kind: entry.kind,
		sessionId: entry.sessionId,
		active: activeId === entry.id,
		...(runState ? {runState} : {}),
		...(entry.lastModified ? {lastModified: entry.lastModified} : {})
	};
}

export function createUiPublisher(deps: UiPublisherDeps) {
	const {
		hub,
		send,
		notify,
		coalesceMs = CONTENT_PATCH_COALESCE_MS,
		setTimeoutFn = setTimeout,
		clearTimeoutFn = clearTimeout
	} = deps;

	function findTaskEntry(taskId: string): {id: string; title: string} | null {
		for (const snap of hub.listProjects()) {
			const hit = hub.getById(snap.id)?.sessions.listTasks().find(t => t.id === taskId);
			if (hit) return hit;
		}
		return null;
	}

	function findTaskEntryBySession(sessionId: string | undefined): {id: string; title: string} | null {
		if (!sessionId) return null;
		for (const snap of hub.listProjects()) {
			const hit = hub.getById(snap.id)?.sessions.listTasks().find(t => t.sessionId === sessionId);
			if (hit) return hit;
		}
		return null;
	}

	type RevisionBody = {
		id: string;
		transcript: object;
		codeChanges: {entries: unknown};
		goalCard?: unknown;
	};
	type BodyRevision = {
		transcript: object;
		codeChanges: unknown;
		goalCard: unknown;
		revision: number;
	};
	const bodyRevisions = new Map<string, BodyRevision>();
	let nextBodyRevision = 1;

	/**
	 * Cheap host-side freshness token: all body projections obey immutable
	 * reference discipline. The renderer can compare this token on slim focus
	 * without serializing the full Transcript on every Task click.
	 */
	function bodyRevision(active: RevisionBody): number {
		const previous = bodyRevisions.get(active.id);
		if (
			previous &&
			previous.transcript === active.transcript &&
			previous.codeChanges === active.codeChanges.entries &&
			previous.goalCard === active.goalCard
		) {
			bodyRevisions.delete(active.id);
			bodyRevisions.set(active.id, previous);
			return previous.revision;
		}
		const record = {
			transcript: active.transcript,
			codeChanges: active.codeChanges.entries,
			goalCard: active.goalCard,
			revision: nextBodyRevision++
		};
		bodyRevisions.delete(active.id);
		bodyRevisions.set(active.id, record);
		if (bodyRevisions.size > 32) {
			const oldest = bodyRevisions.keys().next().value;
			if (oldest !== undefined) bodyRevisions.delete(oldest);
		}
		return record.revision;
	}

	function buildDefaultTaskList() {
		const view: TaskView | null = hub.getDefaultProject()?.sessions ?? null;
		if (!view) return [];
		const activeId = view.getActiveTask()?.id ?? null;
		const taskRunStateFn = view.taskRunState?.bind(view) ?? null;
		return view.listTasks().map(t => mapEntry(t, activeId, taskRunStateFn));
	}

	function buildDefaultTasksHydrated(): boolean {
		return hub.getDefaultProject()?.sessions.tasksHydrated ?? false;
	}

	function buildProjectTaskLists(): Record<
		string,
		Array<{
			id: string;
			title: string;
			kind: 'task' | 'chat';
			sessionId: string | null;
			active: boolean;
			lastModified?: string;
		}>
	> {
		const lists: Record<
			string,
			Array<{
				id: string;
				title: string;
				kind: 'task' | 'chat';
				sessionId: string | null;
				active: boolean;
				lastModified?: string;
			}>
		> = {};
		for (const snap of hub.listProjects()) {
			const view: TaskView | null = hub.getById(snap.id)?.sessions ?? null;
			if (!view) continue;
			const activeId = view.getActiveTask()?.id ?? null;
			const taskRunStateFn = view.taskRunState?.bind(view) ?? null;
			lists[snap.id] = view.listTasks().map(t => mapEntry(t, activeId, taskRunStateFn));
		}
		return lists;
	}

	function buildProjectTasksHydrated(): Record<string, boolean> {
		const flags: Record<string, boolean> = {};
		for (const snap of hub.listProjects()) {
			const view = hub.getById(snap.id)?.sessions ?? null;
			flags[snap.id] = view?.tasksHydrated ?? false;
		}
		return flags;
	}

	function stickyChrome(sessions: TaskView | null) {
		const model = sessions?.model ?? 'default';
		const raw = sessions?.modelDisplay ?? '';
		const catalogCurrent = sessions?.modelCatalog?.find(e => e.current);
		const resolved = concreteModelDisplay(model, raw);
		return {
			model,
			modelDisplay: resolved || catalogCurrent?.display || catalogCurrent?.id || '',
			modelCatalog: sessions?.modelCatalog ?? [],
			runMode: sessions?.runMode ?? ('agent' as const),
			engineKind: sessions?.engineKind ?? ('fast' as const),
			availableEngineIds: sessions?.availableEngineIds() ?? ['fast'],
			...(sessions?.effort ? {effort: sessions.effort} : {}),
			...(sessions?.thinking !== undefined ? {thinking: sessions.thinking} : {}),
			slashCatalog: sessions?.slashCatalog ?? [],
			slashCatalogHydrated: sessions?.slashCatalogHydrated ?? false
		};
	}

	function buildTasksMeta(): TasksMeta {
		const sessions: TaskView | null = hub.getActive()?.sessions ?? null;
		const active = sessions?.getActiveTask() ?? null;
		const activeId = active?.id ?? null;
		const taskRunStateFn = sessions?.taskRunState?.bind(sessions) ?? null;
		const engine = hub.getEngineStatus();
		const gate = sessions?.gate() ?? IDLE_GATE;
		return {
			tasks: sessions?.listTasks().map(t => mapEntry(t, activeId, taskRunStateFn)) ?? [],
			chats: sessions?.listChats().map(t => mapEntry(t, activeId, taskRunStateFn)) ?? [],
			defaultTasks: buildDefaultTaskList(),
			defaultTasksHydrated: buildDefaultTasksHydrated(),
			activeTaskId: activeId,
			activeKind: active?.kind ?? null,
			gate,
			...stickyChrome(sessions),
			queue: active?.queue ?? [],
			queuePaused: active?.queuePaused ?? false,
			dshCaps: active?.dshCaps,
			dshQueue: active?.dshQueue ?? [],
			dshGoal: active?.dshGoal ?? null,
			engineStatus: engine.status,
			engineError: engine.error ?? null
		};
	}

	/** Cold-start invoke `task:list` — meta + active Transcript body. */
	function buildTasksSnapshot(): TasksSnapshot {
		const sessions: TaskView | null = hub.getActive()?.sessions ?? null;
		const active = sessions?.getActiveTask() ?? null;
		return {
			...buildTasksMeta(),
			...(active ? {bodyRevision: bodyRevision(active)} : {}),
			transcript: active?.transcript.entries ?? [],
			approvals: active?.transcript.approvals ?? [],
			questions: active?.transcript.questions ?? [],
			questionBatches: active?.transcript.questionBatches ?? [],
			subagents: active?.transcript.subagents ?? [],
			superseded: active?.transcript.superseded ?? {},
			codeChanges: active?.codeChanges.entries ?? [],
			liveProcs: active?.transcript.liveProcs ?? [],
			liveTasks: active?.transcript.liveTasks ?? [],
			childWork: active?.transcript.childWork ?? [],
			goalFlow: active?.transcript.goalFlow,
			goalCard: active?.goalCard ?? null
		};
	}

	function buildTranscriptPatch(): TranscriptPatch | null {
		const sessions: TaskView | null = hub.getActive()?.sessions ?? null;
		const active = sessions?.getActiveTask() ?? null;
		if (!active || !sessions) return null;
		return {
			taskId: active.id,
			bodyRevision: bodyRevision(active),
			entries: active.transcript.entries,
			approvals: active.transcript.approvals,
			questions: active.transcript.questions,
			questionBatches: active.transcript.questionBatches,
			subagents: active.transcript.subagents,
			superseded: active.transcript.superseded ?? {},
			codeChanges: active.codeChanges.entries,
			liveProcs: active.transcript.liveProcs ?? [],
			liveTasks: active.transcript.liveTasks ?? [],
			childWork: active.transcript.childWork ?? [],
			goalFlow: active.transcript.goalFlow,
			goalCard: active.goalCard ?? null,
			gate: sessions.gate()
		};
	}

	/**
	 * Last body references pushed to the renderer, per task (perf doc P0-1).
	 * Projection is immutable, so shared prefixes keep reference identity and the
	 * changed suffix is found by pointer comparison — no deep diffing.
	 * LRU-capped: deleted/idle tasks must not pin their entry arrays forever.
	 */
	const lastPushedBody = new Map<string, TranscriptPatch>();
	const LAST_PUSHED_MAX = 32;

	function recordPushedBody(patch: TranscriptPatch): void {
		lastPushedBody.delete(patch.taskId);
		lastPushedBody.set(patch.taskId, patch);
		if (lastPushedBody.size > LAST_PUSHED_MAX) {
			const oldest = lastPushedBody.keys().next().value;
			if (oldest !== undefined) lastPushedBody.delete(oldest);
		}
	}

	function publishTranscriptPatch(): void {
		const patch = buildTranscriptPatch();
		if (!patch) return;
		send('transcript:patched', patch);
		recordPushedBody(patch);
	}

	/** Perf harness (message-flow-performance.md 刀 1): per-flush timing + payload bytes. */
	const flowTrace = process.env.FLOW_PERF_TRACE === '1';

	/** Content flush: send only the changed entry tail + changed sections. */
	function publishTranscriptTail(): void {
		const t0 = flowTrace ? performance.now() : 0;
		const patch = buildTranscriptPatch();
		if (!patch) return;
		const prev = lastPushedBody.get(patch.taskId);
		if (!prev) {
			send('transcript:patched', patch);
			recordPushedBody(patch);
			return;
		}

		const entries = patch.entries;
		const before = prev.entries;
		let from = 0;
		const shared = Math.min(entries.length, before.length);
		while (from < shared && entries[from] === before[from]) from += 1;
		const entriesChanged = from < entries.length || entries.length !== before.length;

		const tail: TranscriptTailPatch = {
			taskId: patch.taskId,
			bodyRevision: patch.bodyRevision,
			from,
			total: entries.length,
			entries: entries.slice(from),
			gate: patch.gate,
			...(patch.approvals !== prev.approvals ? {approvals: patch.approvals} : {}),
			...(patch.questions !== prev.questions ? {questions: patch.questions} : {}),
			...(patch.questionBatches !== prev.questionBatches ? {questionBatches: patch.questionBatches} : {}),
			...(patch.subagents !== prev.subagents ? {subagents: patch.subagents} : {}),
			...(patch.codeChanges !== prev.codeChanges ? {codeChanges: patch.codeChanges} : {}),
			...(patch.liveProcs !== prev.liveProcs ? {liveProcs: patch.liveProcs} : {}),
			...(patch.liveTasks !== prev.liveTasks ? {liveTasks: patch.liveTasks} : {}),
			...(patch.childWork !== prev.childWork ? {childWork: patch.childWork} : {}),
			...(patch.goalFlow !== prev.goalFlow ? {goalFlow: patch.goalFlow} : {}),
			...(patch.goalCard !== prev.goalCard ? {goalCard: patch.goalCard} : {})
		};
		const sectionsChanged =
			tail.approvals !== undefined ||
			tail.questions !== undefined ||
			tail.questionBatches !== undefined ||
			tail.subagents !== undefined ||
			tail.codeChanges !== undefined ||
			tail.liveProcs !== undefined ||
			tail.liveTasks !== undefined ||
			tail.childWork !== undefined ||
			tail.goalFlow !== undefined ||
			tail.goalCard !== undefined;
		if (!entriesChanged && !sectionsChanged) return;

		send('transcript:tailPatched', tail);
		recordPushedBody(patch);
		if (flowTrace) {
			const ms = (performance.now() - t0).toFixed(2);
			console.debug(`[flow-perf] tailPatched from=${tail.from} ${JSON.stringify(tail).length}B in ${ms}ms`);
		}
	}

	const contentPatchPublisher = createCoalescedPublisher(
		coalesceMs,
		publishTranscriptTail,
		setTimeoutFn,
		clearTimeoutFn
	);

	function buildProjectState() {
		const activeProject = hub.getActive();
		if (!activeProject) return null;
		return {
			id: activeProject.id,
			path: activeProject.path,
			status: activeProject.status,
			error: activeProject.error,
			cwd: activeProject.cwd ?? activeProject.path,
			displayName: activeProject.displayName?.trim() || undefined,
			workspaceId: activeProject.workspaceId ?? null
		};
	}

	/**
	 * Structural publish only (lists / engine). Does **not** set renderer focus —
	 * use `publishFocusChange` whenever hub active Project/Task should drive selection.
	 */
	function publishWorkspace(): void {
		contentPatchPublisher.cancel();
		publishTranscriptPatch();

		const projects = hub.listProjects();
		const activeProject = hub.getActive();
		const engine = hub.getEngineStatus();

		send('projects:changed', {
			projects,
			activeProjectId: activeProject?.id ?? null,
			projectTasks: buildProjectTaskLists(),
			projectTasksHydrated: buildProjectTasksHydrated(),
			engineStatus: engine.status,
			engineError: engine.error ?? null
		});

		send('project:changed', buildProjectState());
		send('tasks:changed', buildTasksMeta());
	}

	/**
	 * Active-task chrome only (gate / queue / catalogs). No projects list rebuild,
	 * no transcript flush. Use after send/enqueue — Bridge stream drives body.
	 */
	function publishTasksMeta(): void {
		send('tasks:changed', buildTasksMeta());
	}

	/** Shared with renderer optimistic focus; drop stale select publishes. */
	let focusEpoch = 0;

	/**
	 * Focus Change: single `workspace:focus` (chrome + active Task body, no projectTasks).
	 * @param epoch Renderer optimistic epoch; omit to bump. Returns null if stale.
	 */
	function publishFocusChange(
		epoch?: number
	): {focusEpoch: number; publishMs: number; focusPayloadBytes: number} | null {
		const t0 = performance.now();
		if (epoch !== undefined) {
			if (epoch < focusEpoch) return null;
			focusEpoch = epoch;
		} else {
			focusEpoch += 1;
		}

		contentPatchPublisher.cancel();

		const projects = hub.listProjects();
		const activeProject = hub.getActive();
		const engine = hub.getEngineStatus();
		const sessions: TaskView | null = activeProject?.sessions ?? null;
		const active = sessions?.getActiveTask() ?? null;
		const activeId = active?.id ?? null;
		const gate = sessions?.gate() ?? IDLE_GATE;

		// Slim focus (perf doc P1-6): no Transcript body — the renderer keeps its
		// per-task cache; cold bodies arrive via `task:list` pull or the next
		// transcript patch. Serializing full bodies here blocked the main event
		// loop 20-50ms per switch on long sessions.
		const payload: WorkspaceFocus = {
			focusEpoch,
			projects,
			activeProjectId: activeProject?.id ?? null,
			project: buildProjectState(),
			engineStatus: engine.status,
			engineError: engine.error ?? null,
			tasks: sessions?.listTasks().map(t => mapEntry(t, activeId)) ?? [],
			chats: sessions?.listChats().map(t => mapEntry(t, activeId)) ?? [],
			defaultTasks: buildDefaultTaskList(),
			defaultTasksHydrated: buildDefaultTasksHydrated(),
			activeTaskId: activeId,
			...(active ? {bodyRevision: bodyRevision(active)} : {}),
			activeKind: active?.kind ?? null,
			gate,
			...stickyChrome(sessions),
			queue: active?.queue ?? [],
			queuePaused: active?.queuePaused ?? false,
			dshCaps: active?.dshCaps,
			dshQueue: active?.dshQueue ?? [],
			dshGoal: active?.dshGoal ?? null,
			// Host truth: goal_updated for background tasks never reaches the renderer cache.
			goalCard: active?.goalCard ?? null
		};
		let focusPayloadBytes = 0;
		try {
			focusPayloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
		} catch {
			focusPayloadBytes = -1;
		}
		send('workspace:focus', payload);
		// Preserve a valid diff baseline. If this Task changed while unfocused,
		// the renderer sees the revision mismatch and pulls a full body; the next
		// streamed event must also heal with a full patch rather than a stale tail.
		if (
			activeId &&
			lastPushedBody.get(activeId)?.bodyRevision !== payload.bodyRevision
		) {
			lastPushedBody.delete(activeId);
		}
		return {
			focusEpoch,
			publishMs: Number((performance.now() - t0).toFixed(1)),
			focusPayloadBytes
		};
	}

	function currentFocusEpoch(): number {
		return focusEpoch;
	}

	/**
	 * Raw passthrough whitelist (perf doc P2-13): only event types a renderer
	 * surface actually subscribes to cross IPC — high-frequency deltas used to
	 * be cloned to the renderer for nothing. Consumers: DialogueComposer
	 * (mention_suggestions), TeamsWorkbench (goal_updated/task_updated),
	 * ScheduledJobsPane (child_work_changed/task_updated), review drawer
	 * (tree_advanced/review_changed).
	 */
	const RENDERER_EVENT_TYPES = new Set([
		'mention_suggestions',
		'goal_updated',
		'task_updated',
		'child_work_changed',
		// The drawer's list goes stale on every agent write batch and every undo; these say when.
		'tree_advanced',
		'review_changed',
		// Editor workspace FS — Document reload / conflict / Diff current refresh.
		'workspace_file_changed'
	]);

	/** Coalesce same-tick snapshot publishes (hydrate storms) into one (P2-13). */
	let workspacePublishQueued = false;
	function schedulePublishWorkspace(): void {
		if (workspacePublishQueued) return;
		workspacePublishQueued = true;
		queueMicrotask(() => {
			workspacePublishQueued = false;
			publishWorkspace();
		});
	}

	function handleEvent(projectId: string, event: BridgeEvent): void {
		if (RENDERER_EVENT_TYPES.has(event.type)) {
			send('bridge:event', {projectId, event});
		}

		// D10 regenerate rollback: a RerunRun rejection must reach the renderer as
		// bridge:error with a stable code so the optimistic hide rolls back and
		// the sticky banner explains why (SessionController paints the transcript
		// entry separately).
		if (
			event.type === 'command_result' &&
			event.name === 'RerunRun' &&
			(event.status === 'rejected' || event.status === 'error')
		) {
			handleError(projectId, '', {code: rerunErrorCode(event.message)});
		}

		const project = projectId === 'engine' ? hub.getActive() : hub.getById(projectId);
		const cue = project?.sessions.consumeCompletionCue() ?? null;
		if (cue) {
			send('completion:cue', cue);
			notify?.notify({
				kind: 'turn_finished',
				taskId: cue.taskId,
				taskTitle: findTaskEntry(cue.taskId)?.title ?? null,
				success: cue.success
			});
		}
		// Approvals may land on background projects — check before the active-project gate.
		if (event.type === 'approval_requested') {
			const entry = findTaskEntryBySession(event.sessionId);
			notify?.notify({
				kind: 'approval',
				taskId: entry?.id ?? null,
				taskTitle: entry?.title ?? null,
				detail: event.description || event.tool
			});
		}

		if (hub.getActive()?.id !== projectId && event.type !== 'ready' && projectId !== 'engine') {
			return;
		}

		const kind = classifyBridgeEventForUi(event.type);
		if (kind === 'none') return;
		if (kind === 'content') {
			contentPatchPublisher.schedule();
			return;
		}
		schedulePublishWorkspace();
	}

	function handleError(
		projectId: string,
		message: string,
		meta?: {code?: string; params?: Record<string, string | number>}
	): void {
		send('bridge:error', {
			projectId,
			message,
			...(meta?.code ? {code: meta.code} : {}),
			...(meta?.params ? {params: meta.params} : {})
		});
		publishWorkspace();
	}

	function handleLog(projectId: string, message: string): void {
		send('bridge:log', {projectId, message});
	}

	function handleExit(
		projectId: string,
		code: number | null,
		signal: NodeJS.Signals | null
	): void {
		send('bridge:exit', {projectId, code, signal});
		publishWorkspace();
	}

	return {
		handleEvent,
		handleError,
		handleLog,
		handleExit,
		publishWorkspace,
		schedulePublishWorkspace,
		publishTasksMeta,
		publishFocusChange,
		currentFocusEpoch,
		buildTasksMeta,
		buildTasksSnapshot,
		buildProjectTaskLists,
		buildProjectTasksHydrated,
		/** @deprecated Prefer buildTasksSnapshot / buildTasksMeta. */
		buildTasksPayload: buildTasksSnapshot,
		/** Test / diagnostics: whether a content coalesce is pending. */
		contentPatchPending: () => contentPatchPublisher.pending(),
		flushContentPatchNow: () => contentPatchPublisher.flushNow()
	};
}

export type UiPublisher = ReturnType<typeof createUiPublisher>;
