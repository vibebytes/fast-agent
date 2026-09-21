import {cn} from '@fast-ide/ui/lib/utils';
import {Flag} from 'lucide-react';
import {shellT} from '../i18n/t';
import {
	agentListTitle,
	agentStatusLabel,
	goalStatusChipClass,
	goalStatusLabel,
	listCreatedLabel,
	roleLabel,
	shortId,
	teamKindLabel,
	teamListTitle,
	teamStatusLabel
} from '../teamsDisplay';
import {projectChip, type AgentRow, type GoalRow, type TeamRow} from './rows';

export function ListRows(p: Record<string, any>) {
	const {
		tab, busy, filteredGoals, filteredTeams, filteredAgents, pageSlice,
		selectedGoalId, selectedTeamId, selectedAgentId, setSelectedGoalId, setSelectedTeamId,
		setSelectedAgentId, teamSegment, agentSegment, goalNameById, teamNameById, agentNameDup
	} = p;
	return (
					<ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
						{tab === 'goals' && filteredGoals.length === 0 && !busy ? (
							<li className="px-3 py-8 text-center text-sm text-muted-foreground">
								{shellT('shell.teams.noGoals')}
								<p className="mt-1 text-[11px]">{shellT('shell.teams.noGoalsHint')}</p>
							</li>
						) : null}
						{tab === 'goals'
							? (pageSlice as GoalRow[]).map(g => {
									const title =
										g.name?.trim() || g.statement?.slice(0, 48) || shortId(g.id, 8);
									const created = listCreatedLabel(g.createdAt);
									return (
										<li key={g.id}>
											<button
												type="button"
												className={cn(
													'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
													selectedGoalId === g.id && 'bg-muted'
												)}
												onClick={() => setSelectedGoalId(g.id)}
											>
												<div className="flex items-start gap-2">
													<Flag className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
													<span className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2">
														{title}
													</span>
													<span
														className={cn(
															'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
															goalStatusChipClass(g.status)
														)}
													>
														{goalStatusLabel(g.status)}
													</span>
												</div>
												<div className="flex items-center gap-2 pl-5 text-[11px] text-muted-foreground">
													<span className="min-w-0 truncate">
														{projectChip(g.projectId, g.projectDisplayName)}
													</span>
													{created ? (
														<span className="ml-auto shrink-0 tabular-nums">{created}</span>
													) : null}
												</div>
											</button>
										</li>
									);
								})
							: null}

						{tab === 'teams' && filteredTeams.length === 0 && !busy ? (
							<li className="px-3 py-8 text-center text-sm text-muted-foreground">
								{teamSegment === 'all'
									? shellT('shell.teams.noTeams')
									: teamSegment === 'explicit'
										? shellT('shell.teams.noStandingTeams')
										: teamSegment === 'ephemeral'
											? shellT('shell.teams.noTempTeams')
											: shellT('shell.teams.noArchivedTeams')}
								<p className="mt-1 text-[11px]">
									{teamSegment === 'ephemeral'
										? shellT('shell.teams.tempTeamsHint')
										: shellT('shell.teams.createTeamHint')}
								</p>
							</li>
						) : null}
						{tab === 'teams'
							? (pageSlice as TeamRow[]).map(t => {
									const title = teamListTitle(t, goalNameById);
									const n = t.members?.length ?? 0;
									const created = listCreatedLabel(t.createdAt);
									return (
										<li key={t.id}>
											<button
												type="button"
												className={cn(
													'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
													selectedTeamId === t.id && 'bg-muted'
												)}
												onClick={() => setSelectedTeamId(t.id)}
											>
												<div className="flex items-start gap-2">
													<span className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2">
														{title}
													</span>
													<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{teamKindLabel(t.kind)}
													</span>
												</div>
												<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
													<span className="min-w-0 truncate">
														{projectChip(t.projectId, t.projectDisplayName)} · {shellT('shell.teams.peopleStatus', {count: n, status: teamStatusLabel(t.status)})}
													</span>
													{created ? (
														<span className="ml-auto shrink-0 tabular-nums">{created}</span>
													) : null}
												</div>
											</button>
										</li>
									);
								})
							: null}

						{tab === 'agents' && filteredAgents.length === 0 && !busy ? (
							<li className="px-3 py-8 text-center text-sm text-muted-foreground">
								{agentSegment === 'all'
									? shellT('shell.teams.noAgents')
									: agentSegment === 'active'
										? shellT('shell.teams.noActiveAgents')
										: shellT('shell.teams.noArchivedAgents')}
								<p className="mt-1 text-[11px]">{shellT('shell.teams.createAgentHint')}</p>
							</li>
						) : null}
						{tab === 'agents'
							? (pageSlice as AgentRow[]).map(a => {
									const dup = agentNameDup.has(a.name.trim().toLowerCase());
									const teamTitle = a.teamId ? teamNameById.get(a.teamId) : null;
									const created = listCreatedLabel(a.createdAt);
									return (
										<li key={a.id}>
											<button
												type="button"
												className={cn(
													'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
													selectedAgentId === a.id && 'bg-muted'
												)}
												onClick={() => setSelectedAgentId(a.id)}
											>
												<div className="flex items-center gap-2">
													<span className="truncate text-sm font-medium">
														{agentListTitle(a.name, a.id, dup)}
													</span>
													<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
														{agentStatusLabel(a.status)}
													</span>
												</div>
												<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
													<span className="min-w-0 truncate">
														{projectChip(a.projectId, a.projectDisplayName)}
														{a.teamRole ? ` · ${roleLabel(a.teamRole)}` : ''}
														{teamTitle ? ` · ${teamTitle}` : shellT('shell.teams.notInTeam')}
													</span>
													{created ? (
														<span className="ml-auto shrink-0 tabular-nums">{created}</span>
													) : null}
												</div>
											</button>
										</li>
									);
								})
							: null}
					</ul>

	);
}
