/**
 * Single source of truth for SESSION_STREAM event types.
 * Consumers: Desktop Hub demux, Mobile store attach gate, TUI transcript apply,
 * Scala SessionRouter fan-out (generated SessionStream.scala).
 *
 * Union of the four-end catalogs plus goal_updated / follow_up_changed /
 * proc_updated / task_updated / run_state. Keep sorted.
 */
export const SESSION_STREAM_EVENT_TYPES = [
	'agent_call_finished',
	'agent_call_started',
	'agent_final_answer',
	'approval_expired',
	'approval_requested',
	'approval_resolved',
	'assistant_delta',
	'assistant_message',
	'checkpoint',
	'child_work_changed',
	'clarify',
	'clarify_resolved',
	'dsh_goal_changed',
	'dsh_tool_card',
	'error',
	'file_read',
	'final_answer',
	'follow_up_changed',
	'gap',
	'goal_updated',
	'input_accepted',
	'input_rejected',
	'llm_network_wait',
	'llm_request',
	'llm_response',
	'message_patched',
	'plan_build_submitted',
	'proc_updated',
	'question_answered',
	'question_batch_requested',
	'question_batch_resolved',
	'question_requested',
	'reasoning_delta',
	'run_cancelled',
	'run_done',
	'run_exhausted',
	'run_failed',
	'run_state',
	'session_history_page',
	'session_restored',
	'subagent_finished',
	'subagent_started',
	'subagent_updated',
	'task_cancelled',
	'task_done',
	'task_failed',
	'task_updated',
	'thinking_delta',
	'thinking_finished',
	'thinking_started',
	'tool_finished',
	'tool_output',
	'tool_started',
	'turn_cancelled',
	'turn_finished',
	'turn_started',
	'turn_usage'
] as const;

export type SessionStreamEventType = (typeof SESSION_STREAM_EVENT_TYPES)[number];

const SET: ReadonlySet<string> = new Set(SESSION_STREAM_EVENT_TYPES);

export function isSessionStreamEvent(type: string): boolean {
	return SET.has(type);
}
