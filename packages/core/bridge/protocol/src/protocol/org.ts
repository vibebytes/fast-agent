import {z} from 'zod';

export type OrgCommand =
	{
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
	| {type: 'GoalStatus'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'EscalateResume'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'EscalateFail'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'PauseGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'ResumeGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'CancelGoal'; goalId: string; tenantId?: string; appId?: string}
	| {type: 'DeleteGoal'; goalId: string; tenantId?: string; appId?: string}

export const orgCommandSchemas = [
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
	})
] as const
