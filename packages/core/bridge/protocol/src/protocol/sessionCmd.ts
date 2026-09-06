import {z} from 'zod';
import {commandInfo, questionBatchAnswer} from './shapes.js';

export type SessionCmd =
	{type: 'AttachSession'; sessionId: string; lastEventSeq: number; clientId: string; limit?: number}
	| {type: 'DetachSession'; sessionId: string; clientId: string}
	| {
			type: 'SubmitUserMessage';
			sessionId: string;
			clientMessageId: string;
			text: string;
			agentId?: string;
			useModel?: string;
			/** When true, Engine generates a Session title from this message (default omit/false). */
			generateTitle?: boolean;
			/** Optional per-Run RunMode override (agent/plan/ask/yolo); omit → sticky session.run_mode. */
			mode?: string;
			/** Optional per-Submit sampling; omit → sticky session.model_settings. */
			effort?: string;
			thinking?: boolean;
			/** Structured @ mention chips — passthrough only (no Mentions.resolve on Submit). */
			mentions?: Array<{
				kind: string;
				locator: string;
				displayName?: string;
				ref?: string;
				entity?: string;
			}>;
	  }
	/** Read-only Mentions prefix suggest (not a Run). */
	| {
			type: 'MentionSuggest';
			sessionId: string;
			prefix: string;
			requestId: string;
			kinds?: string[];
			limit?: number;
	  }
	/** Explicit Mentions resolve — not the Submit hot path. */
	| {type: 'MentionResolve'; sessionId: string; refs: string[]; requestId: string}
	/** Sticky session.run_mode (Composer Mode control). */
	| {type: 'SetMode'; sessionId: string; mode: string}
	| {type: 'SetEngineKind'; sessionId: string; kind: string}
	| {type: 'SetEngine'; sessionId: string; engineId?: string; kind?: string}
	| {
			type: 'DshCall';
			method: string;
			payload?: Record<string, unknown>;
			sessionId?: string;
			requestId?: string;
	  }
	| {
			type: 'Call';
			method: string;
			payload?: Record<string, unknown>;
			sessionId?: string;
			requestId?: string;
	  }
	| {
			type: 'DshSteer';
			sessionId: string;
			text: string;
			images?: Array<{mediaType: string; data: string}>;
	  }
	| {
			type: 'Steer';
			sessionId: string;
			text: string;
			images?: Array<{mediaType: string; data: string}>;
	  }
	| {
			type: 'DshQueue';
			sessionId: string;
			itemId: string;
			action: string;
			text?: string;
	  }
	| {
			type: 'Queue';
			sessionId: string;
			itemId: string;
			action: string;
			text?: string;
	  }
	/** Sticky session.model_settings (platform/model/effort/thinking). */
	| {
			type: 'SetModelSettings';
			sessionId: string;
			platform: string;
			model: string;
			effort?: string;
			thinking?: boolean;
	  }
	/**
	 * Host slash / SkillSlash. `sessionId` pins multi-task demux (omit → Engine active session).
	 * `generateTitle` mirrors SubmitUserMessage: Thin Client opt-in for first SkillSlash turn.
	 */
	| {type: 'command'; name: string; args: string; sessionId?: string; generateTitle?: boolean}
	| {type: 'CancelRun'; sessionId: string; runId: string; reason: string}
	/** Replay the last accepted submit under a fresh runId (error-card retry / regenerate). */
	| {type: 'RerunRun'; sessionId: string; runId: string}
	| {type: 'CancelSession'; sessionId: string; reason: string}
	/** Thin Client Proc Stop (≠ CancelRun). Default reason wakes BackgroundWake. */
	| {type: 'KillProc'; sessionId: string; procId: string; reason?: string}
	| {
			type: 'AnswerQuestion';
			sessionId: string;
			runId: string;
			questionId: string;
			selectedOptionId?: string;
			customText?: string;
			/** @deprecated expand-contract; prefer selectedOptionId / customText */
			answer?: string;
	  }
	| {
			type: 'AnswerQuestionBatch';
			sessionId: string;
			rpcId: string;
			answers?: Array<{id: string; selected: string[]; custom?: string}>;
			cancelled?: boolean;
	  }
	| {type: 'DecideApproval'; sessionId: string; runId: string; approvalId: string; approved: boolean; reason?: string}
	| {type: 'Ack'; sessionId: string; clientId: string; lastEventSeq: number}
	| {type: 'Heartbeat'; sessionId: string; clientId: string; atMillis?: number}
	| {type: 'BindSessionWorkspace'; sessionId: string; workspaceId: string}
	| {type: 'NewSession'; workspaceId: string; title?: string; /** Local optimistic Task id; echoed on command_result. */ taskId?: string}
	| {type: 'SetSessionTitle'; sessionId: string; title: string; tenantId?: string; appId?: string}
	| {type: 'SetSessionSummary'; sessionId: string; summary: string; tenantId?: string; appId?: string}
	| {type: 'UpdateSessionStatus'; sessionId: string; status: string; tenantId?: string; appId?: string}
	| {
			type: 'CreateSession';
			projectId: string;
			title?: string;
			startupMode?: string;
			workspaceId?: string;
			tenantId?: string;
			appId?: string;
			/** Local optimistic Task id; Engine echoes on command_result (not stored in Meta). */
			taskId?: string;
			/** Optional engineId; omit stores the Registry default. */
			engineKind?: string;
	  }
	| {type: 'FollowUpRemove'; sessionId: string; itemId: string}
	| {type: 'FollowUpUpdate'; sessionId: string; itemId: string; text: string}
	| {type: 'FollowUpReorder'; sessionId: string; fromIndex: number; toIndex: number}
	| {type: 'FollowUpPause'; sessionId: string; paused: boolean}
	| {
			type: 'InterruptWithMessage';
			sessionId: string;
			text: string;
			clientMessageId: string;
			hardTimeoutMs?: number;
			itemId?: string;
			useModel?: string;
			effort?: string;
			thinking?: boolean;
		}
	| {type: 'CancelAssociated'; sessionId: string; reason?: string}
	| {type: 'SteerMsg'; sessionId: string; text: string; runId?: string; agentId?: string}

