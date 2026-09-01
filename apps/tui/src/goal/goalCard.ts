/** Pure model for the Goal confirm card's full-scope draft editing (②′ 调参). */
import type {GoalCardState} from '../state/model.js';

export type GoalMemberDraft = {
	name: string;
	role: string;
	brief?: string;
	model?: string;
	maxTurns?: number;
	isolation?: string;
};

export type EditField =
	| {kind: 'statement'; label: string}
	| {kind: 'acceptance'; label: string}
	| {kind: 'workflow'; label: string}
	| {kind: 'budget'; label: string}
	| {kind: 'member'; label: string; member: string; field: 'model' | 'max_turns' | 'isolation' | 'brief'};

export function parseMembers(membersJson: string | undefined): GoalMemberDraft[] {
	if (!membersJson) return [];
	try {
		const arr = JSON.parse(membersJson) as Array<Record<string, unknown>>;
		if (!Array.isArray(arr)) return [];
		return arr.flatMap(m => {
			const name = typeof m.name === 'string' ? m.name : '';
			const role = typeof m.role === 'string' ? m.role : '';
			if (!name) return [];
			return [{
				name,
				role,
				brief: typeof m.brief === 'string' ? m.brief : undefined,
				model: typeof m.model === 'string' ? m.model : undefined,
				maxTurns: typeof m.max_turns === 'number' ? m.max_turns : undefined,
				isolation: typeof m.isolation === 'string' ? m.isolation : undefined
			}];
		});
	} catch {
		return [];
	}
}

export function editFields(card: GoalCardState): EditField[] {
	const base: EditField[] = [
		{kind: 'statement', label: '目标'},
		{kind: 'acceptance', label: '验收'},
		{kind: 'workflow', label: 'workflow(JSON)'},
		{kind: 'budget', label: 'budget(JSON)'}
	];
	const members = parseMembers(card.membersJson).flatMap<EditField>(m => [
		{kind: 'member', label: `${m.name}·model`, member: m.name, field: 'model'},
		{kind: 'member', label: `${m.name}·max_turns`, member: m.name, field: 'max_turns'},
		{kind: 'member', label: `${m.name}·isolation`, member: m.name, field: 'isolation'},
		{kind: 'member', label: `${m.name}·brief`, member: m.name, field: 'brief'}
	]);
	return [...base, ...members];
}

export function fieldValue(card: GoalCardState, field: EditField, edits: Record<string, string>): string {
	const key = editKey(field);
	if (key in edits) return edits[key]!;
	switch (field.kind) {
		case 'statement': return card.statement ?? '';
		case 'acceptance': return card.acceptance ?? '';
		case 'workflow': return card.workflowJson ?? '';
		case 'budget': return card.budgetJson ?? '';
		case 'member': {
			const m = parseMembers(card.membersJson).find(x => x.name === field.member);
			if (!m) return '';
			if (field.field === 'model') return m.model ?? '';
			if (field.field === 'max_turns') return m.maxTurns?.toString() ?? '';
			if (field.field === 'isolation') return m.isolation ?? '';
			return m.brief ?? '';
		}
	}
}

export function editKey(field: EditField): string {
	return field.kind === 'member' ? `member:${field.member}:${field.field}` : field.kind;
}

/**
 * ConfirmGoal.patchJson from local edits — one gesture: patch → freeze → start.
 * Returns an error string for malformed JSON fields instead of a payload.
 */
export function buildPatchJson(edits: Record<string, string>): {patchJson?: string; error?: string} {
	if (Object.keys(edits).length === 0) return {};
	const patch: Record<string, unknown> = {};
	if (edits.statement !== undefined) patch.statement = edits.statement;
	if (edits.acceptance !== undefined) patch.acceptance = edits.acceptance;
	for (const [key, raw, err] of [
		['workflow', 'workflow_json', 'workflow JSON 无效'],
		['budget', 'budget_json', 'budget JSON 无效']
	] as const) {
		const value = edits[key];
		if (value !== undefined && value.trim() !== '') {
			try {
				patch[raw] = JSON.parse(value);
			} catch {
				return {error: err};
			}
		}
	}
	const members = new Map<string, Record<string, unknown>>();
	for (const [key, value] of Object.entries(edits)) {
		if (!key.startsWith('member:')) continue;
		const [, name, field] = key.split(':');
		if (!name || !field) continue;
		const entry = members.get(name) ?? {name};
		if (field === 'max_turns') {
			const n = Number.parseInt(value, 10);
			if (Number.isNaN(n)) return {error: `${name} max_turns 需为数字`};
			entry.max_turns = n;
		} else {
			entry[field] = value;
		}
		members.set(name, entry);
	}
	if (members.size > 0) patch.members = [...members.values()];
	return {patchJson: JSON.stringify(patch)};
}
