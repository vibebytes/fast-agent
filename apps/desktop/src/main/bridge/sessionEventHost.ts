import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import type {SessionListInfo} from './sessionContracts.js';
import {
	applyBridgeEvent,
	applyCodeChangeEvent,
	composerGate,
	createComposerSend,
	createSessionAttachStore,
	createTaskLifecycle,
	dshGoalFromEvent,
	emptySessionSeq,
	followUpQueueFrom,
	goalKeepsBusy,
	offer,
	paintAwaitingConfirm,
	resolveEventTask,
	seqTerminal,
	settleAttachedEvent,
	shouldSoundOnSettle,
	type CompletionCue,
	type SessionSeq
} from '@fast-ide/session-view';
import {isSessionStreamEvent, sessionIdFromEvent} from './sessionEvents.js';
import type {TaskRecord} from './sessionContracts.js';
import type {createSessionGoal} from './sessionGoal.js';
import type {createSessionModelSettings} from './sessionModelSettings.js';
import type {createSessionSlashCatalog} from './sessionSlashCatalog.js';

type GoalModule = ReturnType<typeof createSessionGoal>;
type ModelModule = ReturnType<typeof createSessionModelSettings>;
type SlashModule = ReturnType<typeof createSessionSlashCatalog>;
type ComposerModule = ReturnType<typeof createComposerSend<TaskRecord>>;
type LifecycleModule = ReturnType<typeof createTaskLifecycle<TaskRecord>>;
type AttachModule = ReturnType<typeof createSessionAttachStore>;

export interface SessionEventHostDeps {
	getActiveTask(): TaskRecord | null;
	taskBySessionId(sessionId: string): TaskRecord | null;
	tasks: Map<string, TaskRecord>;
	onChange(): void;
	createId(): string;
	send(command: BridgeCommand): boolean;
	clientId: () => string;
	seqBySession: Map<string, SessionSeq>;
	titleGenRequested: Set<string>;
	setHelpNotice(notice: string | null): void;
	lifecycle: LifecycleModule;
	composer: ComposerModule;
	attach: AttachModule;
	commands: {clearHistoryInFlight(sessionId: string): void};
	leaseWatch: {
		syncCancelSettle(task: TaskRecord): void;
		noteRunLease(task: TaskRecord, event: BridgeEvent): void;
	};
	model: ModelModule;
	slash: SlashModule;
	goal: GoalModule;
	requestAttach(task: TaskRecord, sessionId: string, lastEventSeq?: number): boolean;
	hydrateFromSessionsList(sessions: SessionListInfo[]): void;
}

/**
 * K19: event orchestration — host-level sinks first, then session stream
 * projection. Controller forwards `handleEvent` here and nothing else.
 */
