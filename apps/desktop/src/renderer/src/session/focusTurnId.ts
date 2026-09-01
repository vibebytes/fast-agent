/** Match transcript data-turn-id against a run/job run id (exact / suffix / contains). */
export function turnIdMatches(attr: string, runId: string): boolean {
	const id = runId.trim();
	if (!id) return false;
	return attr === id || attr.endsWith(`-${id}`) || attr.includes(id);
}
