import {z} from 'zod';

export type BridgeCommand =
	| {type: 'AttachSession'; sessionId: string; lastEventSeq: number; clientId: string; limit?: number}
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
	| {type: 'FetchAgentTimeline'; sessionId: string; agentId: string}
	| {
			type: 'FetchSessionHistory';
			sessionId: string;
			beforeTurnId: string;
			limit?: number;
	  }
	| {type: 'RegisterWorkspace'; path: string}
	| {type: 'UnregisterWorkspace'; workspaceId: string}
	| {type: 'BindSessionWorkspace'; sessionId: string; workspaceId: string}
	| {type: 'NewSession'; workspaceId: string; title?: string; /** Local optimistic Task id; echoed on command_result. */ taskId?: string}
	| {type: 'SetSessionTitle'; sessionId: string; title: string; tenantId?: string; appId?: string}
	| {type: 'SetSessionSummary'; sessionId: string; summary: string; tenantId?: string; appId?: string}
	| {type: 'UpdateSessionStatus'; sessionId: string; status: string; tenantId?: string; appId?: string}
	/** @deprecated Engine rejects; use GetWorkspaceMeta */
	| {type: 'GetOpenProjectSet'; defaultPath?: string}
	/** @deprecated Engine rejects; use CreateProject / UpdateProjectStatus */
	| {type: 'SetOpenProjectSet'; openPaths: string[]; activePath?: string; defaultPath?: string}
	| {type: 'GetWorkspaceMeta'; tenantId?: string; appId?: string}
	| {
			type: 'CreateProject';
			projectType: string;
			rootPath?: string;
			displayName?: string;
			tenantId?: string;
			appId?: string;
	  }
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
	| {
			type: 'UpdateProjectStatus';
			projectId: string;
			status: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetProjectDisplayName';
			projectId: string;
			displayName: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListRules';
			scope?: 'global' | 'project' | string;
			projectId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Settings-center documents. scope=effective merges project over global. */
			type: 'GetSettings';
			scope: 'global' | 'project' | 'effective' | string;
			scopeId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** RFC 7386 merge-patch one settings namespace; patchJson is the patch as a JSON string. */
			type: 'PatchSettings';
			scope: 'global' | 'project' | string;
			namespace: string;
			patchJson: string;
			scopeId?: string;
			schemaVersion?: number;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Settings-center model providers. */
			type: 'ListProviders';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UpsertProvider';
			name: string;
			id?: string;
			presetKey?: string;
			baseUrl?: string;
			kind?: string;
			metaJson?: string;
			credential?: string;
			seedModelsJson?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DeleteProvider';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetProviderEnabled';
			id: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'TestProvider';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'PatchProviderModels';
			id: string;
			patchJson: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SearchProviderModels';
			id: string;
			query: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Settings-center skills (disk SoT + market). */
			type: 'ListSkills';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'CreateSkill';
			name: string;
			scope: string;
			template?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DeleteSkill';
			name: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetSkillEnabled';
			name: string;
			scope: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SearchSkillMarket';
			query: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallSkillFromMarket';
			source: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallSkillFromMarket';
			name: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListExtensions';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ExtensionStatus';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallExtension';
			dir: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallExtension';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListEngines';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'EnableEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DisableEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'StartEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'StopEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetDefaultEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'CancelEngineInstall';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListScheduledJobs';
			kind?: string;
			sessionId?: string;
			projectId?: string;
			status?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Host-level create; Engine stamps created_from=ide. sessionId required for session_loop; platform may omit and mint via projectId. */
			type: 'CreateScheduledJob';
			kind: string;
			cronExpr: string;
			timezone?: string;
			recurring?: boolean;
			targetKind: string;
			targetRef?: string;
			promptText?: string;
			targetArgsJson?: string;
			maxFires?: number;
			title?: string;
			fireImmediately?: boolean;
			sessionId?: string;
			projectId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'ListLivingTasks'; tenantId?: string; appId?: string}
	| {
			type: 'ListTeams';
			projectId?: string;
			pathHash?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListGoals';
			projectId?: string;
			status?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListAgents';
			projectId?: string;
			tenantId?: string;
			appId?: string;
			includeArchived?: boolean;
	  }
	| {
			type: 'CreateTeam';
			name: string;
			projectId: string;
			description?: string;
			workspaceId?: string;
			members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UpdateTeam';
			teamId: string;
			name?: string;
			description?: string;
			members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'ArchiveTeam'; teamId: string; tenantId?: string; appId?: string}
	| {type: 'UnarchiveTeam'; teamId: string; tenantId?: string; appId?: string}
	| {type: 'DeleteTeam'; teamId: string; tenantId?: string; appId?: string}
	| {
			type: 'SaveAsTeam';
			sourceTeamId: string;
			name?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'PromoteTeam';
			teamId: string;
			name?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'GetTeam'; teamId: string; tenantId?: string; appId?: string}
	| {
			type: 'CreateAgent';
			name: string;
			projectId: string;
			model?: string;
			teamRole?: string;
			teamId?: string;
			taskBrief?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UpdateAgent';
			agentId: string;
			name?: string;
			model?: string;
			teamRole?: string;
			teamId?: string;
			taskBrief?: string;
			systemPrompt?: string;
			maxTurns?: number;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'ArchiveAgent'; agentId: string; tenantId?: string; appId?: string}
	| {type: 'UnarchiveAgent'; agentId: string; tenantId?: string; appId?: string}
	| {type: 'DeleteAgent'; agentId: string; tenantId?: string; appId?: string}
	| {
			type: 'CloneAgent';
			sourceId: string;
			teamId: string;
			name?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'GetAgent'; agentId: string; tenantId?: string; appId?: string}
	| {type: 'StopAgentRun'; agentId: string; tenantId?: string; appId?: string}
	| {type: 'PauseScheduledJob'; id: string; tenantId?: string; appId?: string}
	| {type: 'ResumeScheduledJob'; id: string; tenantId?: string; appId?: string}
	| {type: 'CancelScheduledJob'; id: string; tenantId?: string; appId?: string}
	| {type: 'FireNowScheduledJob'; id: string; tenantId?: string; appId?: string}
	| {
			type: 'UpdateScheduledJobCron';
			id: string;
			cronExpr: string;
			timezone?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'ListScheduledJobRuns'; id: string; tenantId?: string; appId?: string}
	/**
	 * Host-level Goal confirm gate (②′ card): optional patchJson applies last card edits
	 * atomically before freeze + Loop.startGoal.
	 */
	| {type: 'ConfirmGoal'; goalId: string; tenantId?: string; appId?: string; patchJson?: string}
	/** ②′ card draft edit — {statement?,acceptance?,workflow_json?,budget_json?,members?:[…]} (awaiting_confirm only). */
	| {type: 'PatchGoal'; goalId: string; patchJson: string; tenantId?: string; appId?: string}
	/** Human steer note for a running Goal — digested at step boundaries. */
	| {type: 'SteerGoal'; goalId: string; note: string; tenantId?: string; appId?: string}
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
	| {type: 'GoalStatus'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'EscalateResume'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'EscalateFail'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'PauseGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'ResumeGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'CancelGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'DeleteGoal'; goalId: string; tenantId?: string; appId?: string}
	| {
			type: 'AddRule';
			scope: 'global' | 'project' | string;
			text: string;
			projectId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {type: 'RemoveRule'; id: string; tenantId?: string; appId?: string}
	| {
			type: 'SetRuleEnabled';
			id: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	/**
	 * Agent change review for one checkout. The workspace is named by `workspaceId` (path hash or Meta
	 * id) or by the session bound to it; paths are never part of a payload, so a client cannot ask the
	 * daemon to write outside the checkout.
	 */
	| {
			type: 'ListReviewChanges';
			workspaceId?: string;
			sessionId?: string;
			checkpointId?: string;
			tenantId?: string;
	  }
	| {
			type: 'GetReviewChange';
			changeId: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/**
	 * The whole pending agent effect in one answer: per path, hunks of first.before → last.after.
	 * One round trip replaces the per-row detail storm.
	 */
	| {
			type: 'ListReviewDiff';
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
			/** Revision the client already holds; omitted = full snapshot. */
			sinceRevision?: number;
	  }
	/**
	 * One path's net effect with the batch hunk-line cap lifted. The path selects among this
	 * checkout's undecided review rows — it is not a workspace read of an arbitrary file.
	 */
	| {
			type: 'GetFileReviewDiff';
			path: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** `revision` is the list the user decided against; a moved list is rejected as stale. */
	| {
			type: 'KeepChanges';
			changeIds: string[];
			revision: number;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Plans an undo without touching a file. `timeline`/`whole` need `checkpointId`, `changes` needs `changeIds`. */
	| {
			type: 'PreviewRevert';
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Writes the plan. `force` overwrites the paths the preview listed in `forcePaths`. */
	| {
			type: 'ApplyRevert';
			previewId: string;
			force?: boolean;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	| {
			type: 'RedoRevert';
			restoreId: string;
			workspaceId?: string;
			sessionId?: string;
			tenantId?: string;
	  }
	/** Host-level editor FS: list one directory under a registered slot. */
	| {
			type: 'ListWorkspaceDir';
			requestId: string;
			workspaceId: string;
			relativePath?: string;
			tenantId?: string;
	  }
	/** Browse daemon disk outside a registered slot (remote open-folder). */
	| {
			type: 'ListHostDir';
			requestId: string;
			path?: string;
	  }
	/** Create one directory on daemon disk (remote open-folder). `name` is a single segment. */
	| {
			type: 'CreateHostDir';
			requestId: string;
			parent: string;
			name: string;
	  }
	/** Host-level editor FS: read a text file (≤2MB). */
	| {
			type: 'GetWorkspaceFile';
			requestId: string;
			workspaceId: string;
			relativePath: string;
			tenantId?: string;
	  }
	/** Host-level editor FS: save with optional mtime (+ bytes) CAS. */
	| {
			type: 'SaveWorkspaceFile';
			requestId: string;
			workspaceId: string;
			relativePath: string;
			content: string;
			mtime?: number;
			bytes?: number;
			tenantId?: string;
	  }
	/** Host-level SCM chrome: branch + dirty files under a registered slot. */
	| {
			type: 'GitWorkspaceStatus';
			requestId: string;
			workspaceId: string;
			tenantId?: string;
	  }
	/** Idempotent folder Project + RegisterWorkspace (cli-ink cwd sharing). */
	| {
			type: 'EnsureProject';
			path: string;
			displayName?: string;
			projectType?: string;
			tenantId?: string;
			appId?: string;
	  }
	/** Connection handshake (required on unix/npipe before other commands). */
	| {
			type: 'Hello';
			protocolVersion: number;
			clientId: string;
			clientKind: 'fast-ide' | 'fast-ink' | string;
			clientVersion?: string;
			pid?: number;
			cwd?: string;
			authToken?: string;
	  }
	| {type: 'Goodbye'; clientId: string; reason?: string}
	/** Connection-level heartbeat (lease refresh without Attach). */
	| {type: 'ClientHeartbeat'; clientId: string; atMillis?: number}
	| {type: 'GetDaemonStatus'}
	| {type: 'Shutdown'; force?: boolean};

const stringRecord = z.record(z.string(), z.string());
const commandInfo = z.object({
	name: z.string(),
	description: z.string().default(''),
	usage: z.string().optional().default(''),
	available: z.boolean().optional().default(true),
	availability: z.preprocess(
		value => value === 'capabilityunavailable' ? 'capability_unavailable' : value,
		z.enum(['ready', 'partial', 'capability_unavailable', 'hidden']).optional()
	),
	capability: z.preprocess(value => value === null ? undefined : value, z.string().optional()).optional(),
	/** Optional UI badge (e.g. skill scope: 个人 / 项目). */
	badge: z.string().optional()
});
const questionOption = z.object({
	id: z.string(),
	label: z.string(),
	description: z.string().optional(),
	recommended: z.boolean().optional()
});
const questionBatchOption = z.object({
	label: z.string(),
	description: z.string().optional()
});
const questionBatchItem = z.object({
	id: z.string(),
	question: z.string(),
	detail: z.string().optional(),
	header: z.string().optional(),
	options: z.array(questionBatchOption).optional(),
	multiSelect: z.boolean().optional(),
	intent: z.object({kind: z.string(), approve: z.string()}).optional()
});
const questionBatchAnswer = z.object({
	id: z.string(),
	selected: z.array(z.string()),
	custom: z.string().optional()
});

const modelSettingsInfo = z.object({
	platform: z.string(),
	model: z.string(),
	effort: z.string().optional(),
	thinking: z.boolean().optional()
});

const sessionInfo = z.object({
	id: z.string(),
	title: z.string().nullish(),
	summary: z.string().nullish(),
	lastModified: z.string(),
	messageCount: z.number(),
	cwd: z.string().nullish(),
	isCurrent: z.boolean().nullish(),
	/** Sticky session.run_mode for Composer Mode cold restore. */
	runMode: z.string().nullish(),
	/** Sticky session.engine_kind — `dsh` or omitted (Fast). */
	engineKind: z.string().nullish(),
	/** Sticky session.model_settings for Composer sampling cold restore. */
	modelSettings: modelSettingsInfo.nullish()
});

const restoredTool = z.object({
	id: z.string(),
	tool: z.string(),
	args: z.record(z.string(), z.string()).nullish(),
	status: z.string(),
	summary: z.string().nullish()
});

/** Session Plan todo row (`message_type=plan` payload). */
const planTodo = z.object({
	id: z.string(),
	content: z.string().optional().default(''),
	status: z.enum(['pending', 'in_progress', 'completed']).or(z.string())
});

/** Plan snapshot on a restored step or `message_patched`. */
const restoredPlan = z.object({
	planId: z.string(),
	name: z.string().optional(),
	overview: z.string().optional(),
	todos: z.array(planTodo).optional(),
	body: z.string().optional(),
	/** Full payload JSON when structured fields are omitted. */
	payloadJson: z.string().nullish()
});

/** One ReAct step: optional reasoning + tools + text, in arrival order. */
const restoredStep = z.object({
	reasoning: z.string().nullish(),
	tools: z.array(restoredTool).nullish(),
	text: z.string().nullish(),
	/** When true, `text` is preamble that must render before tools. */
	textBeforeTools: z.boolean().nullish(),
	/** Session Plan message folded into this step (`plan_id` = message id). */
	plan: restoredPlan.nullish()
});

const restoredTurn = z.object({
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

/** One side of a change diff: `null` when the path did not exist there. */
const reviewSide = z
	.object({
		id: z.string(),
		text: z.string().optional(),
		bytes: z.number().optional(),
		/**
		 * Why `text` is absent: not text, too large to send inline, or no longer in the store — in
		 * which case this path cannot be restored either, and the UI must say so rather than keep
		 * offering a diff.
		 */
		omitted: z.enum(['binary', 'too-large', 'missing']).optional()
	})
	.nullish();

/** Agent change review row (`Pending` until the user keeps or undoes it). */
const reviewChange = z.object({
	id: z.string(),
	checkpointId: z.string(),
	path: z.string(),
	kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
	state: z
		.object({
			kind: z.enum(['pending', 'reverted', 'kept', 'conflict']),
			fingerprint: z.string().optional(),
			reason: z.string().optional()
		})
		.passthrough(),
	/** Rename group: both paths are always kept or undone together. */
	groupId: z.string().nullish(),
	before: reviewSide,
	after: reviewSide,
	current: reviewSide
});

const fileReviewDiff = z.object({
	path: z.string(),
	changeIds: z.array(z.string()),
	hunks: z.array(
		z.object({
			oldStart: z.number(),
			oldLines: z.number(),
			newStart: z.number(),
			newLines: z.number(),
			lines: z.array(
				z.object({
					kind: z.enum(['context', 'add', 'del']),
					oldLine: z.number().nullish(),
					newLine: z.number().nullish(),
					text: z.string()
				})
			)
		})
	),
	additions: z.number(),
	deletions: z.number(),
	afterBlobId: z.string().nullish(),
	broken: z.boolean().optional(),
	blocked: z.string().nullish()
});

const reviewPayload = z.object({
	/** The workspace revision this answer was computed against. */
	revision: z.number().optional(),
	changes: z.array(reviewChange).optional(),
	/** Batched per-path hunks of the pending agent effect (ListReviewDiff). */
	diff: z
		.object({
			revision: z.number(),
			files: z.array(fileReviewDiff),
			removedPaths: z.array(z.string()).optional(),
			partial: z.boolean().optional()
		})
		.optional(),
	/** One path's net effect (GetFileReviewDiff). */
	file: fileReviewDiff.nullish(),
	/**
	 * Where each checkpoint sits in the conversation, so a timeline row can offer a restore. `runId` is
	 * the anchor a transcript can match; `messageId` is the engine's own row id.
	 */
	checkpoints: z
		.array(
			z.object({
				id: z.string(),
				runId: z.string(),
				messageId: z.string().nullish(),
				at: z.number()
			})
		)
		.optional(),
	change: reviewChange.nullish(),
	preview: z
		.object({
			id: z.string(),
			target: z
				.object({
					kind: z.enum(['timeline', 'whole', 'pending', 'changes']),
					checkpointId: z.string().nullish(),
					changeIds: z.array(z.string()).optional()
				})
				.passthrough(),
			revision: z.number(),
			changes: z.array(
				z.object({
					path: z.string(),
					kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
					previousPath: z.string().nullish()
				})
			),
			conflicts: z.array(z.object({path: z.string(), reason: z.string()})),
			/** Captured-but-excluded paths that cannot be restored at all. */
			excludedPaths: z.array(z.string()),
			/** Conflicted paths a forced apply would overwrite. */
			forcePaths: z.array(z.string()),
			/** Paths whose result folds in edits made after the agent's. */
			mergedPaths: z.array(z.string()),
			/**
			 * Background commands still running in this workspace. Restoring writes files underneath
			 * them, so the user has to be told before confirming — it does not block the restore.
			 */
			activeShells: z.array(z.string()).optional()
		})
		.optional(),
	restored: z
		.object({
			restoreId: z.string(),
			fromTree: z.string(),
			toTree: z.string(),
			revision: z.number()
		})
		.optional(),
	conflicts: z.array(z.object({path: z.string(), reason: z.string()})).optional(),
	movedPaths: z.array(z.string()).optional(),
	/** False when checkpoints are off: the UI must say changes cannot be undone. */
	available: z.boolean().optional(),
	/**
	 * The snapshot this restore needed is gone. Retrying cannot help, so a client must stop offering
	 * the restore point rather than report a transient failure.
	 */
	expired: z.boolean().optional(),
	missingRefs: z.array(z.string()).optional(),
	backend: z.string().optional()
});

const eventMeta = z.object({eventSeq: z.number().optional()});

const bridgeEventPayloadSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('ready'),
		protocolVersion: z.number().optional(),
		engineEpoch: z.string().optional(),
		capabilities: z.array(z.string()).optional(),
		model: z.string().optional(),
		modelDisplay: z.string().optional(),
		maxTurns: z.number().optional(),
		standalone: z.boolean().optional(),
		cwd: z.string().optional(),
		mode: z.string().optional(),
		sessionId: z.string().optional(),
		sessionTitle: z.string().optional(),
		restoredMessageCount: z.number().optional(),
		adminUrl: z.string().optional(),
		/**
		 * Whether agent changes in this daemon can be reviewed and undone at all. `available: false`
		 * means the drawer must say so instead of offering undo affordances that cannot work.
		 * Absent from daemons older than the checkpoint feature.
		 */
		checkpoint: z.object({backend: z.string(), available: z.boolean()}).optional()
	}),
	z.object({type: z.literal('Attached'), sessionId: z.string(), clientId: z.string(), lastEventSeq: z.number().optional(), replayFromSeq: z.number().optional()}),
	z.object({type: z.literal('Ack'), sessionId: z.string(), clientId: z.string(), lastEventSeq: z.number()}),
	z.object({type: z.literal('Heartbeat'), sessionId: z.string(), clientId: z.string().optional(), atMillis: z.number()}),
	z.object({type: z.literal('engine_status'), stage: z.string(), message: z.string()}),
	z.object({
		type: z.literal('engine_install_log'),
		engineId: z.string(),
		stream: z.enum(['stdout', 'stderr']),
		text: z.string(),
		seq: z.number()
	}),
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
	z.object({type: z.literal('turn_cancelled'), turnId: z.string().optional(), reason: z.string().optional(), sessionId: z.string().optional()}),
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
	z.object({type: z.literal('tool_started'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), args: stringRecord, agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('tool_output'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), stream: z.string(), text: z.string(), agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('tool_finished'), turnId: z.string().optional(), id: z.string(), toolCallId: z.string().optional(), tool: z.string(), success: z.boolean(), fields: stringRecord, agentId: z.string().optional(), agentRunId: z.string().optional(), parentAgentId: z.string().optional(), depth: z.number().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('file_read'), turnId: z.string().optional(), path: z.string(), language: z.string(), content: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_requested'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), tool: z.string(), description: z.string(), risk: z.string().optional(), context: z.string().optional(), note: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_resolved'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), approved: z.boolean(), sessionId: z.string().optional()}),
	z.object({type: z.literal('approval_expired'), runId: z.string().optional(), turnId: z.string().optional(), id: z.string(), reason: z.string().optional(), sessionId: z.string().optional()}),
	z.object({
		type: z.literal('follow_up_changed'),
		paused: z.boolean(),
		itemsJson: z.string(),
		notice: z.string().optional(),
		sessionId: z.string().optional()
	}),
	z.object({
		type: z.literal('command_result'),
		name: z.string(),
		message: z.string(),
		/** Engine RouteResult.status + classic ACK statuses; keep in sync with SessionEntity routes (Follow-up `queued`, DSH busy insert `steered`). */
		status: z.enum(['success', 'unavailable', 'error', 'decided', 'answered', 'accepted', 'rejected', 'cancelled', 'paused', 'resumed', 'triggered', 'queued', 'steered']).optional(),
		capability: z.string().optional(),
		availability: z.enum(['ready', 'partial', 'capability_unavailable', 'hidden']).optional(),
		sessionId: z.string().optional(),
		workspaceId: z.string().optional(),
		projectId: z.string().optional(),
		/** Slot path hash (12-hex = 6 bytes); distinct from Meta workspace resource id in workspaceId. */
		pathHash: z.string().optional(),
		/** Parallel FS command correlation (List/Get/SaveWorkspaceFile). */
		requestId: z.string().optional(),
		/** Editor workspace FS payload. */
		fs: z
			.object({
				code: z
					.enum([
						'outside',
						'too-large',
						'binary',
						'conflict',
						'missing',
						'no-slot',
						'busy',
						'is-dir',
						'not-found',
						'not-dir',
						'denied',
						'invalid'
					])
					.optional(),
				relativePath: z.string().optional(),
				content: z.string().optional(),
				mtime: z.number().optional(),
				bytes: z.number().optional(),
				entries: z
					.array(
						z.object({
							name: z.string(),
							relativePath: z.string().optional(),
							path: z.string().optional(),
							kind: z.enum(['file', 'dir']),
							mtime: z.number().optional().nullable()
						})
					)
					.optional(),
				truncated: z.boolean().optional(),
				path: z.string().optional(),
				home: z.string().optional()
			})
			.optional(),
		/** SCM chrome payload (GitWorkspaceStatus). Optional so other command_result events still parse. */
		git: z
			.object({
				available: z.boolean(),
				branch: z.string().optional(),
				dirty: z.boolean().optional(),
				files: z
					.array(
						z.object({
							path: z.string(),
							kind: z.enum(['modified', 'added', 'deleted'])
						})
					)
					.optional()
			})
			.optional(),
		/** Structured Session display title (SetSessionTitle / auto-title). */
		title: z.string().optional(),
		/** Structured Project display name (SetProjectDisplayName). */
		displayName: z.string().optional(),
		/** CreateSession / NewSession correlation: local optimistic Task id (passthrough). */
		taskId: z.string().optional(),
		/** Default subject agent minted by Meta CreateSession (`session.owner_agent_id`). */
		ownerAgentId: z.string().optional(),
		/** Settings-center documents (GetSettings / PatchSettings). */
		settings: z
			.array(
				z.object({
					scope: z.string(),
					scopeId: z.string(),
					namespace: z.string(),
					payload: z.unknown(),
					schemaVersion: z.number(),
					updatedAt: z.string().nullish(),
					/** Only on scope=effective reads: global | project | merged. */
					source: z.string().nullish()
				})
			)
			.optional(),
		/** Model providers (List/Upsert/…Provider) — never includes ciphertext. */
		providers: z
			.array(
				z.object({
					id: z.string(),
					kind: z.string(),
					vendor: z.string(),
					name: z.string(),
					baseUrl: z.string().nullish(),
					status: z.string().nullish(),
					statusDetail: z.string().nullish(),
					last4: z.string().nullish(),
					modelCount: z.number(),
					enabledModelCount: z.number(),
					enabled: z.boolean(),
					meta: z.unknown().optional(),
					models: z.array(z.unknown()).optional(),
					updatedAt: z.string().nullish()
				})
			)
			.optional(),
		/** OpenRouter search candidates (SearchProviderModels). */
		searchModels: z
			.array(
				z.object({
					modelId: z.string(),
					displayName: z.string(),
					contextLength: z.number().nullish(),
					vendorHint: z.string().nullish()
				})
			)
			.optional(),
		/** Installed skills (List/Create/SetSkillEnabled). */
		skills: z
			.array(
				z.object({
					name: z.string(),
					description: z.string(),
					scope: z.string(),
					source: z.string(),
					marketId: z.string().nullish(),
					enabled: z.boolean(),
					location: z.string().nullish(),
					dirName: z.string().nullish()
				})
			)
			.optional(),
		/** Extension admin rows (ListExtensions / ExtensionStatus). */
		extensions: z
			.array(
				z.object({
					id: z.string(),
					phase: z.enum(['Installed', 'Active', 'Stopping', 'Uninstalled', 'Failed']),
					hotUnload: z.boolean(),
					fault: z.string().optional(),
					restartHint: z.string().optional()
				})
			)
			.optional(),
		/** L0 engine admin rows (ListEngines / write cmds). */
		engines: z
			.array(
				z.object({
					id: z.string(),
					kind: z.enum(['builtin', 'extension']),
					adapter: z.enum(['ready', 'disabled', 'failed']),
					program: z.enum(['builtin', 'installed', 'missing', 'installing']),
					process: z.enum(['none', 'stopped', 'running']),
					processDetail: z.string().regex(/^[^:]+:\d+$/).optional(),
					isDefault: z.boolean(),
					inRegistry: z.boolean(),
					actions: z.array(z.string()),
					installLog: z
						.array(
							z.object({
								stream: z.enum(['stdout', 'stderr']),
								text: z.string(),
								seq: z.number()
							})
						)
						.optional()
				})
			)
			.optional(),
		/** Local Ledger marks (put/drop) on ListExtensions. */
		ledger: z
			.array(
				z.object({
					id: z.string(),
					mark: z.string()
				})
			)
			.optional(),
		/** Skills.sh market search rows (SearchSkillMarket). */
		marketSkills: z
			.array(
				z.object({
					id: z.string(),
					skillId: z.string(),
					name: z.string(),
					source: z.string(),
					installs: z.number(),
					isInstalled: z.boolean()
				})
			)
			.optional(),
		/** Ambient Rules payload (ListRules / AddRule). */
		rules: z
			.array(
				z.object({
					id: z.string(),
					scope: z.string(),
					projectId: z.string().nullish(),
					text: z.string(),
					enabled: z.boolean(),
					createdAt: z.string().nullish()
				})
			)
			.optional(),
		/** Platform / loop ScheduledJob rows (ListScheduledJobs). */
		scheduledJobs: z
			.array(
				z.object({
					id: z.string(),
					kind: z.string(),
					status: z.string(),
					sessionId: z.string(),
					projectId: z.string().nullish(),
					cronExpr: z.string().nullish(),
					timezone: z.string().nullish(),
					nextFireAt: z.string().nullish(),
					title: z.string().nullish(),
					promptText: z.string().nullish(),
					targetKind: z.string().nullish(),
					targetRef: z.string().nullish()
				})
			)
			.optional(),
		/** ScheduledJobRun history (ListScheduledJobRuns). */
		scheduledJobRuns: z
			.array(
				z.object({
					id: z.string(),
					jobId: z.string(),
					sessionId: z.string(),
					status: z.string(),
					startedAt: z.string().nullish(),
					finishedAt: z.string().nullish(),
					summary: z.string().nullish(),
					error: z.string().nullish(),
					runId: z.string().nullish()
				})
			)
			.optional(),
		/** Cross-project LivingTask tree (ListLivingTasks). */
		livingTasks: z
			.array(
				z.object({
					projectId: z.string(),
					displayName: z.string().optional(),
					sessions: z.array(z.unknown()).optional()
				}).passthrough()
			)
			.optional(),
		/** Teams UI — ListTeams. */
		teams: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					kind: z.string(),
					status: z.string(),
					projectId: z.string(),
					workspaceId: z.string().nullish(),
					originGoalId: z.string().nullish(),
					verifierAgentId: z.string().nullish(),
					defaultWorkflowSpec: z.string().nullish(),
					description: z.string().nullish(),
					members: z
						.array(
							z.object({
								name: z.string(),
								teamRole: z.string(),
								agentId: z.string()
							})
						)
						.optional()
				})
			)
			.optional(),
		/** Teams UI — ListGoals. */
		goals: z
			.array(
				z.object({
					id: z.string(),
					status: z.string(),
					name: z.string().nullish(),
					statement: z.string().nullish(),
					acceptance: z.string().nullish(),
					originSessionId: z.string().nullish(),
					controlSessionId: z.string().nullish(),
					teamId: z.string().nullish(),
					projectId: z.string().nullish(),
					currentStepIds: z.array(z.string()).nullish(),
					activeRunIds: z.array(z.string()).nullish(),
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId: z.union([z.string(), z.array(z.string())]).nullish(),
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId: z.union([z.string(), z.array(z.string())]).nullish(),
					confirmedAt: z.string().nullish(),
					resultSummary: z.string().nullish(),
					escalateActions: z.array(z.string()).optional(),
					workflowJson: z.string().nullish(),
					budgetJson: z.string().nullish(),
					progressJson: z.string().nullish(),
					membersJson: z.string().nullish(),
					loopAgentId: z.string().nullish()
				})
			)
			.optional(),
		/** Teams UI — ListAgents. */
		agents: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					status: z.string(),
					projectId: z.string(),
					teamId: z.string().nullish(),
					teamRole: z.string().nullish(),
					model: z.string().nullish(),
					taskBrief: z.string().nullish(),
					declarationJson: z.string().nullish(),
					latestRunId: z.string().nullish()
				})
			)
			.optional(),
		/** Goal snapshot on Goal host command results (ConfirmGoal / PatchGoal / GoalStatus) — ②′ card refresh. */
		goal: z
			.object({
				id: z.string(),
				status: z.string(),
				name: z.string().nullish(),
				statement: z.string().nullish(),
				acceptance: z.string().nullish(),
				originSessionId: z.string().nullish(),
				controlSessionId: z.string().nullish(),
				teamId: z.string().nullish(),
				projectId: z.string().nullish(),
				currentStepIds: z.array(z.string()).nullish(),
				activeRunIds: z.array(z.string()).nullish(),
				/** @deprecated wire dual-read — prefer currentStepIds */
				currentStepId: z.union([z.string(), z.array(z.string())]).nullish(),
				/** @deprecated wire dual-read — prefer activeRunIds */
				activeRunId: z.union([z.string(), z.array(z.string())]).nullish(),
				confirmedAt: z.string().nullish(),
				resultSummary: z.string().nullish(),
				escalateActions: z.array(z.string()).optional(),
				workflowJson: z.string().nullish(),
				budgetJson: z.string().nullish(),
				progressJson: z.string().nullish(),
				membersJson: z.string().nullish(),
				loopAgentId: z.string().nullish()
			})
			.optional(),
		/** Teams UI — CreateTeam / UpdateTeam / GetTeam / Archive*. */
		team: z
			.object({
				id: z.string(),
				name: z.string(),
				kind: z.string(),
				status: z.string(),
				projectId: z.string(),
				workspaceId: z.string().nullish(),
				originGoalId: z.string().nullish(),
				verifierAgentId: z.string().nullish(),
				defaultWorkflowSpec: z.string().nullish(),
				description: z.string().nullish(),
				members: z
					.array(
						z.object({
							name: z.string(),
							teamRole: z.string(),
							agentId: z.string()
						})
					)
					.optional()
			})
			.optional(),
		/** Teams UI — CreateAgent / UpdateAgent / GetAgent / CloneAgent / Archive* / Delete*. */
		agent: z
			.object({
				id: z.string(),
				name: z.string(),
				status: z.string(),
				projectId: z.string(),
				teamId: z.string().nullish(),
				teamRole: z.string().nullish(),
				model: z.string().nullish(),
				taskBrief: z.string().nullish(),
				declarationJson: z.string().nullish(),
				latestRunId: z.string().nullish()
			})
			.optional(),
		/**
		 * Agent change review payload (ListReviewChanges / GetReviewChange / KeepChanges /
		 * PreviewRevert / ApplyRevert / RedoRevert). Which keys are present follows `name` and
		 * `status`: a refusal carries `revision`, `conflicts` or `movedPaths` so the client can resync,
		 * force, or ask for a new preview.
		 */
		review: reviewPayload.optional(),
		/** DshCall method (session.models / settings.describe / …). */
		method: z.string().optional(),
		/** DshCall success — DSH result.value as-is. */
		value: z.unknown().optional(),
		/** DshCall failure — DSH `{ code, message, ... }` as-is. */
		error: z
			.object({
				code: z.string(),
				message: z.string().optional()
			})
			.passthrough()
			.optional()
	}),
	/**
	 * The workspace tree moved (an agent batch, or a restore). Refresh the review drawer, the file-tree
	 * overlay and any open diff; the two trees name what to ask about instead of rescanning.
	 */
	z.object({
		type: z.literal('tree_advanced'),
		pathHash: z.string(),
		fromTree: z.string(),
		toTree: z.string(),
		cause: z.enum(['mutation', 'restore']),
		checkpointId: z.string().optional(),
		restoreId: z.string().optional()
	}),
	/** The review projection moved. `revision` does not change on a keep, so always re-read the list. */
	z.object({type: z.literal('review_changed'), pathHash: z.string(), revision: z.number()}),
	/** Slot working-copy file changed (editor Save / agent / host watcher). */
	z.object({
		type: z.literal('workspace_file_changed'),
		pathHash: z.string(),
		relativePath: z.string(),
		mtime: z.number(),
		origin: z.enum(['client', 'agent', 'watch']),
		connectionId: z.string().optional()
	}),
	z.object({type: z.literal('model_changed'), model: z.string(), modelDisplay: z.string().optional()}),
	z.object({type: z.literal('commands_available'), commands: z.array(commandInfo)}),
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
	z.object({type: z.literal('agent_call_started'), turnId: z.string().optional(), agentId: z.string(), parentAgentId: z.string().optional(), depth: z.number().optional(), name: z.string(), runId: z.string().optional(), parentRunId: z.string().optional(), goalId: z.string().optional(), stepId: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('agent_call_finished'), turnId: z.string().optional(), agentId: z.string(), success: z.boolean(), tokensUsed: z.number().optional(), elapsedMs: z.number().optional(), toolCalls: z.number().optional(), runId: z.string().optional(), detail: z.string().optional(), resultSummary: z.string().optional(), goalId: z.string().optional(), stepId: z.string().optional(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_done'), taskId: z.string(), success: z.boolean(), summary: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_failed'), taskId: z.string(), error: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('task_cancelled'), taskId: z.string(), reason: z.string(), sessionId: z.string().optional()}),
	z.object({type: z.literal('error'), turnId: z.string().optional(), message: z.string(), sessionId: z.string().optional()}),
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
		type: z.literal('sessions_list'),
		sessions: z.array(sessionInfo)
	}),
	z.object({
		/** @deprecated Engine open-set authority removed; prefer workspace_meta */
		type: z.literal('open_project_set'),
		openPaths: z.array(z.string()),
		activePath: z.string().nullish(),
		defaultPath: z.string()
	}),
	z.object({
		/** A settings namespace changed (PatchSettings accepted) — peers re-read via GetSettings. */
		type: z.literal('settings_changed'),
		scope: z.string(),
		scopeId: z.string(),
		namespace: z.string()
	}),
	z.object({
		/** A model provider row changed — peers re-list via ListProviders. */
		type: z.literal('providers_changed'),
		providerId: z.string()
	}),
	z.object({
		/** A skill package changed — peers re-list via ListSkills. */
		type: z.literal('skills_changed'),
		skillName: z.string()
	}),
	z.object({
		type: z.literal('workspace_meta'),
		tenantId: z.string(),
		appId: z.string(),
		projects: z.array(z.object({
			id: z.string(),
			projectType: z.string(),
			displayName: z.string().nullish(),
			status: z.string(),
			isDefault: z.boolean(),
			settings: z.string().nullish(),
			workspace: z.object({
				id: z.string(),
				placement: z.string(),
				rootPath: z.string().nullish(),
				pathHash: z.string().nullish(),
				label: z.string().nullish()
			}).nullish()
		})),
		sessionsByProjectId: z.record(z.string(), z.array(z.object({
			id: z.string(),
			title: z.string().nullish(),
			status: z.string(),
			updatedAt: z.string().nullish(),
			workspaceId: z.string().nullish(),
			startupMode: z.string().nullish()
		})))
	}),
	z.object({
		type: z.literal('agent_timeline'),
		agentId: z.string(),
		parentAgentId: z.string().optional(),
		name: z.string(),
		turns: z.array(restoredTurn),
		children: z.array(z.object({agentId: z.string(), name: z.string()})).optional()
	}),
	z.object({
		type: z.literal('HelloOk'),
		protocolVersion: z.number().optional(),
		engineEpoch: z.string().optional(),
		daemonPid: z.number().optional(),
		serverTimeMillis: z.number().optional(),
		hostHome: z.string().optional(),
		/** Packed `.fast-engine-id` (`<ver> <jre> <UTC>`). Absent on hand-started hosts. */
		engineId: z.string().optional()
	}),
	z.object({
		type: z.literal('HelloReject'),
		code: z.enum(['VERSION_MISMATCH', 'UNAUTHORIZED', 'ENGINE_BUSY', 'INTERNAL']).or(z.string()),
		message: z.string().optional()
	}),
	z.object({
		type: z.literal('daemon_shutting_down'),
		reason: z.string().optional()
	})
]);

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
	'dsh_goal_changed'
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
	'subagent_finished'
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

