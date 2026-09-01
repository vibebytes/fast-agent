export const ENGINE_KIND_NAMES = ['fast', 'dsh'] as const;
export type EngineKindName = (typeof ENGINE_KIND_NAMES)[number];

export function enginePickerKinds(available: readonly string[]): EngineKindName[] {
	const set = new Set(available.map(s => s.trim().toLowerCase()));
	return ENGINE_KIND_NAMES.filter(k => set.has(k));
}