export function createSessionEventHost(deps: SessionEventHostDeps) {
	let pendingCompletionCue: CompletionCue | null = null;

	function consumeCompletionCue(): CompletionCue | null {
		const cue = pendingCompletionCue;
		pendingCompletionCue = null;
		return cue;
	}

	function offerCompletionCue(
		task: TaskRecord,
		kind: 'turn_finished' | 'goal_finished',
		wasBusy: boolean,
		success: boolean
	): void {
		const gate = composerGate(task.transcript, true);
		if (
			!shouldSoundOnSettle({
				kind,
				wasBusy,
				runState: gate.runState,
				composerLocked: gate.composerLocked,
				queueLength: task.queue.length,
				queuePaused: task.queuePaused,
				goalBusy: goalKeepsBusy(task.goalCard)
			})
		) {
			return;
		}
		pendingCompletionCue = {taskId: task.id, success};
	}

	/** E4: task.queue is a read-through of Session follow_up_changed. */
	function applyFollowUpProjection(
		task: TaskRecord,
		paused: boolean,
		itemsJson: string,
		notice?: string
	): void {
		task.queuePaused = paused;
		if (notice?.trim()) deps.setHelpNotice(notice.trim());
		task.queue = followUpQueueFrom(itemsJson);
	}

	/**
	 * Route by event sessionId → TaskRecord.
	 * Host-level events (no sessionId) fall back to active.
	 * session_restored / history with an unknown sessionId must not paint onto the
	 * focused pending New task (multi-task / cross-project isolation).
	 */
	function resolveTaskForEvent(
		event: BridgeEvent,
		eventSession: string | undefined
	): TaskRecord | null {
		return resolveEventTask(event, eventSession, {
			findTaskBySession: sessionId => deps.taskBySessionId(sessionId),
			getActiveTask: () => deps.getActiveTask()
		});
	}

	/**
	 * Host-level / attach bookkeeping. Returns stop when the event must not continue
	 * into Transcript / Code Changes projection.
	 */
	function hostEvent(
		event: BridgeEvent
	): {stop: true; task: TaskRecord | null} | {stop: false} {
		const routed = deps.lifecycle.handleCommandResult(event);
		if (routed.stop) {
			return {stop: true, task: routed.task ?? deps.getActiveTask()};
		}

		if (event.type === 'input_accepted') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task = (sid ? deps.taskBySessionId(sid) : null) ?? deps.getActiveTask();
			// Clear sticky opt-in whenever present; drop pending only if still waiting.
			if (sid && deps.titleGenRequested.has(sid)) {
				deps.titleGenRequested.delete(sid);
				if (task?.autoTitlePending) {
					task.autoTitlePending = false;
					deps.tasks.set(task.id, task);
					deps.onChange();
				}
			}
			return {stop: false};
		}

		if (event.type === 'input_rejected') {
			const sid =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			// Drop sticky opt-in; autoTitlePending stays so the next successful send can retry.
			if (sid) deps.titleGenRequested.delete(sid);
			const reason =
				'reason' in event && typeof event.reason === 'string' && event.reason.trim()
					? event.reason.trim()
					: 'errors.build.rejected';
			if (deps.composer.pendingPlanBuildPlanId) {
				deps.composer.clearPendingPlanBuild();
				deps.setHelpNotice(reason);
			}
			// HITL lock is a send blocker, not a failed run. Painting the engine detail as
			// a second ErrorCard (next to the Transport card) is what "Retry did nothing
			// then composer_locked appeared" looks like.
			if (reason.includes('composer_locked')) {
				deps.setHelpNotice('errors.send.composer_locked');
				deps.onChange();
				return {stop: true, task: (sid ? deps.taskBySessionId(sid) : null) ?? deps.getActiveTask()};
			}
			const task = (sid ? deps.taskBySessionId(sid) : null) ?? deps.getActiveTask();
			if (task) {
				task.transcript = {
					...task.transcript,
					entries: [
						...task.transcript.entries,
						{
							id: deps.createId(),
							role: 'assistant',
							text: reason,
							status: 'error'
						}
					]
				};
				deps.tasks.set(task.id, task);
			}
			deps.onChange();
			return {stop: false};
		}

		if (event.type === 'ready') {
			// Catalog comes from ListProviders (Hub.applyProviderCatalog). Do not pull yaml `/model`
			// here — that dump races ListProviders and paints Settings-disabled yaml rows.
			deps.model.applyResolvedModel(event.model, event.modelDisplay);
		}

		if (event.type === 'sessions_list') {
			deps.hydrateFromSessionsList(event.sessions);
			return {stop: true, task: deps.getActiveTask()};
		}

		if (event.type === 'model_changed') {
			deps.model.applyModel(event.model, event.modelDisplay ?? event.model);
		}

		if (event.type === 'commands_available') {
			deps.slash.mergeCommandsAvailable(event.commands);
			return {stop: true, task: deps.getActiveTask()};
		}

		if (event.type === 'command_result' && event.name === 'model') {
			if (deps.model.modelCommandResult(event)) {
				return {stop: true, task: deps.getActiveTask()};
			}
		}

		if (event.type === 'command_result' && event.name === 'skills') {
			deps.composer.handleSkillsResult(event);
			return {stop: true, task: deps.getActiveTask()};
		}

		// Goal-card branches (push + Patch/Confirm/Cancel/Rerun results) — domain module.
		const goal = deps.goal.goalEvent(event);
		if (goal.stop) return goal;

		// SkillSlash / unknown slash failures arrive after task:send already returned —
		// paint into the owning Task (by sessionId) so the UI is never silently empty.
		if (
			event.type === 'command_result' &&
			event.status === 'error' &&
			event.message?.trim() &&
			(event.name === 'skill_view' ||
				event.message.includes('Unknown command:') ||
				event.message.includes('No active session') ||
				event.message.includes('Failed to persist skill_view') ||
				// Skill names are Bridge command names; host help/clear/model handled above.
				(typeof event.name === 'string' &&
					event.name.length > 0 &&
					!['skills', 'model', 'debug', 'sessions', 'history'].includes(event.name)))
		) {
			const eventSession =
				'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;
			const task =
				(eventSession ? deps.taskBySessionId(eventSession) : null) ?? deps.getActiveTask();
			// Drop sticky generateTitle opt-in (no input_accepted/rejected on this path).
			const sid = eventSession ?? task?.sessionId;
			if (sid) deps.titleGenRequested.delete(sid);
			if (task) {
				task.transcript = {
					...task.transcript,
					entries: [
						...task.transcript.entries,
						{
							id: deps.createId(),
							role: 'assistant',
							text: deps.slash.enrichSkillCommandError(event.name, event.message),
							status: 'error'
						}
					]
				};
				deps.tasks.set(task.id, task);
			}
			return {stop: true, task: task ?? deps.getActiveTask()};
		}

		if (event.type === 'Attached' && event.sessionId) {
			settleAttachedEvent(event, {
				attach: deps.attach,
				findTaskBySession: sessionId => deps.taskBySessionId(sessionId),
				getActiveTask: () => deps.getActiveTask(),
				settleTask: task => deps.tasks.set(task.id, task)
			});
			// Slash catalog: composer pulls on menu open — not on every Attached.
			// Model catalog: Hub ListProviders, not yaml `/model`.
		}

		return {stop: false};
	}

	function projectStream(event: BridgeEvent): TaskRecord | null {
		const eventSession = sessionIdFromEvent(event);
		const task = resolveTaskForEvent(event, eventSession);
		if (!task) return null;

		if (
			event.type === 'turn_started' &&
			'messageType' in event &&
			event.messageType === 'plan_build'
		) {
			deps.composer.clearPendingPlanBuild();
		}

		if (event.type === 'dsh_caps') {
			task.dshCaps = {
				queue: event.queue,
				goal: event.goal,
				budget: event.budget,
				question: event.question,
				slash: event.slash
			};
			deps.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'dsh_queue') {
			task.dshQueue = event.items;
			deps.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'dsh_goal_changed') {
			task.dshGoal = dshGoalFromEvent(event);
			deps.tasks.set(task.id, task);
			return task;
		}

		if (event.type === 'follow_up_changed') {
			applyFollowUpProjection(
				task,
				event.paused,
				event.itemsJson,
				'notice' in event && typeof event.notice === 'string' ? event.notice : undefined
			);
			deps.tasks.set(task.id, task);
			return task;
		}

		if (isSessionStreamEvent(event.type)) {
			if (!eventSession) {
				// Defense in depth: never paint unsigned stream onto a Task.
				return task;
			}
			// Live stream only for Sessions we keep attached (multi-Attach).
			if (!deps.attach.isAttached(eventSession)) {
				return task;
			}
		}

		const seqSession = task.sessionId ?? eventSession;
		const wasBusy = composerGate(task.transcript, false).runState !== 'idle';
		if (seqSession) {
			const before = deps.seqBySession.get(seqSession) ?? {
				...emptySessionSeq(),
				lastApplied: task.lastEventSeq
			};
			const result = offer(before, event, {terminal: seqTerminal(task.transcript)});
			deps.seqBySession.set(seqSession, result.state);
			if (result.state.lastApplied !== before.lastApplied) {
				task.lastEventSeq = result.state.lastApplied;
				deps.send({
					type: 'Ack',
					sessionId: seqSession,
					clientId: deps.clientId(),
					lastEventSeq: result.state.lastApplied
				});
			}
			for (const ev of result.emit) {
				task.transcript = applyBridgeEvent(task.transcript, ev);
				task.codeChanges = applyCodeChangeEvent(task.codeChanges, ev);
			}
			if (result.resync) deps.requestAttach(task, seqSession, result.state.lastApplied);
		} else {
			task.transcript = applyBridgeEvent(task.transcript, event);
			task.codeChanges = applyCodeChangeEvent(task.codeChanges, event);
		}
		if (event.type === 'session_restored' && eventSession) {
			deps.attach.markRestored(eventSession);
		}
		if (event.type === 'session_history_page') {
			deps.commands.clearHistoryInFlight(event.sessionId);
		}
		if (task.goalCard?.phase === 'awaiting_confirm') {
			task.transcript = paintAwaitingConfirm(task.transcript, task.goalCard);
		}
		deps.tasks.set(task.id, task);

		if (
			event.type === 'turn_finished' ||
			event.type === 'run_done' ||
			event.type === 'run_failed' ||
			event.type === 'run_exhausted'
		) {
			offerCompletionCue(
				task,
				'turn_finished',
				wasBusy,
				event.type === 'run_failed' || event.type === 'run_exhausted'
					? false
					: !('success' in event && event.success === false)
			);
		}

		deps.leaseWatch.syncCancelSettle(task);
		deps.leaseWatch.noteRunLease(task, event);

		return task;
	}

	function handleEvent(event: BridgeEvent): TaskRecord | null {
		const host = hostEvent(event);
		if (host.stop) return host.task;
		return projectStream(event);
	}

	return {handleEvent, hostEvent, projectStream, consumeCompletionCue, offerCompletionCue};
}
