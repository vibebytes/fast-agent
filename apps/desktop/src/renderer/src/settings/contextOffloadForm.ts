export const contextOffloadNamespace = 'context';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only a JSON boolean true turns compaction offload on. */
export function contextOffloadChecked(payload: unknown): boolean {
	return isRecord(payload) && payload.contextOffload === true;
}

export function contextOffloadPatch(on: boolean): {
	namespace: typeof contextOffloadNamespace;
	patch: {contextOffload: boolean};
} {
	return {namespace: contextOffloadNamespace, patch: {contextOffload: on}};
}
