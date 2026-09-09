import {z} from 'zod';

export const eventMeta = z.object({eventSeq: z.number().optional()});

/** EventRow → NDJSON types that must carry a safe positive eventSeq. */
export const PERSIST_RIVER_TYPES = new Set([
	'reasoning_delta',
	'assistant_delta',
	'checkpoint',
	'turn_started',
	'llm_request',
	'llm_response',
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
	'question_batch_requested',
	'question_batch_resolved',
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
	'subagent_started',
	'subagent_updated',
	'subagent_finished',
	'message_patched',
	'goal_updated',
	'seq_skip',
	'dsh_tool_card',
	'dsh_goal_changed',
	'usage_reported',
	'child_transcript_delta',
	'context_pruned',
	'goal_delta'
]);

const GOAL_NOTICE_TURN = /^goal-.+-notice$/;
const GOAL_STEP_TURN = /^goal-step-.+-conclusion$/;

/** JsonCallbacks / CommandLoop live wire — no eventSeq; river copy arrives later with seq.
 *  Approvals / questions must paint even when EventRow seq has a hole — otherwise the
 *  run sits in waiting_approval with no card until the 10 min busy timeout. */
const LIVE_CALLBACK_TYPES = new Set([
	'turn_started',
	'goal_updated',
	'assistant_delta',
	'reasoning_delta',
	'tool_started',
	'tool_output',
	'tool_finished',
	'file_read',
	'turn_usage',
	'llm_request',
	'llm_response',
	'llm_network_wait',
	'approval_requested',
	'approval_resolved',
	'approval_expired',
	'question_requested',
	'question_answered',
	'question_batch_requested',
	'question_batch_resolved',
	'clarify',
	'clarify_resolved',
	// CommandLoop settle has no persist seq. Holding these behind a hole (or
	// dropping them at parse) leaves Fast IDE Stop lit after the text is done.
	'turn_finished',
	'turn_cancelled',
	'run_done',
	'run_failed',
	'run_cancelled',
	'run_exhausted',
	// Parent turn may already be finished; child settle must still paint.
	'subagent_started',
	'subagent_updated',
	'subagent_finished',
	// Incremental rivers (§1.2): UI-only visibility, snapshot is authoritative.
	'usage_reported',
	'child_transcript_delta',
	'context_pruned',
	'goal_delta',
	'run_state'
]);

/** Persist types emitted as live chrome (no eventSeq, do not advance lastApplied). */
export function isLiveChrome(ev: {type: string} & Record<string, unknown>): boolean {
	const turnId = typeof ev.turnId === 'string' ? ev.turnId : undefined;
	const detail = typeof ev.detail === 'string' ? ev.detail : undefined;
	if (LIVE_CALLBACK_TYPES.has(ev.type)) return true;
	if (
		(ev.type === 'final_answer' || ev.type === 'turn_finished') &&
		turnId != null &&
		(GOAL_NOTICE_TURN.test(turnId) || GOAL_STEP_TURN.test(turnId))
	)
		return true;
	return ev.type === 'agent_call_finished' && detail === 'goal finished';
}

export function refineRiver(
	ev: {type: string; eventSeq?: number} & Record<string, unknown>,
	ctx: z.RefinementCtx
): void {
	if ((ev.type === 'gap' || ev.type === 'dsh_caps' || ev.type === 'dsh_queue') && ev.eventSeq != null) {
		ctx.addIssue({code: 'custom', path: ['eventSeq'], message: `${ev.type} must not carry eventSeq`});
		return;
	}
	if (!PERSIST_RIVER_TYPES.has(ev.type)) return;
	if (ev.eventSeq == null && isLiveChrome(ev)) return;
	if (ev.eventSeq == null || !Number.isSafeInteger(ev.eventSeq) || ev.eventSeq < 1) {
		ctx.addIssue({
			code: 'custom',
			path: ['eventSeq'],
			message: 'persisted river events require a safe positive eventSeq'
		});
	}
}
