import {shellT} from './i18n/t';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	AlertCircle,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	Flag,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Square,
	Users
} from 'lucide-react';
import {
	agentListTitle,
	agentStatusLabel,
	budgetDisplayLines,
	agentSegmentOf,
	byCreatedDesc,
	goalSegmentOf,
	goalStatusChipClass,
	goalStatusLabel,
	listCreatedLabel,
	roleLabel,
	shortId,
	teamKindLabel,
	teamListTitle,
	teamSegmentOf,
	teamStatusLabel,
	type AgentSegment,
	type GoalSegment,
	type TeamSegment
} from './teamsDisplay';
import {parseWorkflowSteps, WorkflowReadonly} from './WorkflowReadonly';
import {goalProgress} from './goalProgress';
import {TEAMS_LIST_PAGE_SIZE, clampPage, pageIndexForId} from './teamsListPaging';

export type TeamsTab = 'teams' | 'agents' | 'goals';

export type OpenTeamsRequest = {
	nonce: number;
	tab?: TeamsTab;
	teamId?: string;
	agentId?: string;
	goalId?: string;
};

type TeamRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	members?: Array<{name: string; teamRole: string; agentId: string}>;
	originGoalId?: string | null;
	defaultWorkflowSpec?: string | null;
	description?: string | null;
	createdAt?: string | null;
};

type GoalRow = {
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
	/** In-flight workflow node ids (parallel DAG cursors). */
	currentStepIds?: string[] | null;
	/** @deprecated wire dual-read — prefer currentStepIds */
	currentStepId?: string | string[] | null;
	confirmedAt?: string | null;
	createdAt?: string | null;
};

type AgentRow = {
	id: string;
	name: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	teamId?: string | null;
	teamRole?: string | null;
	model?: string | null;
	taskBrief?: string | null;
	declarationJson?: string | null;
	latestRunId?: string | null;
	createdAt?: string | null;
};

function agentPrompt(a?: AgentRow | null): {
	systemPrompt: string;
	maxTurns?: number;
	model?: string;
} {
	if (!a) return {systemPrompt: ''};
	try {
		const d = a.declarationJson?.trim()
			? (JSON.parse(a.declarationJson) as Record<string, unknown>)
			: {};
		return {
			systemPrompt: typeof d.systemPrompt === 'string' ? d.systemPrompt : '',
			maxTurns: typeof d.maxTurns === 'number' ? d.maxTurns : undefined,
			model:
				(typeof d.model === 'string' ? d.model : undefined) || a.model || undefined
		};
	} catch {
		return {systemPrompt: '', model: a.model || undefined};
	}
}

