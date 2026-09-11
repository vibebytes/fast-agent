export const ENGINE_KIND_NAMES = ['fast', 'dsh'] as const;
export type EngineKindName = (typeof ENGINE_KIND_NAMES)[number];

export function enginePickerKinds(available: readonly string[]): EngineKindName[] {
	const set = new Set(available.map(s => s.trim().toLowerCase()));
	return ENGINE_KIND_NAMES.filter(k => set.has(k));
}

/**
 * Chrome re-sync decision for the Composer. The `sticky*` props lag the local
 * optimistic state by one host round-trip, so re-applying them on every prop
 * change reverted a fresh `pickEngine` (picker showed fast, session ran dsh).
 * Only a Task identity change may overwrite local chrome.
 */
export function shouldResyncChrome(
	prevTaskId: string | null | undefined,
	nextTaskId: string | null | undefined
): boolean {
	return (prevTaskId ?? null) !== (nextTaskId ?? null);
}
