/** Prefer JSON array; dual-read legacy CSV / single string. */
export function wireIdList(raw?: string | string[] | null): string[] {
	if (raw == null) return [];
	if (Array.isArray(raw))
		return [...new Set(raw.map(s => String(s).trim()).filter(Boolean))].sort();
	if (typeof raw !== 'string' || !raw.trim()) return [];
	return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))].sort();
}

export function pickIdList(
	plural?: string | string[] | null,
	singular?: string | string[] | null
): string[] {
	if (plural != null && !(typeof plural === 'string' && !plural.trim()))
		return wireIdList(plural);
	return wireIdList(singular);
}
