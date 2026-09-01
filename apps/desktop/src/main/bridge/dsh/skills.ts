import type {DshCallResult, DshSkillsResult, SlashCatalogEntry} from '@fast-ide/session-view';

type DshCall = (
	method: string,
	payload?: Record<string, unknown>,
	sessionId?: string
) => Promise<DshCallResult>;

export async function listDshSkills(call: DshCall, sessionId: string): Promise<DshSkillsResult> {
	const result = await call('skill.list', {sessionId}, sessionId);
	if (!result.ok) return result;
	return {ok: true, value: asSlashCatalog(result.value)};
}

export function asSlashCatalog(value: unknown): SlashCatalogEntry[] {
	if (!value || typeof value !== 'object') return [];
	const skills = (value as {skills?: unknown}).skills;
	if (!Array.isArray(skills)) return [];
	return skills.flatMap(row => {
		if (!row || typeof row !== 'object') return [];
		const r = row as Record<string, unknown>;
		if (typeof r.name !== 'string' || !r.name.trim()) return [];
		return [
			{
				name: r.name,
				description: typeof r.description === 'string' ? r.description : '',
				available: true,
				badge: r.modelInvocable === false ? 'user' : undefined
			}
		];
	});
}

/** DSH skills are plain `/name` text. Do not fill Fast `skillSlash`. */
export function promptLine(name: string, args = ''): string {
	const n = name.trim().replace(/^\//, '');
	const a = args.trim();
	return a ? `/${n} ${a}` : `/${n}`;
}
