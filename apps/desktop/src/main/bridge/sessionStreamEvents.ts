/**
 * Bridge event types that target a Session transcript / gate (grill set C).
 * These MUST carry sessionId for App-scoped multi-Project demux.
 * Host-level events (ready, open_project_set, sessions_list, model_*, Register/NewSession
 * command_result, …) are NOT in this set.
 */
import type {BridgeEvent} from '@fastllm/bridge-protocol';

export const SESSION_STREAM_EVENT_TYPES = new Set([
	'input_accepted',
	'input_rejected',
	'turn_started',
	'thinking_started',
	'llm_request',
	'llm_response',
	'reasoning_delta',
	'assistant_delta',
	'final_answer',
	'turn_usage',
	'turn_finished',
	'turn_cancelled',
	'tool_started',
	'tool_output',
	'tool_finished',
	'file_read',
	'approval_requested',
	'approval_resolved',
	'approval_expired',
	'clarify',
	'clarify_resolved',
	'question_requested',
	'question_answered',
	'agent_final_answer',
	'run_done',
	'run_failed',
	'run_cancelled',
	'run_exhausted',
	'llm_network_wait',
	'agent_call_started',
	'agent_call_finished',
	'task_done',
	'task_failed',
	'task_cancelled',
	/** Unified LiveChildWork lifecycle wire (workload-capability) — session-scoped. */
	'child_work_changed',
	/** External-loop SubagentWorkCard lifecycle (DSH / later engines). */
	'subagent_started',
	'subagent_updated',
	'subagent_finished',
	'error',
	/** Session Plan create/replace/update (plan_id + payload); ticket 05/06. */
	'message_patched',
	/** PlanBuild dual-record → peer / demux (must not fall through to active task). */
	'plan_build_submitted',
	'gap',
	'checkpoint',
	'dsh_tool_card',
	'dsh_goal_changed'
]);

export function isSessionStreamEvent(type: string): boolean {
	return SESSION_STREAM_EVENT_TYPES.has(type);
}

/** Single source for reading sessionId off Bridge events (Hub + SessionController). */
export function sessionIdFromEvent(event: BridgeEvent): string | undefined {
	if ('sessionId' in event && typeof (event as {sessionId?: unknown}).sessionId === 'string') {
		return (event as {sessionId: string}).sessionId;
	}
	return undefined;
}
