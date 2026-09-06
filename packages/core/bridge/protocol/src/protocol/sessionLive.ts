import {z} from 'zod';
import {stringRecord, questionOption, questionBatchItem, planTodo} from './shapes.js';

export const sessionLiveSchemas = [
	z.object({type: z.literal('input_accepted'), turnId: z.string(), clientMessageId: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('input_rejected'), clientMessageId: z.string().optional(), reason: z.string(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('turn_started'),
		turnId: z.string().optional(),
		clientMessageId: z.string().optional(),
		text: z.string().optional(),
		sessionId: z.string().optional(),
		messageType: z.string().optional(),
		planId: z.string().optional(),
		planName: z.string().optional(),
		/** Goal step conclusion: member display name. */
		agentName: z.string().optional(),
		/** Goal step conclusion: `pass` | `reject`. */
		verdict: z.string().optional(),
		goalId: z.string().optional(),
		stepId: z.string().optional(),
		/** Goal outcome notice: `passed` | `failed` | `cancelled`. */
		goalStatus: z.string().optional()
	}),
	z.object({
		type: z.literal('plan_build_submitted'),
		sessionId: z.string().optional(),
		messageId: z.string(),
		planId: z.string(),
		content: z.string().optional(),
		name: z.string().optional(),
		runId: z.string().optional()
	}),
	z.object({type: z.literal('thinking_started'), turnId: z.string().optional(), turn: z.number(), maxTurns: z.number(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('llm_request'),
		turnId: z.string().optional(),
		turn: z.number().optional(),
		messages: z.array(z.object({role: z.string(), content: z.string()})),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('llm_response'),
		turnId: z.string().optional(),
		turn: z.number().optional(),
		reasoning: z.string().optional(),
		content: z.string().optional(),
		sessionId: z.string().optional()
	}),
	// agentId/depth/agentRunId mark subagent (child-run) deltas — clients route them to the
// delegation tool row (Subagent card body) instead of the main assistant entry.
	z.object({
		type: z.literal('reasoning_delta'),
		turnId: z.string().optional(),
		text: z.string(),
		unitId: z.string().optional(),
		sessionId: z.string().optional(),
		agentId: z.string().nullish(),
		depth: z.number().nullish(),
		agentRunId: z.string().nullish()
	}),
	z.object({
		type: z.literal('assistant_delta'),
		turnId: z.string().optional(),
		text: z.string(),
		unitId: z.string().optional(),
		sessionId: z.string().optional(),
		agentId: z.string().nullish(),
		depth: z.number().nullish(),
		agentRunId: z.string().nullish()
	}),
	z.object({
		type: z.literal('checkpoint'),
		unitId: z.string(),
		content: z.string(),
		usage: z.number().optional(),
		turnId: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('gap'),
		floor: z.number().int().nonnegative(),
		high: z.number().int().positive().optional(),
		sessionId: z.string().optional()
	}),
	// event() may stamp turnId/agentId; keep extra fields.
	z.object({
		type: z.literal('seq_skip')
	}).passthrough(),
	z.object({type: z.literal('final_answer'), turnId: z.string().optional(), text: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('turn_usage'), turnId: z.string().optional(), turn: z.number(), tokensUsed: z.number(), sessionId: z.string().optional()}),
	z.object({type: z.literal('turn_finished'), turnId: z.string().optional(), success: z.boolean(), reason: z.string().optional(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('run_state'),
		sessionId: z.string().optional(),
		runId: z.string().optional(),
		state: z.enum(['running', 'waiting', 'cancelling', 'idle']),
		turnId: z.string().optional(),
		ts: z.number()
	}),
	z.object({type: z.literal('turn_cancelled'), turnId: z.string().optional(), reason: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('tool_started'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), args: stringRecord, agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('tool_output'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), stream: z.string(), text: z.string(), agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('tool_finished'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), success: z.boolean(), fields: stringRecord, agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('file_read'), turnId: z.string().optional(), path: z.string(), language: z.string(), content: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_requested'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), tool: z.string(), description: z.string(), risk: z.string().optional(), context: z.string().optional(), note: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_resolved'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), approved: z.boolean(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_expired'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), reason: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('context_compressed'), turnId: z.string().optional(), ratio: z.number()}),
	z.object({type: z.literal('budget_exhausted'), turnId: z.string().optional(), turns: z.number(), tokens: z.number()}),
	z.object({type: z.literal('clarify'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string().optional(), question: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('clarify_resolved'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('question_requested'),
		runId: z.string().optional(),
		taskId: z.string().optional(),
		turnId: z.string().optional(),
		id: z.string(),
		title: z.string().optional(),
		question: z.string(),
		options: z.array(questionOption),
		allowCustom: z.boolean().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('question_answered'),
		runId: z.string().optional(),
		taskId: z.string().optional(),
		turnId: z.string().optional(),
		id: z.string(),
		selectedOptionId: z.string().optional(),
		customText: z.string().optional(),
		cancelled: z.boolean().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('question_batch_requested'),
		runId: z.string().optional(),
		turnId: z.string().optional(),
		rpcId: z.string(),
		questions: z.array(questionBatchItem),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('question_batch_resolved'),
		runId: z.string().optional(),
		turnId: z.string().optional(),
		rpcId: z.string(),
		outcome: z.enum(['answered', 'cancelled']),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('llm_network_wait'),
		runId: z.string(),
		phase: z.enum(['retrying', 'waiting', 'cleared']),
		attempt: z.number().optional(),
		maxAttempts: z.number().optional(),
		reason: z.string().optional(),
		elapsedMs: z.number().optional(),
		sessionId: z.string().optional(),
		discard: z.boolean().optional()
	}),
	/**
	 * Plan message create/replace/update (ticket 05/06).
	 * `planId` preferred; `messageId` accepted as alias (`plan_id` = message id).
	 * Payload may be structured fields and/or `payloadJson`.
	 */
	z.object({
		type: z.literal('message_patched'),
		sessionId: z.string().optional(),
		planId: z.string().optional(),
		messageId: z.string().optional(),
		action: z.enum(['create', 'replace', 'update']).or(z.string()),
		name: z.string().optional(),
		overview: z.string().optional(),
		todos: z.array(planTodo).optional(),
		body: z.string().optional(),
		payloadJson: z.string().nullish(),
		turnId: z.string().optional(),
		runId: z.string().optional()
	}),
	z.object({type: z.literal('error'), turnId: z.string().optional(), message: z.string(), sessionId: z.string().optional()})
] as const
