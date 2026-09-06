import {z} from 'zod';

export const sessionSettleSchemas = [
	z.object({
		type: z.literal('follow_up_changed'),
		paused: z.boolean(),
		itemsJson: z.string(),
		notice: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('dsh_caps'),
		sessionId: z.string(),
		queue: z.boolean(),
		goal: z.boolean(),
		budget: z.boolean(),
		question: z.boolean(),
		slash: z.boolean()
	}),
	z.object({
		type: z.literal('dsh_queue'),
		sessionId: z.string(),
		items: z.array(
			z.object({
				id: z.string(),
				placement: z.enum(['queued', 'steering', 'context']),
				text: z.string()
			})
		)
	}),
	z.object({
		type: z.literal('dsh_tool_card'),
		sessionId: z.string(),
		runId: z.string(),
		callId: z.string(),
		name: z.string(),
		title: z.string(),
		args: z.record(z.string(), z.string()),
		result: z.string().optional()
	}),
	z.object({
		type: z.literal('dsh_goal_changed'),
		sessionId: z.string(),
		operation: z.string(),
		phase: z.string(),
		title: z.string(),
		text: z.string()
	}),
	z.object({
		type: z.literal('subagent_started'),
		runId: z.string().optional(),
		childSessionId: z.string(),
		mode: z.enum(['one-shot', 'continuable']),
		label: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('subagent_updated'),
		childSessionId: z.string(),
		activity: z.enum(['running', 'inactive']),
		preview: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('subagent_finished'),
		childSessionId: z.string(),
		status: z.enum(['completed', 'failed', 'cancelled']),
		summary: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({type: z.literal('agent_final_answer'), runId: z.string().optional(), taskId: z.string().optional(), turnId: z.string().optional(), text: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('run_done'), runId: z.string(), success: z.boolean(), summary: z.string(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('run_failed'),
		runId: z.string(),
		error: z.string(),
		sessionId: z.string().optional(),
		/** Structured failure info (P1a); omitted when the backend cannot classify the fault. */
		fault: z
			.object({
				kind: z.string(),
				remedy: z.string(),
				retryableAfterMs: z.number().optional(),
				attempts: z.number().optional(),
				acceptedTurns: z.number().optional()
			})
			.optional()
	}),
	z.object({type: z.literal('run_cancelled'), runId: z.string(), reason: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('run_exhausted'), runId: z.string(), reason: z.string(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('background_task_completed'),
		sessionId: z.string().optional(),
		runId: z.string().nullish(),
		procId: z.string(),
		exitCode: z.number().nullish(),
		outputPreview: z.string().nullish(),
		outFile: z.string().nullish(),
		command: z.string().nullish(),
		reason: z.string().nullish(),
		shouldWake: z.boolean().nullish()
	}),
	z.object({
		type: z.literal('background_wake_suppressed'),
		sessionId: z.string().optional(),
		procId: z.string(),
		reason: z.string()
	}),
	z.object({
		type: z.literal('proc_updated'),
		sessionId: z.string().optional(),
		procId: z.string(),
		runId: z.string().nullish(),
		command: z.string().nullish(),
		status: z.enum(['running', 'exited', 'killed']),
		outFile: z.string().nullish(),
		// Engine may emit JSON null for absent Option[String]; accept nullish.
		reason: z.string().nullish()
	}),
	z.object({
		type: z.literal('task_updated'),
		sessionId: z.string().optional(),
		taskId: z.string(),
		kind: z.enum(['proc', 'loop', 'automation']),
		status: z.string(),
		title: z.string().nullish(),
		detail: z.string().nullish()
	}),
	// Goal card lifecycle (②′): awaiting_confirm → confirm card; started → busy banner;
// paused → paused banner; escalated → escalate card; finished → completion card.
	z.object({
		type: z.literal('goal_updated'),
		sessionId: z.string().optional(),
		goalId: z.string(),
		phase: z.enum(['awaiting_confirm', 'started', 'paused', 'escalated', 'finished']),
		status: z.string(),
		name: z.string().nullish(),
		statement: z.string().nullish(),
		acceptance: z.string().nullish(),
		workflowJson: z.string().nullish(),
		membersJson: z.string().nullish(),
		budgetJson: z.string().nullish(),
		loopAgentId: z.string().nullish(),
		resultSummary: z.string().nullish(),
		escalateActions: z.array(z.string()).optional(),
		reason: z.string().nullish(),
		/** In-flight workflow node ids (parallel DAG cursors). */
		currentStepIds: z.array(z.string()).nullish(),
		activeRunIds: z.array(z.string()).nullish(),
		/** @deprecated wire dual-read — prefer currentStepIds */
		currentStepId: z.union([z.string(), z.array(z.string())]).nullish(),
		/** @deprecated wire dual-read — prefer activeRunIds */
		activeRunId: z.union([z.string(), z.array(z.string())]).nullish(),
		progressJson: z.string().nullish(),
		escalateKind: z.enum(['infra', 'decision']).nullish()
	}),
	// Unified child-workload change (LiveChildWork row). Lifecycle always; optional
// rolling outputPreview (throttled tool/proc deltas from WorkloadHub).
	z.object({
		type: z.literal('child_work_changed'),
		sessionId: z.string().optional(),
		kind: z.string(),
		id: z.string(),
		parentRef: z.string().optional(),
		title: z.string(),
		status: z.string(),
		summary: z.string().optional(),
		outputPreview: z.string().optional(),
		goalId: z.string().optional(),
		stepId: z.string().optional()
	}),
	z.object({
		type: z.literal('background_task_output'),
		sessionId: z.string().optional(),
		runId: z.string().nullish(),
		procId: z.string(),
		text: z.string(),
		outFile: z.string().nullish()
	}),
	z.object({
		type: z.literal('will_wake'),
		sessionId: z.string().optional(),
		procId: z.string(),
		command: z.string().nullish(),
		reason: z.string().nullish(),
		shouldWake: z.boolean().nullish()
	}),
	z.object({type: z.literal('agent_call_started'), turnId: z.string().optional(), agentId: z.string(), parentAgentId: z.string().optional(), depth: z.number().optional(), name: z.string(), runId: z.string().optional(), parentRunId: z.string().optional(), goalId: z.string().optional(), stepId: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('agent_call_finished'), turnId: z.string().optional(), agentId: z.string(), success: z.boolean(), tokensUsed: z.number().optional(), elapsedMs: z.number().optional(), toolCalls: z.number().optional(), runId: z.string().optional(), detail: z.string().optional(), resultSummary: z.string().optional(), goalId: z.string().optional(), stepId: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_done'), taskId: z.string(), success: z.boolean(), summary: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_failed'), taskId: z.string(), error: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_cancelled'), taskId: z.string(), reason: z.string(), sessionId: z.string().optional()})
] as const