export const sessionCmdSchemas = [
	z.object({
		type: z.literal('AttachSession'),
		sessionId: z.string(),
		lastEventSeq: z.number(),
		clientId: z.string(),
		limit: z.number().optional()
	}),
	z.object({type: z.literal('DetachSession'), sessionId: z.string(), clientId: z.string()}),
	z.object({
		type: z.literal('SubmitUserMessage'),
		sessionId: z.string(),
		clientMessageId: z.string(),
		text: z.string(),
		agentId: z.string().optional(),
		useModel: z.string().optional(),
		generateTitle: z.boolean().optional(),
		mode: z.string().optional(),
		effort: z.string().optional(),
		thinking: z.boolean().optional(),
		mentions: z
			.array(
				z.object({
					kind: z.string(),
					locator: z.string(),
					displayName: z.string().optional(),
					ref: z.string().optional(),
					entity: z.string().optional()
				})
			)
			.optional(),
		/** UI Build → PlanBuild (Engine persists plan_build + session_event). */
		planBuild: z
			.object({
				planId: z.string(),
				name: z.string().optional()
			})
			.optional(),
		images: z
			.array(z.object({mediaType: z.string(), data: z.string()}))
			.optional()
	}),
	z.object({
		type: z.literal('MentionSuggest'),
		sessionId: z.string(),
		prefix: z.string(),
		requestId: z.string(),
		kinds: z.array(z.string()).optional(),
		limit: z.number().optional()
	}),
	z.object({
		type: z.literal('MentionResolve'),
		sessionId: z.string(),
		refs: z.array(z.string()),
		requestId: z.string()
	}),
	z.object({
		type: z.literal('SetMode'),
		sessionId: z.string(),
		mode: z.string()
	}),
	z.object({
		type: z.literal('SetEngineKind'),
		sessionId: z.string(),
		kind: z.string()
	}),
	z.object({
		type: z.literal('SetEngine'),
		sessionId: z.string(),
		engineId: z.string().optional(),
		kind: z.string().optional()
	}),
	z.object({
		type: z.literal('DshCall'),
		method: z.string(),
		payload: z.record(z.string(), z.unknown()).optional(),
		sessionId: z.string().optional(),
		requestId: z.string().optional()
	}),
	z.object({
		type: z.literal('Call'),
		method: z.string(),
		payload: z.record(z.string(), z.unknown()).optional(),
		sessionId: z.string().optional(),
		requestId: z.string().optional()
	}),
	z.object({
		type: z.literal('DshSteer'),
		sessionId: z.string(),
		text: z.string(),
		images: z.array(z.object({mediaType: z.string(), data: z.string()})).optional()
	}),
	z.object({
		type: z.literal('Steer'),
		sessionId: z.string(),
		text: z.string(),
		images: z.array(z.object({mediaType: z.string(), data: z.string()})).optional()
	}),
	z.object({
		type: z.literal('DshQueue'),
		sessionId: z.string(),
		itemId: z.string(),
		action: z.string(),
		text: z.string().optional()
	}),
	z.object({
		type: z.literal('Queue'),
		sessionId: z.string(),
		itemId: z.string(),
		action: z.string(),
		text: z.string().optional()
	}),
	z.object({
		type: z.literal('SetModelSettings'),
		sessionId: z.string(),
		platform: z.string(),
		model: z.string(),
		effort: z.string().optional(),
		thinking: z.boolean().optional()
	}),
	z.object({
		type: z.literal('command'),
		name: z.string(),
		args: z.string(),
		/** Active Task session — required for SkillSlash under multi-Attach. */
		sessionId: z.string().optional(),
		/** When true, Bridge auto-titles the Session from the slash user line (SkillSlash). */
		generateTitle: z.boolean().optional()
	}),
	z.object({type: z.literal('CancelRun'), sessionId: z.string(), runId: z.string(), reason: z.string()}),
	z.object({
		type: z.literal('InterruptWithMessage'),
		sessionId: z.string(),
		text: z.string(),
		clientMessageId: z.string(),
		hardTimeoutMs: z.number().optional(),
		itemId: z.string().optional(),
		useModel: z.string().optional(),
		effort: z.string().optional(),
		thinking: z.boolean().optional()
	}),
	z.object({type: z.literal('RerunRun'), sessionId: z.string(), runId: z.string()}),
	z.object({type: z.literal('CancelSession'), sessionId: z.string(), reason: z.string()}),
	z.object({
		type: z.literal('KillProc'),
		sessionId: z.string(),
		procId: z.string(),
		reason: z.string().optional()
	}),
	z.object({
		type: z.literal('AnswerQuestion'),
		sessionId: z.string(),
		runId: z.string(),
		questionId: z.string(),
		selectedOptionId: z.string().optional(),
		customText: z.string().optional(),
		answer: z.string().optional()
	}),
	z.object({
		type: z.literal('AnswerQuestionBatch'),
		sessionId: z.string(),
		rpcId: z.string(),
		answers: z.array(questionBatchAnswer).optional(),
		cancelled: z.boolean().optional()
	}),
	z.object({
		type: z.literal('DecideApproval'),
		sessionId: z.string(),
		runId: z.string(),
		approvalId: z.string(),
		approved: z.boolean(),
		reason: z.string().optional()
	}),
	z.object({type: z.literal('Ack'), sessionId: z.string(), clientId: z.string(), lastEventSeq: z.number()}),
	z.object({
		type: z.literal('Heartbeat'),
		sessionId: z.string(),
		clientId: z.string(),
		atMillis: z.number().optional()
	}),
	z.object({type: z.literal('BindSessionWorkspace'), sessionId: z.string(), workspaceId: z.string()}),
	z.object({
		type: z.literal('NewSession'),
		workspaceId: z.string(),
		title: z.string().optional(),
		taskId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetSessionTitle'),
		sessionId: z.string(),
		title: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetSessionSummary'),
		sessionId: z.string(),
		summary: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpdateSessionStatus'),
		sessionId: z.string(),
		status: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateSession'),
		projectId: z.string(),
		title: z.string().optional(),
		startupMode: z.string().optional(),
		workspaceId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional(),
		taskId: z.string().optional(),
		engineKind: z.string().optional()
	})
] as const

