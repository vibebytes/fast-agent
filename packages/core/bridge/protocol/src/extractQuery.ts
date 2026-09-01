/**
 * Cold-restore / defensive UI: inner text of `<query>…</query>`, else whole string.
 * Mirrors Scala `EnvironmentBlocks.extractQuery` (B2).
 */
export function extractQuery(content: string): string {
	const start = content.indexOf('<query>');
	const end = content.indexOf('</query>');
	if (start >= 0 && end > start) return content.slice(start + '<query>'.length, end).trim();
	return content;
}