export const bridgeEventSchema = bridgeEventPayloadSchema.and(eventMeta).superRefine((ev, ctx) => {
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
});

export type BridgeEvent = z.infer<typeof bridgeEventSchema>;

/** Zod codec for outbound Bridge commands (seam 2). */
export const bridgeCommandSchema = z.discriminatedUnion('type', [
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
	z.object({type: z.literal('FetchAgentTimeline'), sessionId: z.string(), agentId: z.string()}),
	z.object({
		type: z.literal('FetchSessionHistory'),
		sessionId: z.string(),
		beforeTurnId: z.string(),
		limit: z.number().optional()
	}),
	z.object({type: z.literal('RegisterWorkspace'), path: z.string()}),
	z.object({type: z.literal('UnregisterWorkspace'), workspaceId: z.string()}),
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
	z.object({type: z.literal('GetOpenProjectSet'), defaultPath: z.string().optional()}),
	z.object({
		type: z.literal('SetOpenProjectSet'),
		openPaths: z.array(z.string()),
		activePath: z.string().optional(),
		defaultPath: z.string().optional()
	}),
	z.object({
		type: z.literal('GetWorkspaceMeta'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateProject'),
		projectType: z.string(),
		rootPath: z.string().optional(),
		displayName: z.string().optional(),
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
	}),
	z.object({
		type: z.literal('UpdateProjectStatus'),
		projectId: z.string(),
		status: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetProjectDisplayName'),
		projectId: z.string(),
		displayName: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListRules'),
		scope: z.string().optional(),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('GetSettings'),
		scope: z.string(),
		scopeId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PatchSettings'),
		scope: z.string(),
		namespace: z.string(),
		patchJson: z.string(),
		scopeId: z.string().optional(),
		schemaVersion: z.number().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListProviders'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpsertProvider'),
		name: z.string(),
		id: z.string().optional(),
		presetKey: z.string().optional(),
		baseUrl: z.string().optional(),
		kind: z.string().optional(),
		metaJson: z.string().optional(),
		credential: z.string().optional(),
		seedModelsJson: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteProvider'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetProviderEnabled'),
		id: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('TestProvider'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PatchProviderModels'),
		id: z.string(),
		patchJson: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SearchProviderModels'),
		id: z.string(),
		query: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListSkills'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateSkill'),
		name: z.string(),
		scope: z.string(),
		template: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteSkill'),
		name: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetSkillEnabled'),
		name: z.string(),
		scope: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SearchSkillMarket'),
		query: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallSkillFromMarket'),
		source: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallSkillFromMarket'),
		name: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListExtensions'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ExtensionStatus'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallExtension'),
		dir: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallExtension'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListEngines'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('EnableEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DisableEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('StartEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('StopEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetDefaultEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CancelEngineInstall'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('AddRule'),
		scope: z.string(),
		text: z.string(),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('RemoveRule'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetRuleEnabled'),
		id: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListScheduledJobs'),
		kind: z.string().optional(),
		sessionId: z.string().optional(),
		projectId: z.string().optional(),
		status: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateScheduledJob'),
		kind: z.string(),
		cronExpr: z.string(),
		timezone: z.string().optional(),
		recurring: z.boolean().optional(),
		targetKind: z.string(),
		targetRef: z.string().optional(),
		promptText: z.string().optional(),
		targetArgsJson: z.string().optional(),
		maxFires: z.number().int().optional(),
		title: z.string().optional(),
		fireImmediately: z.boolean().optional(),
		sessionId: z.string().optional(),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListLivingTasks'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListTeams'),
		projectId: z.string().optional(),
		pathHash: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListGoals'),
		projectId: z.string().optional(),
		status: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListAgents'),
		projectId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional(),
		includeArchived: z.boolean().optional()
	}),
	z.object({
		type: z.literal('CreateTeam'),
		name: z.string(),
		projectId: z.string(),
		description: z.string().optional(),
		workspaceId: z.string().optional(),
		members: z
			.array(
				z.object({
					name: z.string(),
					teamRole: z.string(),
					taskBrief: z.string().optional(),
					model: z.string().optional()
				})
			)
			.optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpdateTeam'),
		teamId: z.string(),
		name: z.string().optional(),
		description: z.string().optional(),
		members: z
			.array(
				z.object({
					name: z.string(),
					teamRole: z.string(),
					taskBrief: z.string().optional(),
					model: z.string().optional()
				})
			)
			.optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ArchiveTeam'),
		teamId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UnarchiveTeam'),
		teamId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteTeam'),
		teamId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SaveAsTeam'),
		sourceTeamId: z.string(),
		name: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PromoteTeam'),
		teamId: z.string(),
		name: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('GetTeam'),
		teamId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateAgent'),
		name: z.string(),
		projectId: z.string(),
		model: z.string().optional(),
		teamRole: z.string().optional(),
		teamId: z.string().optional(),
		taskBrief: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpdateAgent'),
		agentId: z.string(),
		name: z.string().optional(),
		model: z.string().optional(),
		teamRole: z.string().optional(),
		teamId: z.string().optional(),
		taskBrief: z.string().optional(),
		systemPrompt: z.string().optional(),
		maxTurns: z.number().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ArchiveAgent'),
		agentId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UnarchiveAgent'),
		agentId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteAgent'),
		agentId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CloneAgent'),
		sourceId: z.string(),
		teamId: z.string(),
		name: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('GetAgent'),
		agentId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('StopAgentRun'),
		agentId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PauseScheduledJob'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ResumeScheduledJob'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CancelScheduledJob'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('FireNowScheduledJob'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpdateScheduledJobCron'),
		id: z.string(),
		cronExpr: z.string(),
		timezone: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListScheduledJobRuns'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ConfirmGoal'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional(),
		patchJson: z.string().optional()
	}),
	z.object({
		type: z.literal('PatchGoal'),
		goalId: z.string(),
		patchJson: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SteerGoal'),
		goalId: z.string(),
		note: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('GoalStatus'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('EscalateResume'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('EscalateFail'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PauseGoal'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ResumeGoal'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CancelGoal'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteGoal'),
		goalId: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListReviewChanges'),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		checkpointId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('GetReviewChange'),
		changeId: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListReviewDiff'),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional(),
		sinceRevision: z.number().optional()
	}),
	z.object({
		type: z.literal('GetFileReviewDiff'),
		path: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('KeepChanges'),
		changeIds: z.array(z.string()),
		revision: z.number(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('PreviewRevert'),
		target: z.enum(['timeline', 'whole', 'pending', 'changes']),
		revision: z.number(),
		checkpointId: z.string().optional(),
		changeIds: z.array(z.string()).optional(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ApplyRevert'),
		previewId: z.string(),
		force: z.boolean().optional(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('RedoRevert'),
		restoreId: z.string(),
		workspaceId: z.string().optional(),
		sessionId: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListWorkspaceDir'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListHostDir'),
		requestId: z.string(),
		path: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateHostDir'),
		requestId: z.string(),
		parent: z.string(),
		name: z.string()
	}),
	z.object({
		type: z.literal('GetWorkspaceFile'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('SaveWorkspaceFile'),
		requestId: z.string(),
		workspaceId: z.string(),
		relativePath: z.string(),
		content: z.string(),
		mtime: z.number().optional(),
		/** Size paired with mtime for coarse-FS CAS. */
		bytes: z.number().optional(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('GitWorkspaceStatus'),
		requestId: z.string(),
		workspaceId: z.string(),
		tenantId: z.string().optional()
	}),
	z.object({
		type: z.literal('EnsureProject'),
		path: z.string(),
		displayName: z.string().optional(),
		projectType: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('Hello'),
		protocolVersion: z.number(),
		clientId: z.string(),
		clientKind: z.string(),
		clientVersion: z.string().optional(),
		pid: z.number().optional(),
		cwd: z.string().optional(),
		authToken: z.string().optional()
	}),
	z.object({
		type: z.literal('Goodbye'),
		clientId: z.string(),
		reason: z.string().optional()
	}),
	z.object({
		type: z.literal('ClientHeartbeat'),
		clientId: z.string(),
		atMillis: z.number().optional()
	}),
	z.object({type: z.literal('GetDaemonStatus')}),
	z.object({
		type: z.literal('Shutdown'),
		force: z.boolean().optional()
	})
]);

export function parseBridgeCommand(input: unknown): BridgeCommand {
	return bridgeCommandSchema.parse(input) as BridgeCommand;
}

/** Prefer JSON array; dual-read legacy CSV / single string. */
export function wireIdList(raw?: string | string[] | null): string[] {
	if (raw == null) return [];
	if (Array.isArray(raw))
		return [...new Set(raw.map(s => String(s).trim()).filter(Boolean))].sort();
	if (typeof raw !== 'string' || !raw.trim()) return [];
	return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))].sort();
}

export function pickIdList(
	plural?: string | string[] | null,
	singular?: string | string[] | null
): string[] {
	if (plural != null && !(typeof plural === 'string' && !plural.trim()))
		return wireIdList(plural);
	return wireIdList(singular);
}
