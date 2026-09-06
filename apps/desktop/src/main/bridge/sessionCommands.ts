import type {BridgeCommand} from '@fastllm/bridge-protocol';
import {
	applyBridgeEvent,
	applyLocalCancel,
	chromeAwaitingSettlement,
	chromeRunId,
	goalKeepsBusy,
	oldestLoadedTurnId,
	queueClearCommands,
	queueEditCommands,
	queuePauseCommand,
	queueRemoveCommands,
	queueReorderCommands,
	queueSteerPlan
} from '@fast-ide/session-view';
import type {ComposerSampling, GoalCardView} from '@fast-ide/session-view';
import type {AnswerBatchPayload, TaskRecord} from './sessionContracts.js';

export interface SessionCommandsDeps {
	getActiveTask(): TaskRecord | null;
	taskBySessionId(sessionId: string): TaskRecord | null;
	isAttached(sessionId: string): boolean;
	send(command: BridgeCommand): boolean;
	createId(): string;
	setHelpNotice(notice: string): void;
	workspaceId(): string | undefined;
	settleTask(task: TaskRecord): void;
	onChange(): void;
	armCancelSettle(taskId: string): void;
	composerSampling(): ComposerSampling;
}

/** 用户意图 → BridgeCommand 组装（守卫→查找→组命令→发送），SessionController 只留委托。 */
export function createSessionCommands(deps: SessionCommandsDeps) {
	const activeAttached = () => {
		const task = deps.getActiveTask();
		if (!task?.sessionId || !deps.isAttached(task.sessionId)) return null;
		return {task, sessionId: task.sessionId};
	};

	const stageLocalCancel = (task: TaskRecord) => {
		task.transcript = applyLocalCancel(task.transcript);
		deps.settleTask(task);
		deps.armCancelSettle(task.id);
	};

	// ── HITL 决策 ──

	const decideApproval = (approvalId: string, approved: boolean, reason?: string): boolean => {
		const task = deps.getActiveTask();
		if (!task?.sessionId || !deps.isAttached(task.sessionId)) return false;
		const approval = task.transcript.approvals.find(a => a.id === approvalId);
		if (!approval) return false;
		return deps.send({
			type: 'DecideApproval',
			sessionId: task.sessionId,
			runId: approval.runId,
			approvalId,
			approved,
			reason
		});
	};

	const answerQuestion = (questionId: string, answer: string): boolean => {
		const task = deps.getActiveTask();
		if (!task?.sessionId || !deps.isAttached(task.sessionId)) return false;
		const question = task.transcript.questions.find(q => q.id === questionId);
		if (!question) return false;
		const trimmed = answer.trim();
		if (!trimmed) return false;
		const selectedOptionId = question.options.some(o => o.id === trimmed) ? trimmed : undefined;
		return deps.send({
			type: 'AnswerQuestion',
			sessionId: task.sessionId,
			runId: question.runId,
			questionId,
			...(selectedOptionId ? {selectedOptionId} : {customText: trimmed})
		});
	};

	const answerQuestionBatch = (rpcId: string, payload: AnswerBatchPayload): boolean => {
		const task = deps.getActiveTask();
		if (!task?.sessionId || !deps.isAttached(task.sessionId)) return false;
		const batch = task.transcript.questionBatches.find(q => q.rpcId === rpcId);
		if (!batch) return false;
		if ('cancelled' in payload && payload.cancelled) {
			return deps.send({
				type: 'AnswerQuestionBatch',
				sessionId: task.sessionId,
				rpcId,
				cancelled: true
			});
		}
		if (!('answers' in payload) || payload.answers.length === 0) return false;
		return deps.send({
			type: 'AnswerQuestionBatch',
			sessionId: task.sessionId,
			rpcId,
			answers: payload.answers
		});
	};

	// ── 队列 ──

	const removeQueueItem = (itemId: string): boolean => {
		const active = activeAttached();
		if (!active) return false;
		return queueRemoveCommands(active.task, active.sessionId, itemId)
			.map(cmd => deps.send(cmd))
			.some(ok => ok);
	};

	const clearQueue = (): boolean => {
		const active = activeAttached();
		if (!active) return false;
		return queueClearCommands(active.task, active.sessionId)
			.map(cmd => deps.send(cmd))
			.some(ok => ok);
	};

	const reorderQueue = (fromIndex: number, toIndex: number): boolean => {
		const active = activeAttached();
		if (!active) return false;
		const [cmd] = queueReorderCommands(active.task, active.sessionId, fromIndex, toIndex);
		return cmd ? deps.send(cmd) : false;
	};

	const editQueueItem = (itemId: string, text: string): boolean => {
		const active = activeAttached();
		if (!active) return false;
		const [cmd] = queueEditCommands(active.task, active.sessionId, itemId, text);
		return cmd ? deps.send(cmd) : false;
	};

	const setQueuePaused = (paused: boolean): boolean => {
		const active = activeAttached();
		if (!active) return false;
		return deps.send(queuePauseCommand(active.sessionId, paused));
	};

	// ── DSH 转向 ──

	const dshSteer = (text: string): boolean => {
		const active = activeAttached();
		if (!active) return false;
		if (!active.task.dshCaps?.queue) return false;
		const trimmed = text.trim();
		if (!trimmed) return false;
		return deps.send({type: 'Steer', sessionId: active.sessionId, text: trimmed});
	};

	const dshGoalAct = (action: 'pause' | 'resume' | 'complete' | 'clear'): boolean => {
		const active = activeAttached();
		if (!active) return false;
		if (!active.task.dshCaps?.goal) return false;
		const method =
			action === 'pause'
				? 'goal.pause'
				: action === 'resume'
					? 'goal.resume'
					: action === 'complete'
						? 'goal.complete'
						: 'goal.clear';
		return deps.send({type: 'Call', method, sessionId: active.sessionId, payload: {}});
	};

	const interruptQueueItem = (itemId: string): boolean => {
		const active = activeAttached();
		if (!active) return false;
		const plan = queueSteerPlan(active.task, itemId);
		if (!plan) return false;
		if (plan.kind === 'dsh') {
			return deps.send({type: 'Queue', sessionId: active.sessionId, itemId, action: 'steer'});
		}
		const streaming = active.task.transcript.entries.some(e => e.status === 'streaming');
		const runId = chromeRunId(active.task.transcript.chrome);
		if (runId || streaming || chromeAwaitingSettlement(active.task.transcript.chrome) || goalKeepsBusy(active.task.goalCard)) {
			stageLocalCancel(active.task);
		}
		return deps.send({
			type: 'InterruptWithMessage',
			sessionId: active.sessionId,
			text: plan.text,
			clientMessageId: deps.createId(),
			itemId,
			...deps.composerSampling()
		});
	};

	// ── 运行控制 ──

	const cancelRunForTask = (task: TaskRecord, reason: string): boolean => {
		if (!task.sessionId || !deps.isAttached(task.sessionId)) return false;
		const streaming = task.transcript.entries.some(e => e.status === 'streaming');
		const runId = chromeRunId(task.transcript.chrome);
		if (!runId && !streaming && !chromeAwaitingSettlement(task.transcript.chrome) && !goalKeepsBusy(task.goalCard)) {
			return false;
		}
		stageLocalCancel(task);
		return deps.send({type: 'CancelAssociated', sessionId: task.sessionId, reason});
	};

	const cancelRun = (reason = 'cancelled by user'): boolean => {
		const active = activeAttached();
		if (!active) return false;
		return cancelRunForTask(active.task, reason);
	};

	const killProc = (procId: string, reason = 'user_stopped', sessionId?: string): boolean => {
		const id = procId.trim();
		const sid = sessionId?.trim() || deps.getActiveTask()?.sessionId?.trim() || '';
		if (!id || !sid) return false;
		const ok = deps.send({type: 'KillProc', sessionId: sid, procId: id, reason});
		if (ok) {
			const task = deps.taskBySessionId(sid) ?? deps.getActiveTask();
			if (task) {
				task.transcript = applyBridgeEvent(task.transcript, {
					type: 'proc_updated',
					procId: id,
					status: 'killed',
					reason
				});
				deps.settleTask(task);
				deps.onChange();
			}
		}
		return ok;
	};

	// ── Goal 卡片动作（workspace 路由，单一人审门面） ──

	const activeGoalCard = (): {task: TaskRecord; card: GoalCardView} | null => {
		const task = deps.getActiveTask();
		if (!task?.goalCard) return null;
		return {task, card: task.goalCard};
	};

	const confirmGoal = (patchJson?: string): boolean => {
		const active = activeGoalCard();
		if (!active || active.card.phase !== 'awaiting_confirm') return false;
		return deps.send(
			patchJson
				? {type: 'ConfirmGoal', goalId: active.card.goalId, patchJson}
				: {type: 'ConfirmGoal', goalId: active.card.goalId}
		);
	};

	const pauseGoal = (goalId?: string): boolean => {
		const id = goalId?.trim() || activeGoalCard()?.card.goalId;
		if (!id) return false;
		if (!goalId?.trim()) {
			const phase = activeGoalCard()?.card.phase;
			if (phase !== 'started' && phase !== 'escalated') return false;
		}
		return deps.send({type: 'PauseGoal', goalId: id});
	};

	const cancelGoal = (goalId?: string): boolean => {
		const id = goalId?.trim() || activeGoalCard()?.card.goalId;
		if (!id) return false;
		return deps.send({type: 'CancelGoal', goalId: id});
	};

	const resumeGoal = (goalId?: string): boolean => {
		const id = goalId?.trim();
		if (id) return deps.send({type: 'ResumeGoal', goalId: id});
		const active = activeGoalCard();
		if (!active || active.card.phase !== 'paused') return false;
		return deps.send({type: 'ResumeGoal', goalId: active.card.goalId});
	};

	const steerGoal = (note: string, goalId?: string): boolean => {
		if (!note.trim()) return false;
		const id = goalId?.trim() || activeGoalCard()?.card.goalId;
		if (!id) return false;
		return deps.send({type: 'SteerGoal', goalId: id, note: note.trim()});
	};

	const escalateGoal = (action: 'resume' | 'fail'): boolean => {
		const active = activeGoalCard();
		if (!active || active.card.phase !== 'escalated') return false;
		return deps.send(
			action === 'resume'
				? {type: 'EscalateResume', goalId: active.card.goalId}
				: {type: 'EscalateFail', goalId: active.card.goalId}
		);
	};

	const dismissGoalCard = (): boolean => {
		const active = activeGoalCard();
		if (!active) return false;
		active.task.goalCard = undefined;
		active.task.transcript = {...active.task.transcript, goalFlow: undefined};
		deps.settleTask(active.task);
		deps.onChange();
		return true;
	};

	// ── 单发命令 ──

	const requestMentionSuggest = (prefix: string, requestId: string, kinds?: string[]): boolean => {
		const active = activeAttached();
		if (!active) return false;
		return deps.send({
			type: 'MentionSuggest',
			sessionId: active.sessionId,
			prefix,
			requestId,
			...(kinds && kinds.length > 0 ? {kinds} : {}),
			limit: 20
		});
	};

	const rerunRun = (runId: string): boolean => {
		const active = activeAttached();
		if (!active) {
			deps.setHelpNotice('errors.send.session_not_ready');
			return false;
		}
		return deps.send({type: 'RerunRun', sessionId: active.sessionId, runId});
	};

	let historyInFlight: string | null = null;
	const requestOlderHistory = (): boolean => {
		const active = activeAttached();
		if (!active) return false;
		if (!active.task.transcript.hasMoreOlder) return false;
		if (historyInFlight === active.sessionId) return false;
		const beforeTurnId = oldestLoadedTurnId(active.task.transcript);
		if (!beforeTurnId) return false;
		const ok = deps.send({
			type: 'FetchSessionHistory',
			sessionId: active.sessionId,
			beforeTurnId,
			limit: 20
		});
		if (ok) historyInFlight = active.sessionId;
		return ok;
	};
	const clearHistoryInFlight = (sessionId: string | undefined): void => {
		if (sessionId && historyInFlight === sessionId) historyInFlight = null;
	};

	const requestSessionsList = (): boolean => {
		const workspaceId = deps.workspaceId() ?? '';
		return deps.send({type: 'command', name: 'sessions', args: workspaceId});
	};

	return {
		decideApproval,
		answerQuestion,
		answerQuestionBatch,
		removeQueueItem,
		clearQueue,
		reorderQueue,
		editQueueItem,
		setQueuePaused,
		dshSteer,
		dshGoalAct,
		interruptQueueItem,
		cancelRunForTask,
		cancelRun,
		killProc,
		confirmGoal,
		pauseGoal,
		cancelGoal,
		resumeGoal,
		steerGoal,
		escalateGoal,
		dismissGoalCard,
		requestMentionSuggest,
		rerunRun,
		requestOlderHistory,
		clearHistoryInFlight,
		requestSessionsList
	};
}
