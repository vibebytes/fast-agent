import {pickIdList} from '@fastllm/bridge-protocol';
import type {AgentRow, TeamRow} from '@fast-ide/session-view';
import {hostRequest, type CommandResult, type HostLane} from './hostWait.js';

type Notice = {ok: false; notice: string};
type GoalRow = {
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
	currentStepId?: string | string[] | null;
	activeRunId?: string | string[] | null;
	confirmedAt?: string | null;
	createdAt?: string | null;
	resultSummary?: string | null;
	escalateActions?: string[];
	workflowJson?: string | null;
	budgetJson?: string | null;
	progressJson?: string | null;
	loopAgentId?: string | null;
};

export type WorkspaceTeams = {
	listTeams: (projectId?: string | null) => Promise<{ok: true; teams: TeamRow[]} | Notice>;
	listGoals: (
		projectId?: string | null,
		status?: string | null
	) => Promise<{ok: true; goals: GoalRow[]} | Notice>;
	listAgents: (
		projectId?: string | null,
		opts?: {includeArchived?: boolean}
	) => Promise<{ok: true; agents: AgentRow[]} | Notice>;
	createTeam: (input: {
		name: string;
		projectId: string;
		description?: string;
		workspaceId?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}) => Promise<{ok: true; team: TeamRow} | Notice>;
	updateTeam: (input: {
		teamId: string;
		name?: string;
		description?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}) => Promise<{ok: true; team: TeamRow} | Notice>;
	archiveTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | Notice>;
	unarchiveTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | Notice>;
	getTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | Notice>;
	createAgent: (input: {
		name: string;
		projectId: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
	}) => Promise<{ok: true; agent: AgentRow} | Notice>;
	updateAgent: (input: {
		agentId: string;
		name?: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
		systemPrompt?: string;
		maxTurns?: number;
	}) => Promise<{ok: true; agent: AgentRow} | Notice>;
	archiveAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | Notice>;
	unarchiveAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | Notice>;
	cloneAgent: (input: {
		sourceId: string;
		teamId: string;
		name?: string;
	}) => Promise<{ok: true; agent: AgentRow} | Notice>;
	getAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | Notice>;
	deleteTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | Notice>;
	saveAsTeam: (input: {sourceTeamId: string; name?: string}) => Promise<{ok: true; team: TeamRow} | Notice>;
	promoteTeam: (input: {teamId: string; name?: string}) => Promise<{ok: true; team: TeamRow} | Notice>;
	getGoal: (goalId: string) => Promise<{ok: true; goal: GoalRow} | Notice>;
	deleteAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | Notice>;
	stopAgentRun: (agentId: string) => Promise<{ok: true; notice?: string} | Notice>;
	deleteGoal: (
		goalId: string
	) => Promise<{ok: true; goal: {id: string; status: string; name?: string | null; projectId?: string | null}} | Notice>;
};

