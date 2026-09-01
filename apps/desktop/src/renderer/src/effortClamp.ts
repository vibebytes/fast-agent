/** Pi-style clamp for Composer Effort (mirrors Bridge modelCatalog.clampEffort). */
export function clampEffort(
	current: string | undefined,
	supported: string[],
	defaultEffort?: string
): string | undefined {
	if (!supported.length) return undefined;
	const cur = current?.trim().toLowerCase();
	if (cur && supported.some(e => e.toLowerCase() === cur)) return cur;
	const def = defaultEffort?.trim().toLowerCase();
	if (def && supported.some(e => e.toLowerCase() === def)) return def;
	if (supported.some(e => e.toLowerCase() === 'medium')) return 'medium';
	return supported[0]?.toLowerCase();
}
