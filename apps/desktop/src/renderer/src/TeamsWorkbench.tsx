import {shellT} from './i18n/t';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {AlertCircle, ChevronLeft, ChevronRight, Flag, Plus, RefreshCw, Users} from 'lucide-react';
import {budgetDisplayLines, type AgentSegment, type GoalSegment, type TeamSegment} from './teamsDisplay';
import {parseWorkflowSteps} from './WorkflowReadonly';
import {goalProgress} from './goalProgress';
import {TEAMS_LIST_PAGE_SIZE, clampPage, pageIndexForId} from './teamsListPaging';
import {createTeamActions} from './teams/actions';
import {AgentDetail} from './teams/AgentDetail';
import {
	agentNameDupOf,
	filterAgents,
	filterGoals,
	filterTeams,
	goalNameByIdOf,
	teamNameByIdOf
} from './teams/filters';
import {GoalDetail} from './teams/GoalDetail';
import {ListRows} from './teams/ListRows';
import {TeamDetail} from './teams/TeamDetail';
import type {AgentRow, GoalRow, TeamRow} from './teams/rows';

export type TeamsTab = 'teams' | 'agents' | 'goals';

export type OpenTeamsRequest = {
	nonce: number;
	tab?: TeamsTab;
	teamId?: string;
	agentId?: string;
	goalId?: string;
};

/**
 * Middle-pane Teams workbench (centerMode=teams). Three tabs; Teams default.
 * Pull-on-open; Pause/Cancel/Steer reuse goal:*; Team/Agent CRUD via teams:*.
 */