function projectChip(projectId?: string | null, displayName?: string | null): string {
	const label = displayName?.trim() || projectId?.trim();
	return label ? label : shellT('shell.teams.ungrouped');
}

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

	const goalNameById = useMemo(() => {
		const m = new Map<string, string>();
		for (const g of goals) {
			const title = g.name?.trim() || g.statement?.trim().slice(0, 40);
			if (title) m.set(g.id, title);
		}
		return m;
	}, [goals]);

	const teamNameById = useMemo(() => {
		const m = new Map<string, string>();
		for (const t of teams) m.set(t.id, teamListTitle(t, goalNameById));
		return m;
	}, [teams, goalNameById]);

	const agentNameDup = useMemo(() => {
		const counts = new Map<string, number>();
		for (const a of agents) {
			const k = a.name.trim().toLowerCase();
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
	}, [agents]);

	const q = query.trim().toLowerCase();
	const filteredGoals = useMemo(() => {
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
	}, [goals, q, goalSegment]);
	const filteredTeams = useMemo(() => {
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
	}, [teams, q, teamSegment, goalNameById]);
	const filteredAgents = useMemo(() => {
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
	}, [agents, q, teamNameById, agentSegment]);

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

	async function goalAction(kind: 'pause' | 'resume' | 'cancel', goalId: string) {
		setActionBusy(true);
		try {
			if (kind === 'pause') await window.fastIde.pauseGoal(goalId);
			else if (kind === 'resume') await window.fastIde.resumeGoal(goalId);
			else await window.fastIde.cancelGoal(goalId);
			await refresh();
		} finally {
			setActionBusy(false);
		}
	}

	async function onSteer(goalId: string) {
		const note = steerNote.trim();
		if (!note) return;
		setActionBusy(true);
		try {
			const ok = await window.fastIde.steerGoal(note, goalId);
			if (!ok) setNotice(shellT('shell.teams.steerFailed'));
			else {
				setSteerNote('');
				setNotice(shellT('shell.teams.steerOk'));
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function startCreate(name: 'team' | 'agent') {
		if (!onCreateWithSlash) {
			setNotice(shellT('shell.teams.createHint', {name}));
			return;
		}
		setActionBusy(true);
		try {
			await onCreateWithSlash(name);
		} finally {
			setActionBusy(false);
		}
	}

	async function onArchiveTeam(team: TeamRow) {
		setActionBusy(true);
		try {
			const r =
				team.status === 'archived'
					? await window.fastIde.unarchiveTeam(team.id)
					: await window.fastIde.archiveTeam(team.id);
			if (!r.ok) setNotice(r.notice);
			else await refresh();
		} finally {
			setActionBusy(false);
		}
	}

	async function onArchiveAgent(agent: AgentRow) {
		setActionBusy(true);
		try {
			const r =
				agent.status === 'archived' || agent.status === 'disabled'
					? await window.fastIde.unarchiveAgent(agent.id)
					: await window.fastIde.archiveAgent(agent.id);
			if (!r.ok) setNotice(r.notice);
			else await refresh();
		} finally {
			setActionBusy(false);
		}
	}

	async function onCloneAgent(agent: AgentRow) {
		const teamId = cloneTeamId.trim() || selectedTeamId;
		if (!teamId) {
			setNotice(shellT('shell.teams.selectTeamFirst'));
			return;
		}
		setActionBusy(true);
		try {
			const r = await window.fastIde.cloneAgent({
				sourceId: agent.id,
				teamId,
				name: agent.name
			});
			if (!r.ok) setNotice(r.notice);
			else {
				setSelectedAgentId(r.agent.id);
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onScheduleGoal(goal: GoalRow) {
		if (!goal.confirmedAt) {
			setNotice(shellT('shell.teams.scheduleNeedsConfirmed'));
			return;
		}
		const projectId = focusProjectId || undefined;
		if (!projectId) {
			setNotice(shellT('shell.teams.scheduleNeedsProject'));
			return;
		}
		setActionBusy(true);
		try {
			const r = await window.fastIde.createScheduledJob({
				kind: 'platform',
				cronExpr: scheduleCron.trim() || '0 9 * * 1-5',
				timezone: scheduleTz.trim() || 'UTC',
				recurring: true,
				targetKind: 'goal',
				targetRef: goal.id,
				projectId,
				title: `Goal: ${goal.name?.trim() || goal.id.slice(0, 8)}`
			});
			if (!r.ok) setNotice(r.notice);
			else {
				setNotice(shellT('shell.teams.scheduleCreated', {id: r.job.id.slice(0, 8)}));
				onOpenScheduled?.();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onDeleteTeam(team: TeamRow) {
		if (
			!window.confirm(
				shellT('shell.teams.deleteTeamConfirm', {name: teamListTitle(team, goalNameById)})
			)
		)
			return;
		setActionBusy(true);
		try {
			const r = await window.fastIde.deleteTeam(team.id);
			if (!r.ok) setNotice(r.notice);
			else {
				setSelectedTeamId(null);
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onSaveAsTeam(team: TeamRow) {
		const name = window.prompt(
			shellT('shell.teams.saveAsPrompt'),
			shellT('shell.teams.saveAsCopy', {name: teamListTitle(team, goalNameById)})
		);
		if (name == null) return;
		setActionBusy(true);
		try {
			const r = await window.fastIde.saveAsTeam({
				sourceTeamId: team.id,
				...(name.trim() ? {name: name.trim()} : {})
			});
			if (!r.ok) setNotice(r.notice);
			else {
				setSelectedTeamId(r.team.id);
				setTeamSegment('ephemeral');
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onPromoteTeam(team: TeamRow) {
		const name = window.prompt(
			shellT('shell.teams.promotePrompt'),
			teamListTitle(team, goalNameById)
		);
		if (name == null) return;
		setActionBusy(true);
		try {
			const r = await window.fastIde.promoteTeam({
				teamId: team.id,
				...(name.trim() && name.trim() !== team.name ? {name: name.trim()} : {})
			});
			if (!r.ok) setNotice(r.notice);
			else await refresh();
		} finally {
			setActionBusy(false);
		}
	}

	async function onDeleteAgent(agent: AgentRow) {
		if (!window.confirm(shellT('shell.teams.deleteAgentConfirm', {name: agent.name}))) return;
		setActionBusy(true);
		try {
			const r = await window.fastIde.deleteAgent(agent.id);
			if (!r.ok) setNotice(r.notice);
			else {
				setSelectedAgentId(null);
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onStopAgentRun(agent: AgentRow) {
		setActionBusy(true);
		try {
			const r = await window.fastIde.stopAgentRun(agent.id);
			if (!r.ok) setNotice(r.notice);
			else {
				setNotice(r.notice || shellT('shell.teams.stoppedTask'));
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	async function onDeleteGoal(goal: GoalRow) {
		if (
			!window.confirm(
				shellT('shell.teams.deleteGoalConfirm', {name: goal.name?.trim() || shortId(goal.id, 8)})
			)
		)
			return;
		setActionBusy(true);
		try {
			const r = await window.fastIde.deleteGoal(goal.id);
			if (!r.ok) setNotice(r.notice);
			else {
				setSelectedGoalId(null);
				await refresh();
			}
		} finally {
			setActionBusy(false);
		}
	}

	const budget = budgetDisplayLines(selectedGoal?.budgetJson, selectedGoal?.progressJson);
	const terminalGoal = (st: string) =>
		['passed', 'failed', 'cancelled', 'discarded', 'succeeded'].includes(st);

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
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{selectedGoal.name?.trim() || shortId(selectedGoal.id, 8)}
									</h2>
									<span
										className={cn(
											'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
											goalStatusChipClass(selectedGoal.status)
										)}
									>
										{goalStatusLabel(selectedGoal.status)}
									</span>
								</div>
								{selectedGoal.statement &&
								selectedGoal.statement.trim() !== selectedGoal.name?.trim() ? (
									<p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground line-clamp-3">
										{selectedGoal.statement}
									</p>
								) : null}
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedGoal.projectId, selectedGoal.projectDisplayName)}
									{selectedGoal.teamId ? (
										<>
											{' · '}
											<button
												type="button"
												className="underline-offset-2 hover:underline"
												onClick={() => {
													setSelectedTeamId(selectedGoal.teamId!);
													setTab('teams');
												}}
											>
												{shellT('shell.teams.teamLink', {name: teamNameById.get(selectedGoal.teamId) ?? shellT('shell.teams.view')})}
											</button>
										</>
									) : null}
								</p>
							</header>

							{(() => {
								const goalTeam = selectedGoal.teamId
									? teams.find(t => t.id === selectedGoal.teamId)
									: null;
								const members = goalTeam?.members ?? [];
								if (members.length === 0) return null;
								return (
									<section className="space-y-2">
										<div className="flex items-baseline justify-between gap-2">
											<h3 className="text-[13px] font-semibold">{shellT('shell.teams.members')}</h3>
											<span className="text-[11px] text-muted-foreground">
												{shellT('shell.teams.membersHint', {count: members.length})}
											</span>
										</div>
										<ul className="overflow-hidden rounded-xl border border-border">
											{members.map((m, mi) => {
												const agent = agents.find(a => a.id === m.agentId);
												const open = expandedMemberId === m.agentId;
												const prompt = agentPrompt(agent);
												return (
													<li
														key={m.agentId}
														className={cn(
															mi > 0 && 'border-t border-border',
															open && 'bg-muted/20'
														)}
													>
														<button
															type="button"
															className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
															onClick={() =>
																setExpandedMemberId(open ? null : m.agentId)
															}
															aria-expanded={open}
														>
															<span className="font-medium">{m.name}</span>
															<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
																{roleLabel(m.teamRole)}
															</span>
															{(prompt.model || agent?.model) && (
																<span className="truncate text-[11px] text-muted-foreground">
																	{prompt.model || agent?.model}
																</span>
															)}
															<ChevronDown
																className={cn(
																	'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
																	open && 'rotate-180'
																)}
															/>
														</button>
														{open ? (
															<div className="space-y-2 border-t border-border/60 px-3 py-2.5 text-[12px]">
																{agent?.taskBrief ? (
																	<div>
																		<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																			{shellT('shell.teams.taskBrief')}
																		</div>
																		<p className="whitespace-pre-wrap leading-relaxed">
																			{agent.taskBrief}
																		</p>
																	</div>
																) : null}
																<div>
																	<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																		{shellT('shell.teams.systemPrompt')}
																	</div>
																	{prompt.systemPrompt ? (
																		<pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
																			{prompt.systemPrompt}
																		</pre>
																	) : (
																		<p className="text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
																	)}
																</div>
															</div>
														) : null}
													</li>
												);
											})}
										</ul>
									</section>
								);
							})()}

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">Workflow</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.topologyReadonly')}</span>
								</div>
								<WorkflowReadonly
									steps={workflowSteps}
									mode="live"
									currentStepIds={selectedGoal.currentStepIds}
									currentStepId={selectedGoal.currentStepId}
									completedSteps={progress.completedSteps}
									pendingExtras={progress.pendingExtras}
									goalStatus={selectedGoal.status}
									goalLabel={selectedGoal.name?.trim() || undefined}
									resultLabel={
										['passed', 'succeeded', 'failed', 'cancelled', 'discarded'].includes(
											selectedGoal.status
										)
											? goalStatusLabel(selectedGoal.status)
											: undefined
									}
									onOpenStep={use => openWorkflowAgent(use, selectedGoal.teamId)}
								/>
							</section>

							{(selectedGoal.status === 'running' ||
								selectedGoal.status === 'paused' ||
								selectedGoal.status === 'blocked') && (
								<section className="space-y-2 rounded-xl border border-border px-3 py-3">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.runControls')}</h3>
									<div className="flex flex-wrap gap-2">
										{selectedGoal.status === 'running' ? (
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={actionBusy}
												onClick={() => void goalAction('pause', selectedGoal.id)}
											>
												<Pause className="size-3.5" />
												{shellT('shell.teams.pause')}
											</Button>
										) : selectedGoal.status === 'paused' ? (
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={actionBusy}
												onClick={() => void goalAction('resume', selectedGoal.id)}
											>
												<Play className="size-3.5" />
												{shellT('shell.teams.continue')}
											</Button>
										) : null}
										{(selectedGoal.status === 'running' ||
											selectedGoal.status === 'paused') && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={actionBusy}
												onClick={() => {
													if (window.confirm(shellT('shell.teams.stopConfirm')))
														void goalAction('cancel', selectedGoal.id);
												}}
											>
												<Square className="size-3.5" />
												{shellT('shell.teams.stop')}
											</Button>
										)}
									</div>
									<div className="flex items-center gap-2">
										<input
											className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-xs"
											placeholder={shellT('shell.teams.steerPlaceholder')}
											value={steerNote}
											onChange={e => setSteerNote(e.target.value)}
										/>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={actionBusy || !steerNote.trim()}
											onClick={() => void onSteer(selectedGoal.id)}
										>
											{shellT('shell.teams.send')}
										</Button>
									</div>
								</section>
							)}

							{(budget.length > 0 || selectedGoal.confirmedAt) && (
								<details className="group rounded-xl border border-border">
									<summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
										<span className="group-open:text-foreground">{shellT('shell.teams.moreSettings')}</span>
										<span className="ml-2 text-[11px] font-normal">{shellT('shell.teams.usageSchedule')}</span>
									</summary>
									<div className="space-y-4 border-t border-border px-3 py-3">
										{budget.length > 0 ? (
											<div>
												<div className="mb-2 text-[11px] font-medium text-muted-foreground">
													{shellT('shell.teams.resourceUsage')}
												</div>
												<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
													{budget.map(row => (
														<div key={row.label}>
															<dt className="text-muted-foreground">{row.label}</dt>
															<dd className="font-medium tabular-nums">{row.value}</dd>
														</div>
													))}
												</dl>
											</div>
										) : null}
										{selectedGoal.confirmedAt ? (
											<div className="space-y-2 text-xs">
												<div className="flex items-center gap-1.5 font-medium text-muted-foreground">
													<Clock className="size-3.5" />
													{shellT('shell.teams.repeatSchedule')}
												</div>
												<div className="flex flex-wrap items-end gap-2">
													<label className="flex flex-col gap-0.5">
														<span className="text-muted-foreground">{shellT('shell.teams.scheduleLabel')}</span>
														<input
															className="h-8 rounded border px-2 font-mono"
															value={scheduleCron}
															onChange={e => setScheduleCron(e.target.value)}
															title={shellT('shell.teams.cronTitle')}
														/>
													</label>
													<label className="flex flex-col gap-0.5">
														<span className="text-muted-foreground">{shellT('shell.teams.timezone')}</span>
														<input
															className="h-8 rounded border px-2"
															value={scheduleTz}
															onChange={e => setScheduleTz(e.target.value)}
														/>
													</label>
													<Button
														type="button"
														size="sm"
														variant="secondary"
														disabled={actionBusy}
														onClick={() => void onScheduleGoal(selectedGoal)}
													>
														{shellT('shell.teams.create')}
													</Button>
												</div>
												<p className="text-muted-foreground">
													{shellT('shell.teams.scheduleHint')}
												</p>
											</div>
										) : null}
									</div>
								</details>
							)}

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{selectedGoal.originSessionId && onOpenLivingSession ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onOpenLivingSession(
												selectedGoal.originSessionId!,
												selectedGoal.projectId
											)
										}
									>
										{shellT('shell.teams.openInChat')}
									</Button>
								) : null}
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										variant={
											selectedGoal.originSessionId && onOpenLivingSession
												? 'secondary'
												: 'default'
										}
										onClick={() =>
											onInsertMention(
												'goal',
												selectedGoal.id,
												selectedGoal.name?.trim() || undefined,
												selectedGoal.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{terminalGoal(selectedGoal.status) ? (
									<Button
										type="button"
										size="xs"
										variant="outline"
										className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
										disabled={actionBusy}
										onClick={() => void onDeleteGoal(selectedGoal)}
									>
										{shellT('shell.teams.delete')}
									</Button>
								) : null}
							</footer>
						</div>
					) : null}

					{tab === 'teams' && selectedTeam ? (
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{teamListTitle(selectedTeam, goalNameById)}
									</h2>
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										{teamKindLabel(selectedTeam.kind)} ·{' '}
										{teamStatusLabel(selectedTeam.status)}
									</span>
								</div>
								{selectedTeam.description ? (
									<p className="text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
										{selectedTeam.description}
									</p>
								) : null}
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedTeam.projectId, selectedTeam.projectDisplayName)}
									{selectedTeam.kind === 'ephemeral' && selectedTeam.originGoalId
										? shellT('shell.teams.fromGoal')
										: null}
								</p>
							</header>

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.members')}</h3>
									<span className="text-[11px] text-muted-foreground">
										{shellT('shell.teams.membersHint', {count: (selectedTeam.members ?? []).length})}
									</span>
								</div>
								<ul className="overflow-hidden rounded-xl border border-border">
									{(selectedTeam.members ?? []).length === 0 ? (
										<li className="px-3 py-4 text-sm text-muted-foreground">{shellT('shell.teams.noMembers')}</li>
									) : null}
									{(selectedTeam.members ?? []).map((m, mi) => {
										const agent = agents.find(a => a.id === m.agentId);
										const open = expandedMemberId === m.agentId;
										const prompt = agentPrompt(agent);
										return (
											<li
												key={m.agentId}
												className={cn(
													mi > 0 && 'border-t border-border',
													open && 'bg-muted/20'
												)}
											>
												<button
													type="button"
													className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
													onClick={() =>
														setExpandedMemberId(open ? null : m.agentId)
													}
													aria-expanded={open}
												>
													<span className="font-medium">{m.name}</span>
													<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{roleLabel(m.teamRole)}
													</span>
													{prompt.model || agent?.model ? (
														<span className="truncate text-[11px] text-muted-foreground">
															{prompt.model || agent?.model}
														</span>
													) : null}
													<ChevronDown
														className={cn(
															'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
															open && 'rotate-180'
														)}
													/>
												</button>
												{open ? (
													<div className="space-y-2 border-t border-border/60 px-3 py-2.5 text-[12px]">
														{agent?.taskBrief ? (
															<div>
																<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																	{shellT('shell.teams.taskBrief')}
																</div>
																<p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
																	{agent.taskBrief}
																</p>
															</div>
														) : null}
														<div>
															<div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
																{shellT('shell.teams.systemPrompt')}
															</div>
															{prompt.systemPrompt ? (
																<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
																	{prompt.systemPrompt}
																</pre>
															) : (
																<p className="text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
															)}
														</div>
														<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
															{prompt.model || agent?.model ? (
																<span>
																	{shellT('shell.teams.modelLine', {
																		model: prompt.model || agent?.model || ''
																	})}
																</span>
															) : null}
															{prompt.maxTurns != null ? (
																<span>{shellT('shell.teams.maxTurnsLine', {count: prompt.maxTurns})}</span>
															) : null}
															<span>{shellT('shell.teams.statusLine', {status: agentStatusLabel(agent?.status ?? 'idle')})}</span>
														</div>
													</div>
												) : null}
											</li>
										);
									})}
								</ul>
							</section>

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">Workflow</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.defaultTemplate')}</span>
								</div>
								<WorkflowReadonly
									steps={workflowSteps}
									mode="template"
									goalLabel={teamListTitle(selectedTeam, goalNameById)}
									resultLabel={shellT('shell.teams.resultLabel')}
									onOpenStep={use => openWorkflowAgent(use, selectedTeam.id)}
								/>
							</section>

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onInsertMention(
												'team',
												selectedTeam.name,
												teamListTitle(selectedTeam, goalNameById),
												selectedTeam.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{selectedTeam.kind === 'ephemeral' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onPromoteTeam(selectedTeam)}
									>
										{shellT('shell.teams.promoteTeam')}
									</Button>
								) : null}
								{selectedTeam.kind === 'explicit' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onArchiveTeam(selectedTeam)}
									>
										{selectedTeam.status === 'archived' ? shellT('shell.teams.restore') : shellT('shell.teams.archive')}
									</Button>
								) : null}
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void onSaveAsTeam(selectedTeam)}
								>
									{shellT('shell.teams.saveAs')}
								</Button>
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void startCreate('agent')}
								>
									{shellT('shell.teams.addMember')}
								</Button>
								{selectedTeam.status !== 'deleted' ? (
									<Button
										type="button"
										size="xs"
										variant="outline"
										className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
										disabled={actionBusy}
										onClick={() => void onDeleteTeam(selectedTeam)}
									>
										{shellT('shell.teams.delete')}
									</Button>
								) : null}
							</footer>
						</div>
					) : null}

					{tab === 'agents' && selectedAgent ? (
						<div className="mx-auto max-w-3xl space-y-5">
							<header className="space-y-1.5">
								<div className="flex flex-wrap items-start gap-2">
									<h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight">
										{agentListTitle(
											selectedAgent.name,
											selectedAgent.id,
											agentNameDup.has(selectedAgent.name.trim().toLowerCase())
										)}
									</h2>
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										{agentStatusLabel(selectedAgent.status)}
									</span>
									{selectedAgent.teamRole ? (
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
											{roleLabel(selectedAgent.teamRole)}
										</span>
									) : null}
								</div>
								<p className="text-[11px] text-muted-foreground">
									{projectChip(selectedAgent.projectId, selectedAgent.projectDisplayName)}
									{selectedAgent.teamId ? (
										<>
											{' · '}
											<button
												type="button"
												className="underline-offset-2 hover:underline"
												onClick={() => {
													setSelectedTeamId(selectedAgent.teamId!);
													setTab('teams');
												}}
											>
												{shellT('shell.teams.teamLink', {name: teamNameById.get(selectedAgent.teamId) ?? shellT('shell.teams.view')})}
											</button>
										</>
									) : (
										shellT('shell.teams.notInTeam')
									)}
								</p>
							</header>

							{(() => {
								const prompt = agentPrompt(selectedAgent);
								const model = prompt.model || selectedAgent.model;
								return (
									<section className="space-y-2">
										<div className="flex items-baseline justify-between gap-2">
											<h3 className="text-[13px] font-semibold">{shellT('shell.teams.config')}</h3>
											<span className="text-[11px] text-muted-foreground">
												{shellT('shell.teams.readonlyDecl')}
											</span>
										</div>
										<div className="overflow-hidden rounded-xl border border-border">
											<dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.model')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium">
														{model || shellT('shell.teams.default')}
													</dd>
												</div>
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.role')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium">
														{selectedAgent.teamRole
															? roleLabel(selectedAgent.teamRole)
															: shellT('shell.teams.unspecified')}
													</dd>
												</div>
												<div className="bg-background px-3 py-2.5">
													<dt className="text-[10px] text-muted-foreground">{shellT('shell.teams.maxTurns')}</dt>
													<dd className="mt-0.5 text-[12px] font-medium tabular-nums">
														{prompt.maxTurns != null ? prompt.maxTurns : '—'}
													</dd>
												</div>
											</dl>
											{selectedAgent.taskBrief ? (
												<div className="border-t border-border px-3 py-2.5">
													<div className="mb-1 text-[10px] font-medium text-muted-foreground">
														{shellT('shell.teams.taskBrief')}
													</div>
													<p className="whitespace-pre-wrap text-[12px] leading-relaxed">
														{selectedAgent.taskBrief}
													</p>
												</div>
											) : null}
											<div className="border-t border-border px-3 py-2.5">
												<div className="mb-1 text-[10px] font-medium text-muted-foreground">
													{shellT('shell.teams.systemPrompt')}
												</div>
												{prompt.systemPrompt ? (
													<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
														{prompt.systemPrompt}
													</pre>
												) : (
													<p className="text-[12px] text-muted-foreground">{shellT('shell.teams.noneConfigured')}</p>
												)}
											</div>
										</div>
									</section>
								);
							})()}

							<section className="space-y-2">
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-[13px] font-semibold">{shellT('shell.teams.cloneToTeam')}</h3>
									<span className="text-[11px] text-muted-foreground">{shellT('shell.teams.cloneHint')}</span>
								</div>
								<div className="flex flex-wrap items-end gap-2 rounded-xl border border-border px-3 py-2.5 text-xs">
									<label className="flex min-w-[160px] flex-1 flex-col gap-0.5">
										<span className="text-muted-foreground">{shellT('shell.teams.targetTeam')}</span>
										<select
											className="h-8 rounded border bg-background px-2"
											value={cloneTeamId || selectedTeamId || ''}
											onChange={e => setCloneTeamId(e.target.value)}
										>
											<option value="">{shellT('shell.teams.selectTeam')}</option>
											{teams
												.filter(t => t.status === 'active' && t.kind !== 'deleted')
												.map(t => (
													<option key={t.id} value={t.id}>
														{teamListTitle(t, goalNameById)}
													</option>
												))}
										</select>
									</label>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={actionBusy || !(cloneTeamId || selectedTeamId)}
										onClick={() => void onCloneAgent(selectedAgent)}
									>
										{shellT('shell.teams.cloneJoin')}
									</Button>
								</div>
							</section>

							<footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								{onInsertMention ? (
									<Button
										type="button"
										size="xs"
										onClick={() =>
											onInsertMention(
												'agent',
												selectedAgent.name,
												selectedAgent.name,
												selectedAgent.projectId
											)
										}
									>
										{shellT('shell.teams.scheduleTask')}
									</Button>
								) : null}
								{selectedAgent.status === 'running' ? (
									<Button
										type="button"
										size="xs"
										variant="secondary"
										disabled={actionBusy}
										onClick={() => void onStopAgentRun(selectedAgent)}
									>
										{shellT('shell.teams.stopCurrent')}
									</Button>
								) : null}
								<Button
									type="button"
									size="xs"
									variant="outline"
									disabled={actionBusy}
									onClick={() => void onArchiveAgent(selectedAgent)}
								>
									{selectedAgent.status === 'archived' ||
									selectedAgent.status === 'disabled'
										? shellT('shell.teams.restore')
										: shellT('shell.teams.archive')}
								</Button>
								<Button
									type="button"
									size="xs"
									variant="outline"
									className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
									disabled={actionBusy}
									onClick={() => void onDeleteAgent(selectedAgent)}
								>
									{shellT('shell.teams.delete')}
								</Button>
							</footer>
						</div>
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
