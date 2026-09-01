/** User-facing labels & list titles for Teams workbench (avoid engine jargon in chrome). */

import {shellT as t} from './i18n/t';

export type GoalSegment = 'all' | 'awaiting' | 'active' | 'done';

/** Newest-first by `createdAt` (ISO); missing timestamps sink to the bottom. */
export function byCreatedDesc<T extends {id: string; createdAt?: string | null}>(a: T, b: T): number {
	const ta = a.createdAt?.trim() || '';
	const tb = b.createdAt?.trim() || '';
	if (ta !== tb) return tb.localeCompare(ta);
	return b.id.localeCompare(a.id);
}

/** Compact list timestamp — e.g. `7/30 12:15`. */
export function listCreatedLabel(iso?: string | null): string {
	const raw = iso?.trim();
	if (!raw) return '';
	const tms = Date.parse(raw);
	if (Number.isNaN(tms)) return '';
	return new Date(tms).toLocaleString(undefined, {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/** Teams sidebar filter — same pill chrome as Goals; default `all` shows every kind. */
export type TeamSegment = 'all' | 'explicit' | 'ephemeral' | 'archived';

/** Agents sidebar filter — same pill chrome as Teams/Goals. */
export type AgentSegment = 'all' | 'active' | 'archived';

export function teamSegmentOf(kind: string, status: string): Exclude<TeamSegment, 'all'> {
	if (status === 'archived' || status === 'deleted') return 'archived';
	if (kind === 'ephemeral') return 'ephemeral';
	return 'explicit';
}

export function agentSegmentOf(status: string): Exclude<AgentSegment, 'all'> {
	if (status === 'archived' || status === 'disabled') return 'archived';
	return 'active';
}

export function goalStatusLabel(status: string): string {
	switch (status) {
		case 'awaiting_confirm':
			return t('shell.teams.goalStatus.awaiting_confirm');
		case 'planning':
			return t('shell.teams.goalStatus.planning');
		case 'running':
			return t('shell.teams.goalStatus.running');
		case 'paused':
			return t('shell.teams.goalStatus.paused');
		case 'blocked':
			return t('shell.teams.goalStatus.blocked');
		case 'passed':
		case 'succeeded':
			return t('shell.teams.goalStatus.passed');
		case 'failed':
			return t('shell.teams.goalStatus.failed');
		case 'cancelled':
		case 'discarded':
			return t('shell.teams.goalStatus.cancelled');
		case 'deleted':
			return t('shell.teams.goalStatus.deleted');
		default:
			return status || t('shell.teams.goalStatus.unknown');
	}
}

/** Tailwind classes for compact status chip. */
export function goalStatusChipClass(status: string): string {
	switch (status) {
		case 'running':
			return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
		case 'paused':
			return 'bg-amber-500/15 text-amber-800 dark:text-amber-200';
		case 'blocked':
			return 'bg-orange-500/15 text-orange-800 dark:text-orange-200';
		case 'awaiting_confirm':
		case 'planning':
			return 'bg-violet-500/15 text-violet-700 dark:text-violet-300';
		case 'passed':
		case 'succeeded':
			return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
		case 'failed':
			return 'bg-destructive/15 text-destructive';
		case 'cancelled':
		case 'discarded':
		case 'deleted':
			return 'bg-muted text-muted-foreground';
		default:
			return 'bg-muted text-muted-foreground';
	}
}

export function goalSegmentOf(status: string): Exclude<GoalSegment, 'all'> {
	if (status === 'awaiting_confirm' || status === 'planning') return 'awaiting';
	if (['passed', 'failed', 'cancelled', 'discarded', 'succeeded', 'deleted'].includes(status))
		return 'done';
	return 'active';
}

export function teamKindLabel(kind: string): string {
	if (kind === 'ephemeral') return t('shell.teams.teamKind.ephemeral');
	if (kind === 'explicit') return t('shell.teams.teamKind.explicit');
	return kind || 'Team';
}

export function teamStatusLabel(status: string): string {
	switch (status) {
		case 'active':
			return t('shell.teams.teamStatus.active');
		case 'archived':
			return t('shell.teams.teamStatus.archived');
		case 'deleted':
			return t('shell.teams.teamStatus.deleted');
		default:
			return status || '';
	}
}

export function agentStatusLabel(status: string): string {
	switch (status) {
		case 'active':
		case 'idle':
			return t('shell.teams.agentStatus.idle');
		case 'running':
		case 'busy':
			return t('shell.teams.agentStatus.running');
		case 'archived':
		case 'disabled':
			return t('shell.teams.agentStatus.archived');
		case 'deleted':
		case 'stopped':
			return t('shell.teams.agentStatus.stopped');
		default:
			return status || t('shell.teams.agentStatus.unknown');
	}
}

export function roleLabel(role: string): string {
	switch (role) {
		case 'executor':
			return t('shell.teams.roles.executor');
		case 'verifier':
			return t('shell.teams.roles.verifier');
		case 'researcher':
			return t('shell.teams.roles.researcher');
		default:
			return role || t('shell.teams.roles.member');
	}
}

export function shortId(id: string, n = 6): string {
	const s = id.trim();
	if (s.length <= n) return s;
	return s.slice(0, n);
}

/** Ephemeral teams are often named goal-<uuid> — prefer goal title. */
export function teamListTitle(
	team: {name: string; kind: string; originGoalId?: string | null},
	goalNameById: Map<string, string>
): string {
	const raw = team.name?.trim() || '';
	if (team.kind === 'ephemeral') {
		const fromGoal =
			(team.originGoalId && goalNameById.get(team.originGoalId)) ||
			(raw.startsWith('goal-') ? goalNameById.get(raw.slice(5)) : undefined);
		if (fromGoal) return fromGoal;
		if (raw.startsWith('goal-') && raw.length > 12)
			return t('shell.teams.list.tempTeamShort', {id: shortId(raw.slice(5), 8)});
		return raw ? t('shell.teams.list.tempNamed', {name: raw}) : t('shell.teams.list.tempTeam');
	}
	return raw || t('shell.teams.list.unnamedTeam');
}

export function agentListTitle(name: string, id: string, duplicate: boolean): string {
	const n = name.trim() || t('shell.teams.list.unnamed');
	return duplicate ? `${n} · ${shortId(id)}` : n;
}

const BUDGET_KEYS = [
	'max_rejects',
	'max_child_runs',
	'max_outer_turns',
	'on_exhaust',
	'max_step_seconds',
	'reject_count',
	'child_runs',
	'outer_turns'
] as const;

function budgetLabel(key: string): string {
	return BUDGET_KEYS.includes(key as (typeof BUDGET_KEYS)[number])
		? t(`shell.teams.budget.${key}`)
		: key;
}

function budgetValue(key: string, raw: unknown): string {
	const s = String(raw);
	if (key === 'on_exhaust') {
		if (s === 'escalate') return t('shell.teams.budget.escalate');
		if (s === 'fail') return t('shell.teams.budget.fail');
		if (s === 'cancel') return t('shell.teams.budget.cancel');
	}
	return s;
}

export function budgetDisplayLines(
	budgetJson?: string | null,
	progressJson?: string | null
): Array<{label: string; value: string}> {
	const out: Array<{label: string; value: string}> = [];
	try {
		if (budgetJson?.trim()) {
			const b = JSON.parse(budgetJson) as Record<string, unknown>;
			for (const k of [
				'max_rejects',
				'max_child_runs',
				'max_outer_turns',
				'on_exhaust',
				'max_step_seconds'
			]) {
				if (b[k] != null && b[k] !== '')
					out.push({label: budgetLabel(k), value: budgetValue(k, b[k])});
			}
		}
		if (progressJson?.trim()) {
			const p = JSON.parse(progressJson) as Record<string, unknown>;
			for (const k of ['reject_count', 'child_runs', 'outer_turns']) {
				if (p[k] != null)
					out.push({label: budgetLabel(k), value: budgetValue(k, p[k])});
			}
		}
	} catch {
		/* ignore */
	}
	return out;
}

export function workflowStatusLabel(
	st: 'done' | 'running' | 'blocked' | 'reject-reopen' | 'pending' | 'failed' | 'skipped'
): string {
	switch (st) {
		case 'done':
			return t('shell.teams.workflow.done');
		case 'running':
			return t('shell.teams.workflow.running');
		case 'blocked':
			return t('shell.teams.workflow.blocked');
		case 'reject-reopen':
			return t('shell.teams.workflow.rejectReopen');
		case 'failed':
			return t('shell.teams.workflow.failed');
		case 'skipped':
			return t('shell.teams.workflow.skipped');
		default:
			return t('shell.teams.workflow.pending');
	}
}