export function createTeams(lane: HostLane): WorkspaceTeams {
	const enrichTeam = (row: TeamRow): TeamRow => ({...row, ...display(lane, row.projectId)});
	const enrichAgent = (row: AgentRow): AgentRow => ({...row, ...display(lane, row.projectId)});

	const awaitTeam = async (
		req: Promise<{ok: true; event: CommandResult} | Notice>
	): Promise<{ok: true; team: TeamRow} | Notice> => {
		const r = await req;
		if (!r.ok) return r;
		if (r.event.status === 'error') return {ok: false, notice: r.event.message};
		const team = r.event.team;
		if (!team || typeof team !== 'object') return {ok: false, notice: 'No team in result'};
		return {ok: true, team: enrichTeam(team as TeamRow)};
	};

	const awaitAgent = async (
		req: Promise<{ok: true; event: CommandResult} | Notice>
	): Promise<{ok: true; agent: AgentRow} | Notice> => {
		const r = await req;
		if (!r.ok) return r;
		if (r.event.status === 'error') return {ok: false, notice: r.event.message};
		const agent = r.event.agent;
		if (!agent || typeof agent !== 'object') return {ok: false, notice: 'No agent in result'};
		return {ok: true, agent: enrichAgent(agent as AgentRow)};
	};

	const scoped = (projectId?: string | null): {ok: true; metaId?: string} | Notice => {
		const metaId = projectId ? lane.metaId(projectId) : undefined;
		if (projectId && !metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
		return {ok: true, metaId};
	};

	const teamStatus = (type: 'ArchiveTeam' | 'UnarchiveTeam', teamId: string) => {
		const id = teamId.trim();
		if (!id) return Promise.resolve({ok: false as const, notice: 'teamId required'});
		return awaitTeam(hostRequest(lane, [type], {type, teamId: id}));
	};

	const agentStatus = (type: 'ArchiveAgent' | 'UnarchiveAgent', agentId: string) => {
		const id = agentId.trim();
		if (!id) return Promise.resolve({ok: false as const, notice: 'agentId required'});
		return awaitAgent(hostRequest(lane, [type], {type, agentId: id}));
	};

	return {
		async listTeams(projectId) {
			const s = scoped(projectId);
			if (!s.ok) return s;
			const r = await hostRequest(lane, ['ListTeams'], {
				type: 'ListTeams',
				...(s.metaId ? {projectId: s.metaId} : {})
			}, {metaId: s.metaId});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const teams = Array.isArray(r.event.teams) ? r.event.teams : [];
			return {ok: true, teams: teams.map(t => enrichTeam(t as TeamRow))};
		},
		async listGoals(projectId, status) {
			const s = scoped(projectId);
			if (!s.ok) return s;
			const r = await hostRequest(lane, ['ListGoals'], {
				type: 'ListGoals',
				...(s.metaId ? {projectId: s.metaId} : {}),
				...(status?.trim() ? {status: status.trim()} : {})
			}, {metaId: s.metaId});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const goals = Array.isArray(r.event.goals) ? r.event.goals : [];
			return {
				ok: true,
				goals: goals.map(g => {
					const row = g as GoalRow;
					return {
						...row,
						currentStepIds: pickIdList(row.currentStepIds, row.currentStepId),
						activeRunIds: pickIdList(row.activeRunIds, row.activeRunId),
						...display(lane, row.projectId)
					};
				})
			};
		},
		async listAgents(projectId, opts) {
			const s = scoped(projectId);
			if (!s.ok) return s;
			const r = await hostRequest(lane, ['ListAgents'], {
				type: 'ListAgents',
				...(s.metaId ? {projectId: s.metaId} : {}),
				...(opts?.includeArchived ? {includeArchived: true} : {})
			}, {metaId: s.metaId});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const agents = Array.isArray(r.event.agents) ? r.event.agents : [];
			return {ok: true, agents: agents.map(a => enrichAgent(a as AgentRow))};
		},
		async createTeam(input) {
			const name = input.name.trim();
			if (!name) return {ok: false, notice: 'name required'};
			const metaId = lane.metaId(input.projectId);
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			const hasMembers = Boolean(input.members?.length);
			return awaitTeam(
				hostRequest(
					lane,
					['CreateTeam'],
					{
						type: 'CreateTeam',
						name,
						projectId: metaId,
						...(input.description?.trim() ? {description: input.description.trim()} : {}),
						...(input.workspaceId?.trim() ? {workspaceId: input.workspaceId.trim()} : {}),
						...(hasMembers ? {members: input.members} : {})
					},
					{metaId, timeoutMs: hasMembers ? 30_000 : 12_000}
				)
			);
		},
		async updateTeam(input) {
			const teamId = input.teamId.trim();
			if (!teamId) return {ok: false, notice: 'teamId required'};
			return awaitTeam(
				hostRequest(lane, ['UpdateTeam'], {
					type: 'UpdateTeam',
					teamId,
					...(input.name?.trim() ? {name: input.name.trim()} : {}),
					...(input.description !== undefined ? {description: input.description} : {}),
					...(input.members ? {members: input.members} : {})
				})
			);
		},
		archiveTeam: teamId => teamStatus('ArchiveTeam', teamId),
		unarchiveTeam: teamId => teamStatus('UnarchiveTeam', teamId),
		async getTeam(teamId) {
			const id = teamId.trim();
			if (!id) return {ok: false, notice: 'teamId required'};
			return awaitTeam(hostRequest(lane, ['GetTeam'], {type: 'GetTeam', teamId: id}));
		},
		async createAgent(input) {
			const name = input.name.trim();
			if (!name) return {ok: false, notice: 'name required'};
			const metaId = lane.metaId(input.projectId);
			if (!metaId) return {ok: false, notice: 'Project not ready — wait for Engine Meta'};
			return awaitAgent(
				hostRequest(
					lane,
					['CreateAgent'],
					{
						type: 'CreateAgent',
						name,
						projectId: metaId,
						...(input.model?.trim() ? {model: input.model.trim()} : {}),
						...(input.teamRole?.trim() ? {teamRole: input.teamRole.trim()} : {}),
						...(input.teamId?.trim() ? {teamId: input.teamId.trim()} : {}),
						...(input.taskBrief?.trim() ? {taskBrief: input.taskBrief.trim()} : {})
					},
					{metaId}
				)
			);
		},
		async updateAgent(input) {
			const agentId = input.agentId.trim();
			if (!agentId) return {ok: false, notice: 'agentId required'};
			return awaitAgent(
				hostRequest(lane, ['UpdateAgent'], {
					type: 'UpdateAgent',
					agentId,
					...(input.name?.trim() ? {name: input.name.trim()} : {}),
					...(input.model !== undefined ? {model: input.model} : {}),
					...(input.teamRole !== undefined ? {teamRole: input.teamRole} : {}),
					...(input.teamId !== undefined ? {teamId: input.teamId} : {}),
					...(input.taskBrief !== undefined ? {taskBrief: input.taskBrief} : {}),
					...(input.systemPrompt !== undefined ? {systemPrompt: input.systemPrompt} : {}),
					...(input.maxTurns !== undefined ? {maxTurns: input.maxTurns} : {})
				})
			);
		},
		archiveAgent: agentId => agentStatus('ArchiveAgent', agentId),
		unarchiveAgent: agentId => agentStatus('UnarchiveAgent', agentId),
		async cloneAgent(input) {
			const sourceId = input.sourceId.trim();
			const teamId = input.teamId.trim();
			if (!sourceId) return {ok: false, notice: 'sourceId required'};
			if (!teamId) return {ok: false, notice: 'teamId required'};
			return awaitAgent(
				hostRequest(lane, ['CloneAgent'], {
					type: 'CloneAgent',
					sourceId,
					teamId,
					...(input.name?.trim() ? {name: input.name.trim()} : {})
				})
			);
		},
		async getAgent(agentId) {
			const id = agentId.trim();
			if (!id) return {ok: false, notice: 'agentId required'};
			return awaitAgent(hostRequest(lane, ['GetAgent'], {type: 'GetAgent', agentId: id}));
		},
		async deleteTeam(teamId) {
			const id = teamId.trim();
			if (!id) return {ok: false, notice: 'teamId required'};
			return awaitTeam(hostRequest(lane, ['DeleteTeam'], {type: 'DeleteTeam', teamId: id}));
		},
		async saveAsTeam(input) {
			const sourceTeamId = input.sourceTeamId.trim();
			if (!sourceTeamId) return {ok: false, notice: 'sourceTeamId required'};
			return awaitTeam(
				hostRequest(
					lane,
					['SaveAsTeam'],
					{
						type: 'SaveAsTeam',
						sourceTeamId,
						...(input.name?.trim() ? {name: input.name.trim()} : {})
					},
					{timeoutMs: 30_000}
				)
			);
		},
		async promoteTeam(input) {
			const teamId = input.teamId.trim();
			if (!teamId) return {ok: false, notice: 'teamId required'};
			return awaitTeam(
				hostRequest(
					lane,
					['PromoteTeam'],
					{
						type: 'PromoteTeam',
						teamId,
						...(input.name?.trim() ? {name: input.name.trim()} : {})
					},
					{timeoutMs: 30_000}
				)
			);
		},
		async getGoal(goalId) {
			const id = goalId.trim();
			if (!id) return {ok: false, notice: 'goalId required'};
			const r = await hostRequest(lane, ['GoalStatus'], {type: 'GoalStatus', goalId: id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const g = r.event.goal as GoalRow | undefined;
			if (!g?.id) return {ok: false, notice: 'GoalStatus returned no goal'};
			return {
				ok: true,
				goal: {
					...g,
					currentStepIds: pickIdList(g.currentStepIds, g.currentStepId),
					activeRunIds: pickIdList(g.activeRunIds, g.activeRunId),
					...display(lane, g.projectId)
				}
			};
		},
		async deleteAgent(agentId) {
			const id = agentId.trim();
			if (!id) return {ok: false, notice: 'agentId required'};
			return awaitAgent(hostRequest(lane, ['DeleteAgent'], {type: 'DeleteAgent', agentId: id}));
		},
		async stopAgentRun(agentId) {
			const id = agentId.trim();
			if (!id) return {ok: false, notice: 'agentId required'};
			const r = await hostRequest(lane, ['StopAgentRun'], {type: 'StopAgentRun', agentId: id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return {ok: true, notice: r.event.message};
		},
		async deleteGoal(goalId) {
			const id = goalId.trim();
			if (!id) return {ok: false, notice: 'goalId required'};
			const r = await hostRequest(lane, ['DeleteGoal'], {type: 'DeleteGoal', goalId: id});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			const goal = r.event.goal as
				| {id: string; status: string; name?: string | null; projectId?: string | null}
				| undefined;
			if (!goal?.id) return {ok: false, notice: 'No goal in result'};
			return {ok: true, goal};
		}
	};
}

function display(lane: HostLane, metaProjectId?: string | null): {projectDisplayName?: string} {
	const name = lane.displayName(metaProjectId);
	return name ? {projectDisplayName: name} : {};
}
