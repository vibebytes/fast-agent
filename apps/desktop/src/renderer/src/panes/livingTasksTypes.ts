import {pickIdList} from '../workflowNodeStatus';

export type LivingRun = {
	runId: string;
	status: string;
	agentId?: string | null;
	parentRunId?: string | null;
};

export type LivingMember = {
	name: string;
	teamRole: string;
	agentId: string;
	runs: LivingRun[];
};

export type LivingTeam = {
	teamId: string;
	name: string;
	members: LivingMember[];
};

export type LivingGoal = {
	goalId: string;
	status: string;
	phase?: string;
	name?: string;
	statement?: string;
	/** In-flight workflow node ids (parallel DAG cursors). */
	currentStepIds?: string[] | null;
	activeRunIds?: string[] | null;
	escalateActions?: string[];
	/** `infra` = model supply fault (Resume retries); `decision` = human decision needed. */
	escalateKind?: 'infra' | 'decision';
	/** Nested Team (ListLivingTasks); null when Goal has no team. */
	team: LivingTeam | null;
};

export type LivingProc = {
	procId: string;
	runId?: string;
	sessionId?: string;
	command?: string;
	status: string;
	outFile?: string;
	mode?: string;
};

export type LivingSubagent = {
	runId: string;
	agentId?: string | null;
	parentRunId?: string | null;
	status: string;
	title?: string | null;
};

export type LivingSession = {
	sessionId: string;
	title?: string;
	projectId: string;
	projectName?: string;
	goals: LivingGoal[];
	procs: LivingProc[];
	subagents: LivingSubagent[];
};

export type LivingProject = {
	projectId: string;
	displayName: string;
	sessions: LivingSession[];
};

function asRun(raw: unknown): LivingRun {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		runId: String(o.runId ?? ''),
		status: String(o.status ?? ''),
		agentId: typeof o.agentId === 'string' ? o.agentId : null,
		parentRunId: typeof o.parentRunId === 'string' ? o.parentRunId : null
	};
}

function asMember(raw: unknown): LivingMember {
	const o = (raw ?? {}) as Record<string, unknown>;
	const runs = Array.isArray(o.runs) ? o.runs.map(asRun) : [];
	return {
		name: String(o.name ?? ''),
		teamRole: String(o.teamRole ?? ''),
		agentId: String(o.agentId ?? ''),
		runs
	};
}

/** Prefer nested `team`; fall back to legacy flat members + teamId/teamName. */
function asGoal(raw: unknown): LivingGoal {
	const o = (raw ?? {}) as Record<string, unknown>;
	let team: LivingTeam | null = null;
	if (o.team && typeof o.team === 'object') {
		const t = o.team as Record<string, unknown>;
		team = {
			teamId: String(t.teamId ?? ''),
			name: String(t.name ?? ''),
			members: Array.isArray(t.members) ? t.members.map(asMember) : []
		};
	} else if (Array.isArray(o.members) && o.members.length > 0) {
		team = {
			teamId: String(o.teamId ?? ''),
			name: typeof o.teamName === 'string' ? o.teamName : '',
			members: o.members.map(asMember)
		};
	}
	return {
		goalId: String(o.goalId ?? ''),
		status: String(o.status ?? ''),
		phase: typeof o.phase === 'string' ? o.phase : undefined,
		statement: typeof o.statement === 'string' ? o.statement : undefined,
		currentStepIds: pickIdList(
			o.currentStepIds as string | string[] | null | undefined,
			o.currentStepId as string | string[] | null | undefined
		),
		activeRunIds: pickIdList(
			o.activeRunIds as string | string[] | null | undefined,
			o.activeRunId as string | string[] | null | undefined
		),
		escalateActions: Array.isArray(o.escalateActions)
			? o.escalateActions.map(String)
			: undefined,
		escalateKind:
			o.escalateKind === 'infra' || o.escalateKind === 'decision' ? o.escalateKind : undefined,
		team
	};
}

function asProc(raw: unknown): LivingProc {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		procId: String(o.procId ?? ''),
		runId: typeof o.runId === 'string' ? o.runId : undefined,
		sessionId: typeof o.sessionId === 'string' ? o.sessionId : undefined,
		command: typeof o.command === 'string' ? o.command : undefined,
		status: String(o.status ?? ''),
		outFile: typeof o.outFile === 'string' ? o.outFile : undefined,
		mode: typeof o.mode === 'string' ? o.mode : undefined
	};
}

function asSubagent(raw: unknown): LivingSubagent {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		runId: String(o.runId ?? ''),
		agentId: typeof o.agentId === 'string' ? o.agentId : null,
		parentRunId: typeof o.parentRunId === 'string' ? o.parentRunId : null,
		status: String(o.status ?? ''),
		title: typeof o.title === 'string' ? o.title : null
	};
}

export function asLivingProjects(raw: unknown[]): LivingProject[] {
	return raw.map(p => {
		const o = p as Record<string, unknown>;
		const sessions = Array.isArray(o.sessions) ? o.sessions : [];
		return {
			projectId: String(o.projectId ?? ''),
			displayName: String(o.displayName ?? o.projectId ?? ''),
			sessions: sessions.map(s => {
				const x = s as Record<string, unknown>;
				return {
					sessionId: String(x.sessionId ?? ''),
					title: typeof x.title === 'string' ? x.title : '',
					projectId: String(x.projectId ?? o.projectId ?? ''),
					projectName: typeof x.projectName === 'string' ? x.projectName : undefined,
					goals: Array.isArray(x.goals) ? x.goals.map(asGoal) : [],
					procs: Array.isArray(x.procs) ? x.procs.map(asProc) : [],
					subagents: Array.isArray(x.subagents) ? x.subagents.map(asSubagent) : []
				};
			})
		};
	});
}
