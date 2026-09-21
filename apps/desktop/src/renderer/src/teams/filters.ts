import {
	agentSegmentOf,
	byCreatedDesc,
	goalSegmentOf,
	goalStatusLabel,
	teamListTitle,
	teamSegmentOf,
	type AgentSegment,
	type GoalSegment,
	type TeamSegment
} from '../teamsDisplay';
import type {AgentRow, GoalRow, TeamRow} from './rows';

export function goalNameByIdOf(goals: GoalRow[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const g of goals) {
		const title = g.name?.trim() || g.statement?.trim().slice(0, 40);
		if (title) m.set(g.id, title);
	}
	return m;
}

export function teamNameByIdOf(
	teams: TeamRow[],
	goalNameById: Map<string, string>
): Map<string, string> {
	const m = new Map<string, string>();
	for (const t of teams) m.set(t.id, teamListTitle(t, goalNameById));
	return m;
}

export function agentNameDupOf(agents: AgentRow[]): Set<string> {
	const counts = new Map<string, number>();
	for (const a of agents) {
		const k = a.name.trim().toLowerCase();
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

export function filterGoals(goals: GoalRow[], q: string, goalSegment: GoalSegment): GoalRow[] {
	let list = goals;
	if (goalSegment !== 'all') list = list.filter(g => goalSegmentOf(g.status) === goalSegment);
	if (q) {
		list = list.filter(g =>
			[g.name, g.statement, goalStatusLabel(g.status), g.id]
				.filter(Boolean)
				.some(s => String(s).toLowerCase().includes(q))
		);
	}
	return [...list].sort(byCreatedDesc);
}

export function filterTeams(
	teams: TeamRow[],
	q: string,
	teamSegment: TeamSegment,
	goalNameById: Map<string, string>
): TeamRow[] {
	let list = teams;
	if (teamSegment !== 'all') {
		list = list.filter(t => teamSegmentOf(t.kind, t.status) === teamSegment);
	}
	if (q) {
		list = list.filter(t => {
			const title = teamListTitle(t, goalNameById);
			return [title, t.name, t.kind, t.status, t.id, t.description]
				.filter(Boolean)
				.some(s => String(s).toLowerCase().includes(q));
		});
	}
	return [...list].sort(byCreatedDesc);
}

export function filterAgents(
	agents: AgentRow[],
	q: string,
	agentSegment: AgentSegment,
	teamNameById: Map<string, string>
): AgentRow[] {
	let list = agents;
	if (agentSegment !== 'all') {
		list = list.filter(a => agentSegmentOf(a.status) === agentSegment);
	}
	if (q) {
		list = list.filter(a => {
			const teamTitle = a.teamId ? teamNameById.get(a.teamId) : '';
			return [a.name, a.teamRole, a.model, a.status, a.id, teamTitle]
				.filter(Boolean)
				.some(s => String(s).toLowerCase().includes(q));
		});
	}
	return [...list].sort(byCreatedDesc);
}
