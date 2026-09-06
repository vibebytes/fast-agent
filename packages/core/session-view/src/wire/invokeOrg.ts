/**
 * Teams / schedule invoke channels.
 */
import type {AgentRow, TeamRow} from './desktop.js';
import type {TaskMutationResult} from './session.js';

export type InvokeOrg = {
	'schedule:list': {
		/** Omit projectId for cross-project ScheduledJob list. */
		args: [projectId?: string | null];
		result:
			| {
					ok: true;
					jobs: Array<{
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						projectDisplayName?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	'schedule:listLiving': {
		args: [];
		result:
			| {
					ok: true;
					projects: Array<{projectId: string; displayName?: string; sessions?: unknown[]}>;
			  }
			| {ok: false; notice: string};
	};
	'schedule:pause': {args: [id: string]; result: TaskMutationResult};
	'schedule:resume': {args: [id: string]; result: TaskMutationResult};
	'schedule:cancel': {args: [id: string]; result: TaskMutationResult};
	'schedule:fireNow': {args: [id: string]; result: TaskMutationResult};
	'schedule:updateCron': {
		args: [id: string, cronExpr: string, timezone?: string];
		result: TaskMutationResult;
	};
	'schedule:listRuns': {
		args: [id: string];
		result:
			| {
					ok: true;
					runs: Array<{
						id: string;
						jobId: string;
						sessionId: string;
						status: string;
						startedAt?: string | null;
						finishedAt?: string | null;
						summary?: string | null;
						error?: string | null;
						runId?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	/**
	 * Create ScheduledJob (Teams Schedule→Goal template, etc.).
	 * projectId = folder id (Hub maps Meta); sessionId required for session_loop;
	 * platform may omit sessionId (Meta mints automation) but needs projectId.
	 */
	'schedule:create': {
		args: [
			input: {
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
			}
		];
		result:
			| {
					ok: true;
					job: {
						id: string;
						kind: string;
						status: string;
						sessionId: string;
						projectId?: string | null;
						projectDisplayName?: string | null;
						cronExpr?: string | null;
						timezone?: string | null;
						nextFireAt?: string | null;
						title?: string | null;
						promptText?: string | null;
						targetKind?: string | null;
						targetRef?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
	/** Teams UI — omit projectId for cross-project lists. */
	'teams:list': {
		args: [projectId?: string | null];
		result: {ok: true; teams: TeamRow[]} | {ok: false; notice: string};
	};
	'teams:listGoals': {
		args: [projectId?: string | null, status?: string | null];
		result:
			| {
					ok: true;
					goals: Array<{
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						acceptance?: string | null;
						originSessionId?: string | null;
						controlSessionId?: string | null;
						teamId?: string | null;
						projectId?: string | null;
						projectDisplayName?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						/** @deprecated wire dual-read — prefer currentStepIds */
						currentStepId?: string | string[] | null;
						/** @deprecated wire dual-read — prefer activeRunIds */
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
						createdAt?: string | null;
						resultSummary?: string | null;
						escalateActions?: string[];
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						loopAgentId?: string | null;
					}>;
			  }
			| {ok: false; notice: string};
	};
	'teams:listAgents': {
		args: [projectId?: string | null, opts?: {includeArchived?: boolean}];
		result: {ok: true; agents: AgentRow[]} | {ok: false; notice: string};
	};
	'teams:getGoal': {
		args: [goalId: string];
		result:
			| {
					ok: true;
					goal: {
						id: string;
						status: string;
						name?: string | null;
						statement?: string | null;
						projectId?: string | null;
						projectDisplayName?: string | null;
						teamId?: string | null;
						originSessionId?: string | null;
						workflowJson?: string | null;
						budgetJson?: string | null;
						progressJson?: string | null;
						currentStepIds?: string[] | null;
						activeRunIds?: string[] | null;
						/** @deprecated wire dual-read — prefer currentStepIds */
						currentStepId?: string | string[] | null;
						/** @deprecated wire dual-read — prefer activeRunIds */
						activeRunId?: string | string[] | null;
						confirmedAt?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
	/** Teams CRUD — args match Bridge CreateTeam / UpdateTeam fields (projectId = folder id; Hub maps Meta). */
	'teams:create': {
		args: [
			input: {
				name: string;
				projectId: string;
				description?: string;
				workspaceId?: string;
				members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			}
		];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:update': {
		args: [
			input: {
				teamId: string;
				name?: string;
				description?: string;
				members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
			}
		];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:archive': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:unarchive': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:get': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:createAgent': {
		args: [
			input: {
				name: string;
				projectId: string;
				model?: string;
				teamRole?: string;
				teamId?: string;
				taskBrief?: string;
			}
		];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:updateAgent': {
		args: [
			input: {
				agentId: string;
				name?: string;
				model?: string;
				teamRole?: string;
				teamId?: string;
				taskBrief?: string;
				systemPrompt?: string;
				maxTurns?: number;
			}
		];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:archiveAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:unarchiveAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:cloneAgent': {
		args: [input: {sourceId: string; teamId: string; name?: string}];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:getAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:delete': {
		args: [teamId: string];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:saveAs': {
		args: [input: {sourceTeamId: string; name?: string}];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:promote': {
		args: [input: {teamId: string; name?: string}];
		result: {ok: true; team: TeamRow} | {ok: false; notice: string};
	};
	'teams:deleteAgent': {
		args: [agentId: string];
		result: {ok: true; agent: AgentRow} | {ok: false; notice: string};
	};
	'teams:stopAgentRun': {
		args: [agentId: string];
		result: {ok: true; notice?: string} | {ok: false; notice: string};
	};
	'teams:deleteGoal': {
		args: [goalId: string];
		result:
			| {
					ok: true;
					goal: {
						id: string;
						status: string;
						name?: string | null;
						projectId?: string | null;
					};
			  }
			| {ok: false; notice: string};
	};
};
