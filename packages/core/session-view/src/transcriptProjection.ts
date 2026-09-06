import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {chromePostRun} from './runChrome.js';
import {entryMatchesKey} from './turnIdentity.js';
import {
	applyBackgroundTaskCompleted,
	applyBackgroundTaskOutput,
	applyChildWorkChanged,
	applyProcUpdated,
	applySubagentFinished,
	applySubagentStarted,
	applySubagentUpdated,
	applyTaskUpdated
} from './transcript/drawers.js';
import {
	applyAssistantDelta,
	applyCheckpointEvent,
	applyFinalAnswer,
	applyGap,
	applyLlmNetworkWait,
	applyReasoningDelta,
	fillsEmptyAssistant
} from './transcript/live.js';
import {applyMessagePatched, applyPlanBuildSubmitted} from './transcript/planPatch.js';
import {
	applyApprovalCleared,
	applyApprovalRequested,
	applyClarify,
	applyQuestionBatchRequested,
	applyQuestionBatchResolved,
	applyQuestionCleared,
	applyQuestionRequested
} from './transcript/prompts.js';
import {applySessionHistoryPage, applySessionRestored} from './transcript/restore.js';
import {applyRunState, applyRunTerminal} from './transcript/settle.js';
import type {TranscriptState} from './transcript/state.js';
import {
	applyAgentCallFinished,
	applyAgentCallStarted,
	applyDshToolCard,
	applyFileRead,
	applyToolFinished,
	applyToolOutput,
	applyToolStarted,
	eventGoalId
} from './transcript/tools.js';
import {
	applyError,
	applyInputAccepted,
	applyTurnCancelled,
	applyTurnFinished,
	applyTurnStarted
} from './transcript/turn.js';

export {
	appendProcPreview,
	createTranscriptState,
	LIVE_PROC_PREVIEW_MAX,
	nextFireAtFromDetail,
	oldestLoadedTurnId
} from './transcript/state.js';
export type {
	EntrySegment,
	GoalFlowMember,
	GoalFlowView,
	LiveChildWork,
	LiveProc,
	LiveTask,
	NetworkWaitState,
	PendingApproval,
	PendingQuestion,
	PendingQuestionBatch,
	QuestionBatchIntent,
	QuestionBatchItem,
	QuestionBatchOption,
	ToolCallView,
	TranscriptEntry,
	TranscriptState,
	TranscriptSubagent
} from './transcript/state.js';
export {applyLeaseExpiry, applyLocalCancel} from './transcript/settle.js';

const CONTENT_EVENTS = new Set([
	'reasoning_delta', 'assistant_delta', 'checkpoint', 'final_answer',
	'tool_started', 'tool_output', 'tool_finished', 'file_read',
	'agent_call_started', 'agent_call_finished'
]);

export function applyBridgeEvent(state: TranscriptState, event: BridgeEvent): TranscriptState {
	if (chromePostRun(state.chrome) && CONTENT_EVENTS.has(event.type)) {
		// L1 Goal agent_call still updates chat status after the Chat turn sealed.
		const gid = eventGoalId(event);
		const goalCall =
			(event.type === 'agent_call_started' || event.type === 'agent_call_finished') && gid;
		// Goal structured turns (step conclusion / outcome) finish via final_answer after seal.
		const goalSystemTurn =
			(event.type === 'final_answer' || event.type === 'turn_finished') &&
			typeof event.turnId === 'string' &&
			state.entries.some(
				e =>
					e.role === 'assistant' &&
					e.status === 'streaming' &&
					entryMatchesKey(e, event.turnId) &&
					(e.messageType === 'goal_step_conclusion' || e.messageType === 'goal_outcome')
			);
		// Settle can race ahead of the document (held deltas / late final_answer).
		// Fill empty prose without reopening the stream — restart restore already does this.
		if (!goalCall && !goalSystemTurn && !fillsEmptyAssistant(state, event)) {
			return state;
		}
	}

	switch (event.type) {
		case 'turn_started':
			return applyTurnStarted(state, event);
		case 'input_accepted':
			return applyInputAccepted(state, event);
		case 'session_restored':
			return applySessionRestored(state, event);
		case 'session_history_page':
			return applySessionHistoryPage(state, event);
		case 'llm_network_wait':
			return applyLlmNetworkWait(state, event);
		case 'reasoning_delta':
			return applyReasoningDelta(state, event);
		case 'assistant_delta':
			return applyAssistantDelta(state, event);
		case 'checkpoint':
			return applyCheckpointEvent(state, event);
		case 'gap':
			return applyGap(state);
		case 'final_answer':
			return applyFinalAnswer(state, event);
		case 'turn_finished':
			return applyTurnFinished(state, event);
		case 'turn_cancelled':
			return applyTurnCancelled(state);
		case 'error':
			return applyError(state, event);
		case 'dsh_tool_card':
			return applyDshToolCard(state, event);
		case 'tool_started':
			return applyToolStarted(state, event);
		case 'tool_output':
			return applyToolOutput(state, event);
		case 'tool_finished':
			return applyToolFinished(state, event);
		case 'agent_call_started':
			return applyAgentCallStarted(state, event);
		case 'agent_call_finished':
			return applyAgentCallFinished(state, event);
		case 'file_read':
			return applyFileRead(state, event);
		case 'approval_requested':
			return applyApprovalRequested(state, event);
		case 'approval_resolved':
		case 'approval_expired':
			return applyApprovalCleared(state, event);
		case 'question_requested':
			return applyQuestionRequested(state, event);
		case 'question_batch_requested':
			return applyQuestionBatchRequested(state, event);
		case 'question_batch_resolved':
			return applyQuestionBatchResolved(state, event);
		case 'subagent_started':
			return applySubagentStarted(state, event);
		case 'subagent_updated':
			return applySubagentUpdated(state, event);
		case 'subagent_finished':
			return applySubagentFinished(state, event);
		case 'question_answered':
		case 'clarify_resolved':
			return applyQuestionCleared(state, event);
		case 'clarify':
			return applyClarify(state, event);
		case 'run_cancelled':
		case 'run_done':
		case 'run_failed':
		case 'run_exhausted':
			return applyRunTerminal(state, event);
		case 'proc_updated':
			return applyProcUpdated(state, event);
		case 'background_task_output':
			return applyBackgroundTaskOutput(state, event);
		case 'background_task_completed':
			return applyBackgroundTaskCompleted(state, event);
		case 'task_updated':
			return applyTaskUpdated(state, event);
		case 'child_work_changed':
			return applyChildWorkChanged(state, event);
		case 'message_patched':
			return applyMessagePatched(state, event);
		case 'plan_build_submitted':
			return applyPlanBuildSubmitted(state, event);
		case 'run_state':
			return applyRunState(state, event);
		default:
			return state;
	}
}
