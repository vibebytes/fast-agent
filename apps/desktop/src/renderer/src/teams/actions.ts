import {shellT} from '../i18n/t';
import {shortId, teamListTitle} from '../teamsDisplay';
import type {AgentRow, GoalRow, TeamRow} from './rows';

export type TeamActionHost = Record<string, any>;

export function createTeamActions(h: TeamActionHost) {
	const {
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
	} = h;

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

	return {
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
	};
}