export function TeamsWorkbench({
	openRequest,
	focusProjectId,
	onOpenLivingSession,
	onInsertMention,
	onCreateWithSlash,
	onOpenScheduled
}: {
	openRequest?: OpenTeamsRequest | null;
	/** Folder project id for create (default focus). */
	focusProjectId?: string | null;
	onOpenLivingSession?: (sessionId: string, metaProjectId?: string | null) => void;
	onInsertMention?: (
		kind: string,
		locator: string,
		displayName?: string,
		/** Meta project id — createTask focuses the owning Project so Mentions Tier.C resolves. */
		metaProjectId?: string | null
	) => void | Promise<void>;
	/** New dialogue + `/team` or `/agent` SkillSlash (no transitional banner). */
	onCreateWithSlash?: (name: 'team' | 'agent') => void | Promise<void>;
	onOpenScheduled?: () => void;
}) {
	const [tab, setTab] = useState<TeamsTab>('teams');
	const [teams, setTeams] = useState<TeamRow[]>([]);
	const [goals, setGoals] = useState<GoalRow[]>([]);
	const [agents, setAgents] = useState<AgentRow[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [actionBusy, setActionBusy] = useState(false);
	const [query, setQuery] = useState('');
	const [goalSegment, setGoalSegment] = useState<GoalSegment>('all');
	const [teamSegment, setTeamSegment] = useState<TeamSegment>('all');
	const [agentSegment, setAgentSegment] = useState<AgentSegment>('all');
	const [steerNote, setSteerNote] = useState('');
	const [cloneTeamId, setCloneTeamId] = useState('');
	const [scheduleCron, setScheduleCron] = useState('0 9 * * 1-5');
	const [scheduleTz, setScheduleTz] = useState(
		Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
	);
	const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
	const [listPage, setListPage] = useState(0);

	useEffect(() => {
		setExpandedMemberId(null);
	}, [selectedTeamId, selectedGoalId]);

	// Filters / tab change → back to first page.
	useEffect(() => {
		setListPage(0);
	}, [tab, query, goalSegment, teamSegment, agentSegment]);

	const refresh = useCallback(async () => {
		setBusy(true);
		setNotice(null);
		try {
			const [t, g, a] = await Promise.all([
				window.fastIde.listTeams(),
				window.fastIde.listGoals(),
				// Always pull archived so segment pills can filter client-side (same as Teams).
				window.fastIde.listAgents(null, {includeArchived: true})
			]);
			const errs: string[] = [];
			if (!t.ok) errs.push(t.notice);
			else setTeams(t.teams);
			if (!g.ok) errs.push(g.notice);
			else setGoals(g.goals);
			if (!a.ok) errs.push(a.notice);
			else setAgents(a.agents);
			if (errs.length) setNotice(errs.join(' · '));
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!openRequest) return;
		if (openRequest.tab) setTab(openRequest.tab);
		if (openRequest.goalId) {
			setTab('goals');
			setSelectedGoalId(openRequest.goalId);
		}
		if (openRequest.teamId) {
			setTab('teams');
			setSelectedTeamId(openRequest.teamId);
		}
		if (openRequest.agentId) {
			setTab('agents');
			setSelectedAgentId(openRequest.agentId);
		}
		void (async () => {
			await refresh();
			const errs: string[] = [];
			if (openRequest.goalId) {
				const gid = openRequest.goalId;
				const listed = await window.fastIde.listGoals();
				if (!(listed.ok && listed.goals.some(g => g.id === gid))) {
					const r = await window.fastIde.getGoal(gid);
					if (r.ok) {
						setGoals(prev =>
							prev.some(g => g.id === r.goal.id) ? prev : [r.goal, ...prev]
						);
						setSelectedGoalId(r.goal.id);
					} else errs.push(`Goal: ${r.notice}`);
				}
			}
			if (openRequest.teamId) {
				const tid = openRequest.teamId;
				const listed = await window.fastIde.listTeams();
				if (!(listed.ok && listed.teams.some(t => t.id === tid))) {
					const r = await window.fastIde.getTeam(tid);
					if (r.ok) {
						setTeams(prev =>
							prev.some(t => t.id === r.team.id) ? prev : [r.team, ...prev]
						);
						setSelectedTeamId(r.team.id);
					} else errs.push(`Team: ${r.notice}`);
				}
			}
			if (openRequest.agentId) {
				const aid = openRequest.agentId;
				const listed = await window.fastIde.listAgents(null, {includeArchived: true});
				if (!(listed.ok && listed.agents.some(a => a.id === aid))) {
					const r = await window.fastIde.getAgent(aid);
					if (r.ok) {
						setAgents(prev =>
							prev.some(a => a.id === r.agent.id) ? prev : [r.agent, ...prev]
						);
						setSelectedAgentId(r.agent.id);
					} else errs.push(`Agent: ${r.notice}`);
				}
			}
			if (errs.length) setNotice(errs.join(' · '));
		})();
	}, [openRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		let t: number | undefined;
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const typ = (payload.event as {type?: string}).type;
			if (typ !== 'goal_updated' && typ !== 'task_updated') return;
			window.clearTimeout(t);
			t = window.setTimeout(() => void refresh(), 400);
		});
		return () => {
			unsub();
			window.clearTimeout(t);
		};
	}, [refresh]);

	const selectedGoal = useMemo(
		() => goals.find(g => g.id === selectedGoalId) ?? null,
		[goals, selectedGoalId]
	);
	const selectedTeam = useMemo(
		() => teams.find(t => t.id === selectedTeamId) ?? null,
		[teams, selectedTeamId]
	);
	const selectedAgent = useMemo(
		() => agents.find(a => a.id === selectedAgentId) ?? null,
		[agents, selectedAgentId]
	);

	const workflowSteps = useMemo(() => {
		if (tab === 'goals') return parseWorkflowSteps(selectedGoal?.workflowJson);
		if (tab === 'teams') return parseWorkflowSteps(selectedTeam?.defaultWorkflowSpec);
		return [];
	}, [tab, selectedGoal?.workflowJson, selectedTeam?.defaultWorkflowSpec]);

	const progress = useMemo(
		() => (tab === 'goals' ? goalProgress(selectedGoal?.progressJson) : goalProgress(null)),
		[tab, selectedGoal?.progressJson]
	);

	const goalNameById = useMemo(() => goalNameByIdOf(goals), [goals]);
	const teamNameById = useMemo(() => teamNameByIdOf(teams, goalNameById), [teams, goalNameById]);
	const agentNameDup = useMemo(() => agentNameDupOf(agents), [agents]);
	const q = query.trim().toLowerCase();
	const filteredGoals = useMemo(() => filterGoals(goals, q, goalSegment), [goals, q, goalSegment]);
	const filteredTeams = useMemo(
		() => filterTeams(teams, q, teamSegment, goalNameById),
		[teams, q, teamSegment, goalNameById]
	);
	const filteredAgents = useMemo(
		() => filterAgents(agents, q, agentSegment, teamNameById),
		[agents, q, teamNameById, agentSegment]
	);

	const filteredList =
		tab === 'goals' ? filteredGoals : tab === 'teams' ? filteredTeams : filteredAgents;
	const selectedListId =
		tab === 'goals' ? selectedGoalId : tab === 'teams' ? selectedTeamId : selectedAgentId;
	const totalPages = Math.max(1, Math.ceil(filteredList.length / TEAMS_LIST_PAGE_SIZE) || 1);
	const safePage = clampPage(listPage, filteredList.length, TEAMS_LIST_PAGE_SIZE);
	useEffect(() => {
		if (listPage !== safePage) setListPage(safePage);
	}, [listPage, safePage]);
	const pageSlice = useMemo(() => {
		const start = safePage * TEAMS_LIST_PAGE_SIZE;
		return filteredList.slice(start, start + TEAMS_LIST_PAGE_SIZE);
	}, [filteredList, safePage]);

	// Keep selection valid; auto-pick first row when empty (avoid blank detail pane).
	useEffect(() => {
		if (tab === 'goals' && filteredGoals.length > 0) {
			if (!selectedGoalId || !filteredGoals.some(g => g.id === selectedGoalId)) {
				setSelectedGoalId(filteredGoals[0]!.id);
				setListPage(0);
			}
		}
		if (tab === 'teams' && filteredTeams.length > 0) {
			if (!selectedTeamId || !filteredTeams.some(t => t.id === selectedTeamId)) {
				setSelectedTeamId(filteredTeams[0]!.id);
				setListPage(0);
			}
		}
		if (tab === 'agents' && filteredAgents.length > 0) {
			if (!selectedAgentId || !filteredAgents.some(a => a.id === selectedAgentId)) {
				setSelectedAgentId(filteredAgents[0]!.id);
				setListPage(0);
			}
		}
	}, [
		tab,
		filteredGoals,
		filteredTeams,
		filteredAgents,
		selectedGoalId,
		selectedTeamId,
		selectedAgentId
	]);

	// Selection change (incl. deep-link): jump to the page that contains it.
	// Do not depend on filteredList — otherwise Prev/Next would snap back to the selected row's page.
	useEffect(() => {
		if (!selectedListId) return;
		const list: Array<{id: string}> =
			tab === 'goals' ? filteredGoals : tab === 'teams' ? filteredTeams : filteredAgents;
		if (list.length === 0) return;
		const want = pageIndexForId(list, selectedListId, TEAMS_LIST_PAGE_SIZE);
		setListPage(want);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection/tab
	}, [tab, selectedGoalId, selectedTeamId, selectedAgentId]);

	const {
		goalAction,
		onSteer,
		startCreate,
		onArchiveTeam,
		onArchiveAgent,
		onCloneAgent,
		onScheduleGoal,
		onDeleteTeam,
		onSaveAsTeam,
		onPromoteTeam,
		onDeleteAgent,
		onStopAgentRun,
		onDeleteGoal
	} = createTeamActions({
		setActionBusy,
		setNotice,
		refresh,
		setSteerNote,
		steerNote,
		onCreateWithSlash,
		focusProjectId,
		scheduleCron,
		scheduleTz,
		onOpenScheduled,
		cloneTeamId,
		selectedTeamId,
		setSelectedTeamId,
		setSelectedAgentId,
		setSelectedGoalId,
		setTeamSegment,
		goalNameById
	});

	const budget = budgetDisplayLines(selectedGoal?.budgetJson, selectedGoal?.progressJson);

	function openWorkflowAgent(use: string, teamId?: string | null) {
		const hit =
			agents.find(
				a =>
					(teamId ? a.teamId === teamId : true) &&
					(a.name === use || a.teamRole === use)
			) ?? agents.find(a => a.name === use || a.teamRole === use);
		if (hit) {
			setSelectedAgentId(hit.id);
			setTab('agents');
		}
	}

	const tabLabel = (id: TeamsTab) =>
		id === 'teams' ? 'Teams' : id === 'agents' ? 'Agents' : 'Goals';

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
				<div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
					<Users className="size-4 opacity-70" />
					Teams
				</div>
				<div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
					{(['teams', 'agents', 'goals'] as const).map(id => (
						<button
							key={id}
							type="button"
							className={cn(
								'rounded px-2.5 py-1 text-xs font-medium transition-colors',
								tab === id
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'
							)}
							onClick={() => setTab(id)}
						>
							{tabLabel(id)}
						</button>
					))}
				</div>
				<input
					className="h-8 min-w-[140px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs"
					placeholder={
						tab === 'goals'
							? shellT('shell.teams.searchGoals')
							: tab === 'teams'
								? shellT('shell.teams.searchTeams')
								: shellT('shell.teams.searchAgents')
					}
					value={query}
					onChange={e => setQuery(e.target.value)}
				/>
				{(tab === 'teams' || tab === 'agents') && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={actionBusy}
						onClick={() => void startCreate(tab === 'teams' ? 'team' : 'agent')}
					>
						<Plus className="size-3.5" />
						{shellT('shell.teams.new')}
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={busy}
					aria-label={shellT('shell.teams.refresh')}
					onClick={() => void refresh()}
				>
					<RefreshCw className={cn('size-4', busy && 'animate-spin')} />
				</Button>
			</header>

			{notice ? (
				<div className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					<AlertCircle className="mt-0.5 size-3.5 shrink-0" />
					<span className="flex-1">{notice}</span>
					<Button type="button" size="sm" variant="ghost" onClick={() => setNotice(null)}>
						{shellT('shell.teams.close')}
					</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
						{shellT('shell.teams.retry')}
					</Button>
				</div>
			) : null}

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-[300px] shrink-0 flex-col border-r border-border md:w-[340px]">
					{tab === 'goals' ? (
						<div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
							{(
								[
									['all', shellT('shell.teams.segAll')],
									['awaiting', shellT('shell.teams.segAwaiting')],
									['active', shellT('shell.teams.segActive')],
									['done', shellT('shell.teams.segDone')]
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									className={cn(
										'shrink-0 rounded-full px-2.5 py-0.5 text-[11px]',
										goalSegment === id
											? 'bg-foreground text-background'
											: 'text-muted-foreground hover:bg-muted'
									)}
									onClick={() => setGoalSegment(id)}
								>
									{label}
								</button>
							))}
						</div>
					) : null}
					{tab === 'teams' ? (
						<div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
							{(
								[
									['all', shellT('shell.teams.segAll')],
									['explicit', shellT('shell.teams.segExplicit')],
									['ephemeral', shellT('shell.teams.segEphemeral')],
									['archived', shellT('shell.teams.segArchived')]
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									className={cn(
										'shrink-0 rounded-full px-2.5 py-0.5 text-[11px]',
										teamSegment === id
											? 'bg-foreground text-background'
											: 'text-muted-foreground hover:bg-muted'
									)}
									onClick={() => setTeamSegment(id)}
								>
									{label}
								</button>
							))}
						</div>
					) : null}
					{tab === 'agents' ? (
						<div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
							{(
								[
									['all', shellT('shell.teams.segAll')],
									['active', shellT('shell.teams.segAgentActive')],
									['archived', shellT('shell.teams.segArchived')]
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									className={cn(
										'shrink-0 rounded-full px-2.5 py-0.5 text-[11px]',
										agentSegment === id
											? 'bg-foreground text-background'
											: 'text-muted-foreground hover:bg-muted'
									)}
									onClick={() => setAgentSegment(id)}
								>
									{label}
								</button>
							))}
						</div>
					) : null}
					<ListRows
						{...{
							tab,
							busy,
							filteredGoals,
							filteredTeams,
							filteredAgents,
							pageSlice,
							selectedGoalId,
							selectedTeamId,
							selectedAgentId,
							setSelectedGoalId,
							setSelectedTeamId,
							setSelectedAgentId,
							teamSegment,
							agentSegment,
							goalNameById,
							teamNameById,
							agentNameDup
						}}
					/>
					{filteredList.length > 0 ? (
						<div className="flex items-center gap-1 border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
							<span className="min-w-0 flex-1 truncate">
								{shellT('shell.teams.pageStatus', {count: filteredList.length, page: safePage + 1, total: totalPages})}
							</span>
							<Button
								type="button"
								size="xs"
								variant="ghost"
								disabled={safePage <= 0}
								aria-label={shellT('shell.teams.prevPage')}
								onClick={() => setListPage(safePage - 1)}
							>
								<ChevronLeft className="size-3.5" />
							</Button>
							<Button
								type="button"
								size="xs"
								variant="ghost"
								disabled={safePage >= totalPages - 1}
								aria-label={shellT('shell.teams.nextPage')}
								onClick={() => setListPage(safePage + 1)}
							>
								<ChevronRight className="size-3.5" />
							</Button>
						</div>
					) : null}
				</aside>

				<section className="min-w-0 flex-1 overflow-y-auto p-5">
					{tab === 'goals' && selectedGoal ? (
						<GoalDetail
							{...{
								selectedGoal,
								teams,
								agents,
								teamNameById,
								workflowSteps,
								progress,
								budget,
								actionBusy,
								steerNote,
								setSteerNote,
								scheduleCron,
								setScheduleCron,
								scheduleTz,
								setScheduleTz,
								expandedMemberId,
								setExpandedMemberId,
								goalAction,
								onSteer,
								onScheduleGoal,
								onDeleteGoal,
								onOpenLivingSession,
								onInsertMention,
								openWorkflowAgent,
								setTab,
								setSelectedTeamId
							}}
						/>
					) : null}

					{tab === 'teams' && selectedTeam ? (
						<TeamDetail
							{...{
								selectedTeam,
								agents,
								goalNameById,
								workflowSteps,
								actionBusy,
								expandedMemberId,
								setExpandedMemberId,
								onPromoteTeam,
								onArchiveTeam,
								onSaveAsTeam,
								onDeleteTeam,
								onInsertMention,
								openWorkflowAgent,
								startCreate
							}}
						/>
					) : null}

					{tab === 'agents' && selectedAgent ? (
						<AgentDetail
							{...{
								selectedAgent,
								teams,
								teamNameById,
								goalNameById,
								agentNameDup,
								actionBusy,
								cloneTeamId,
								setCloneTeamId,
								selectedTeamId,
								setSelectedTeamId,
								setTab,
								onCloneAgent,
								onStopAgentRun,
								onArchiveAgent,
								onDeleteAgent,
								onInsertMention
							}}
						/>
					) : null}

					{!selectedGoal && tab === 'goals' && !busy ? (
						<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
							<Flag className="size-8 opacity-30" />
							<p>{shellT('shell.teams.pickGoal')}</p>
							<p className="text-[11px]">{shellT('shell.teams.pickGoalHint')}</p>
						</div>
					) : null}
					{!selectedTeam && tab === 'teams' && !busy ? (
						<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
							<Users className="size-8 opacity-30" />
							<p>{shellT('shell.teams.pickTeam')}</p>
						</div>
					) : null}
					{!selectedAgent && tab === 'agents' && !busy ? (
						<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
							<p>{shellT('shell.teams.pickAgent')}</p>
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}