export const sessionCmdEventSchemas = [
	z.object({type: z.literal('Attached'), sessionId: z.string(), clientId: z.string(), lastEventSeq: z.number().optional(), replayFromSeq: z.number().optional()}),
	z.object({type: z.literal('Ack'), sessionId: z.string(), clientId: z.string(), lastEventSeq: z.number()}),
	z.object({type: z.literal('Heartbeat'), sessionId: z.string(), clientId: z.string().optional(), atMillis: z.number()}),
	z.object({
		type: z.literal('mention_suggestions'),
		requestId: z.string(),
		groups: z.array(
			z.object({
				kind: z.string(),
				tier: z.string(),
				items: z.array(
					z.object({
						ref: z.string(),
						displayName: z.string(),
						description: z.string().optional().nullable(),
						score: z.number().optional(),
						payload: z.object({
							kind: z.string(),
							locator: z.string(),
							entity: z.string().optional()
						})
					})
				)
			})
		)
	}),
	z.object({
		type: z.literal('mention_resolved'),
		requestId: z.string(),
		results: z.array(
			z.object({
				input: z.string(),
				status: z.string(),
				ref: z
					.object({
						kind: z.string(),
						locator: z.string(),
						tier: z.string().optional(),
						canonical: z.string().optional()
					})
					.nullable()
					.optional(),
				displayName: z.string().nullable().optional(),
				summary: z.string().nullable().optional(),
				actions: z.array(z.string()).optional(),
				candidates: z
					.array(
						z.object({
							kind: z.string(),
							locator: z.string(),
							canonical: z.string(),
							displayName: z.string().optional()
						})
					)
					.optional()
			})
		)
	}),
	z.object({type: z.literal('model_changed'), model: z.string(), modelDisplay: z.string().optional()}),
	z.object({type: z.literal('commands_available'), commands: z.array(commandInfo)})
] as const
