import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	applyGoalPush,
	chromePostRun,
	goalCardFromPush,
	goalConfirmStarted,
	goalKeepsBusy,
	goalPushClobbersConfirm,
	patchedGoalCard,
	runChromeTransition,
	startedGoalCardFromConfirm,
	type ComposerGate
} from '@fast-ide/session-view';
import type {HostEventSinkResult, TaskRecord} from './sessionContracts.js';

export type SessionGoalDeps = {
	getActiveTask: () => TaskRecord | null;
	taskBySessionId: (sessionId: string) => TaskRecord | null;
	settleTask: (task: TaskRecord) => void;
	onChange: () => void;
	createId: () => string;
	offerCue: (
		task: TaskRecord,
		kind: 'turn_finished' | 'goal_finished',
		wasBusy: boolean,
		success: boolean
	) => void;
};

const eventSessionId = (event: BridgeEvent): string | undefined =>
	'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined;

/** Goal track Busy A′: paint running chrome; allow composer submit as steer (not CancelRun). */
export function goalBusyGatePatch(task: TaskRecord, base: ComposerGate): ComposerGate {
	if (goalKeepsBusy(task.goalCard) && base.runState === 'idle' && !base.composerLocked) {
		return {
			...base,
			runState: 'running',
			canSubmitNow: true,
			canEnqueue: false,
			canCancel: false
		};
	}
	return base;
}

/** Lease expiry while a goal card is live — drop card + flow guard so the row can rest. */
export function goalLeaseCleanup(task: TaskRecord): void {
	if (!goalKeepsBusy(task.goalCard)) return;
	task.goalCard = undefined;
	task.transcript = {...task.transcript, goalFlow: undefined};
}

/** Host sink for goal-card events: push + Patch/Confirm/Cancel/RerunRun command results. */
export function createSessionGoal(deps: SessionGoalDeps) {
	const taskFor = (event: BridgeEvent): TaskRecord | null => {
		const sid = eventSessionId(event);
		return (sid ? deps.taskBySessionId(sid) : null) ?? deps.getActiveTask();
	};

	return {
		goalEvent(event: BridgeEvent): HostEventSinkResult {
			// ②′ card lifecycle push — the single source for confirm/busy/escalate/completion cards.
			if (event.type === 'goal_updated') {
				const task = taskFor(event);
				if (task && !goalPushClobbersConfirm(task.goalCard, event)) {
					const wasBusy = goalKeepsBusy(task.goalCard);
					const incoming = goalCardFromPush(event);
					task.goalCard = incoming;
					task.transcript = applyGoalPush(task.transcript, incoming, event.phase);
					deps.settleTask(task);
					if (event.phase === 'finished') {
						const failed =
							event.status === 'failed' ||
							event.status === 'cancelled' ||
							event.status === 'canceled';
						deps.offerCue(task, 'goal_finished', wasBusy, !failed);
					}
					deps.onChange();
				}
				return {stop: true, task: task ?? deps.getActiveTask()};
			}

			// PatchGoal result — canonical draft snapshot rides the reply (no live stream needed).
			if (event.type === 'command_result' && event.name === 'PatchGoal') {
				const task = taskFor(event);
				const g = event.goal;
				if (
					task &&
					event.status === 'accepted' &&
					g &&
					task.goalCard?.phase === 'awaiting_confirm' &&
					task.goalCard.goalId === g.id
				) {
					task.goalCard = patchedGoalCard(task.goalCard, g);
					deps.settleTask(task);
					deps.onChange();
				}
				return {stop: true, task: task ?? deps.getActiveTask()};
			}

			// ConfirmGoal / CancelGoal — paint outcome. Confirm must NOT drop the card: transition
			// awaiting_confirm → started from command_result.goal (watch can miss GoalUpdated(started)).
			if (
				event.type === 'command_result' &&
				(event.name === 'ConfirmGoal' || event.name === 'CancelGoal') &&
				event.message?.trim()
			) {
				const task = taskFor(event);
				if (task) {
					const ok = event.status === 'accepted' || event.status === 'success';
					if (event.name === 'CancelGoal') {
						// Success OR failure (goal already terminal / missing): the Stop affordance
						// is meaningless once the goal can no longer be cancelled. A late
						// GoalUpdated(finished) may never arrive, so don't leave the card stuck on
						// 'started' with a Stop button that always errors "cannot cancelled from status=…".
						task.goalCard = undefined;
						task.transcript = {...task.transcript, goalFlow: undefined};
					} else if (ok && event.name === 'ConfirmGoal') {
						if (goalConfirmStarted(event.goal, event.message)) {
							task.goalCard = startedGoalCardFromConfirm(task.goalCard, event.goal);
						} else if (task.goalCard?.phase === 'awaiting_confirm') {
							// Confirmed but startGoal failed — keep card so user can retry / cancel.
						}
					}
					task.transcript = {
						...task.transcript,
						// Confirm opens Goal track — do not keep the prior Chat turn's straggler guard.
						chrome: runChromeTransition(task.transcript.chrome, {postRun: !(ok && event.name === 'ConfirmGoal') && chromePostRun(task.transcript.chrome)}),
						entries: [
							...task.transcript.entries,
							{
								id: deps.createId(),
								role: 'assistant',
								text: event.message,
								status: ok ? 'done' : 'error'
							}
						]
					};
					deps.settleTask(task);
					deps.onChange();
				}
				return {stop: true, task: task ?? deps.getActiveTask()};
			}

			// RerunRun rejections (target active / session busy / stale target / unsupported)
			// arrive as command_result status='rejected'. They must NOT paint a transcript
			// error entry — that rendered a second "运行失败详情" card repeating the busy
			// text next to the real failure card. The renderer surfaces rejections via the
			// bridge:error code (sticky regen banner + optimistic-hide rollback) instead.
			if (event.type === 'command_result' && event.name === 'RerunRun') {
				return {stop: true, task: deps.getActiveTask()};
			}

			return {stop: false};
		}
	};
}
