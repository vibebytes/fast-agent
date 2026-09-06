import {z} from 'zod';
import {planTodo} from './shapes.js';

export const restoredTool = z.object({
	id: z.string(),
	tool: z.string(),
	args: z.record(z.string(), z.string()).nullish(),
	status: z.string(),
	summary: z.string().nullish()
});

export const restoredPlan = z.object({
	planId: z.string(),
	name: z.string().optional(),
	overview: z.string().optional(),
	todos: z.array(planTodo).optional(),
	body: z.string().optional(),
	/** Full payload JSON when structured fields are omitted. */
	payloadJson: z.string().nullish()
});

export const restoredStep = z.object({
	reasoning: z.string().nullish(),
	tools: z.array(restoredTool).nullish(),
	text: z.string().nullish(),
	/** When true, `text` is preamble that must render before tools. */
	textBeforeTools: z.boolean().nullish(),
	/** Session Plan message folded into this step (`plan_id` = message id). */
	plan: restoredPlan.nullish()
});

export const restoredTurn = z.object({
	turnId: z.string(),
	userText: z.string(),
	assistantText: z.string(),
	thinking: z.string().nullish(),
	tools: z.array(restoredTool).nullish(),
	tokensUsed: z.number().nullish(),
	/** Ordered steps when Engine expand is available; omit/empty = legacy crush shape. */
	steps: z.array(restoredStep).nullish(),
	/** User message_origin wire (e.g. scheduler_generated) for restore styling. */
	origin: z.string().nullish(),
	/** User message_type when not plain text (e.g. plan_build). */
	userMessageType: z.string().nullish(),
	/** PlanBuild payload plan_id. */
	planId: z.string().nullish(),
	/** PlanBuild display name. */
	planName: z.string().nullish(),
	/** P1b: runId this turn's user row re-submits (rerun/regenerate marker). */
	supersedes: z.string().nullish(),
	/** True when the superseded run ended in failure (retry, not plain regenerate). */
	supersedesFailed: z.boolean().nullish(),
	/** Assistant message_type for Goal system turns. */
	assistantMessageType: z.string().nullish(),
	goalId: z.string().nullish(),
	goalStatus: z.string().nullish(),
	goalStepId: z.string().nullish(),
	goalAgentName: z.string().nullish(),
	goalVerdict: z.string().nullish(),
	/** Assistant settlement `status=failed` — restore as ErrorCard. */
	failed: z.boolean().nullish()
});

export type SessionRestoreCommand =
	{type: 'FetchAgentTimeline'; sessionId: string; agentId: string}
	| {
			type: 'FetchSessionHistory';
			sessionId: string;
			beforeTurnId: string;
			limit?: number;
	  }

export const sessionRestoreCommandSchemas = [
	z.object({type: z.literal('FetchAgentTimeline'), sessionId: z.string(), agentId: z.string()}),
	z.object({
		type: z.literal('FetchSessionHistory'),
		sessionId: z.string(),
		beforeTurnId: z.string(),
		limit: z.number().optional()
	})
] as const

export const sessionRestoreSchemas = [
	z.object({
		type: z.literal('session_restored'),
		sessionId: z.string(),
		turns: z.array(restoredTurn),
		/** True when older Turns exist beyond this window (ADR-0012). */
		hasMoreOlder: z.boolean().optional(),
		/** Total Turn count in the Session (MESSAGE-derived). */
		totalTurnCount: z.number().optional()
	}),
	z.object({
		type: z.literal('session_history_page'),
		sessionId: z.string(),
		turns: z.array(restoredTurn),
		hasMoreOlder: z.boolean(),
		totalTurnCount: z.number(),
		beforeTurnId: z.string()
	}),
	z.object({
		type: z.literal('agent_timeline'),
		agentId: z.string(),
		parentAgentId: z.string().optional(),
		name: z.string(),
		turns: z.array(restoredTurn),
		children: z.array(z.object({agentId: z.string(), name: z.string()})).optional()
	})
] as const
