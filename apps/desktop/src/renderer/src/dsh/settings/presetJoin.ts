/** Ids a preset directory may be named, mirroring DSH `section-store`. */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

export type PresetTrust = 'system' | 'user';

export type PresetRow = {
	id: string;
	name?: string;
	description?: string;
	trust: PresetTrust;
	isDefault: boolean;
	broken?: string;
};

export type Roster = {
	presets: PresetRow[];
	authorable: boolean;
	hasDocument: boolean;
};

export type CopyDraft = {
	from: string;
	id: string;
	name: string;
};

export function asRoster(value: unknown): Roster {
	if (!value || typeof value !== 'object') return {presets: [], authorable: false, hasDocument: false};
	const v = value as Record<string, unknown>;
	const rows = Array.isArray(v.presets) ? v.presets : [];
	return {
		authorable: v.authorable === true,
		hasDocument: v.hasDocument === true,
		presets: rows.flatMap(row => {
			if (!row || typeof row !== 'object') return [];
			const r = row as Record<string, unknown>;
			if (typeof r.id !== 'string' || r.id.length === 0) return [];
			return [
				{
					id: r.id,
					trust: r.trust === 'user' ? 'user' : 'system',
					isDefault: r.isDefault === true,
					...(typeof r.name === 'string' ? {name: r.name} : {}),
					...(typeof r.description === 'string' ? {description: r.description} : {}),
					...(typeof r.broken === 'string' ? {broken: r.broken} : {})
				}
			];
		})
	};
}

export function draftBlocker(
	draft: CopyDraft,
	rows: readonly {id: string}[]
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
	if (draft.id === '') return 'idRequired';
	if (!PRESET_ID.test(draft.id)) return 'idInvalid';
	if (rows.some(row => row.id === draft.id)) return 'idTaken';
}

export function copyPayload(draft: CopyDraft): {from: string; agentPreset: string; name?: string} {
	const name = draft.name.trim();
	return {
		from: draft.from,
		agentPreset: draft.id,
		...(name === '' ? {} : {name})
	};
}

export function groupPresets(rows: PresetRow[]): {system: PresetRow[]; user: PresetRow[]} {
	return {
		system: rows.filter(r => r.trust === 'system'),
		user: rows.filter(r => r.trust === 'user')
	};
}
