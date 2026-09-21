import {shellT} from '../i18n/t';

export type TeamRow = {
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

export type GoalRow = {
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
	currentStepId?: string | string[] | null;
	confirmedAt?: string | null;
	createdAt?: string | null;
};

export type AgentRow = {
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

export function agentPrompt(a?: AgentRow | null): {
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

export function projectChip(projectId?: string | null, displayName?: string | null): string {
	const label = displayName?.trim() || projectId?.trim();
	return label ? label : shellT('shell.teams.ungrouped');
}
