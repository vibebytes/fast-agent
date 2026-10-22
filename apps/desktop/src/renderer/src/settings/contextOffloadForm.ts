import {isRecord} from './formShared';

export const contextOffloadNamespace = 'context';

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
