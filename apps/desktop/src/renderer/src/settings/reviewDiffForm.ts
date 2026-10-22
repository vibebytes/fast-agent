import type {SettingsStatus} from './useSettings';
import {isRecord, namespacePayload} from './formShared';

export const reviewDiffNamespace = 'checkpoint';

/** Only a JSON boolean true turns review diff on. */
export function reviewDiffChecked(payload: unknown): boolean {
	return isRecord(payload) && payload.reviewDiff === true;
}

/** The `checkpoint` document's payload, wherever the caller got its docs from. */
export function reviewDiffDocPayload(docs: {namespace: string; payload: unknown}[]): unknown {
	return namespacePayload(docs, reviewDiffNamespace);
}

/**
 * Switch state for gating review traffic. Before settings load the store's docs are empty,
 * which would read as off and mute a working feature behind a wrong "review diff is off"
 * notice — so an unknown switch asks the engine (the authority) instead of short-circuiting
 * locally. Only a confirmed off mutes the call.
 */
export function reviewDiffSwitchOn(status: SettingsStatus, payload: unknown): boolean {
	return status === 'ready' ? reviewDiffChecked(payload) : true;
}

export function reviewDiffPatch(on: boolean): {
	namespace: typeof reviewDiffNamespace;
	patch: {reviewDiff: boolean};
} {
	return {namespace: reviewDiffNamespace, patch: {reviewDiff: on}};
}
