import {diffTab, diffTabId, type RailTab} from '../railTabs';
import type {ReviewRow} from './agentReview';

/** Right-rail tab strip state the open-diff action mutates. */
export type RailTabsState = {
	tabs: RailTab[];
	activeId: string;
};

/**
 * Open (or focus) the Monaco Diff tab for one agent change.
 *
 * Pure so the "2 Files → Diff" contract can be regression-tested without mounting Electron.
 * Returns the same state when `changeId` is missing — a capturing row has nothing to open yet.
 */
export function openReviewDiff(state: RailTabsState, changeId: string, path: string): RailTabsState {
	if (!changeId) return state;
	const id = diffTabId(changeId);
	const tabs = state.tabs.some(t => t.id === id) ? state.tabs : [...state.tabs, diffTab(changeId, path)];
	return {tabs, activeId: id};
}

/** What a review row click should ask the shell to open; `null` means the button must stay inert. */
export function reviewRowOpenTarget(row: ReviewRow): {changeId: string; path: string} | null {
	if (!row.changeId) return null;
	return {changeId: row.changeId, path: row.path};
}

/**
 * Whether a strip/App open request has already been applied for this nonce.
 *
 * App must **not** clear `openDiffRequest` on success: Strict Mode remounts reset rail tabs while
 * a cleared request cannot re-open the Diff — the rail stays on Changes ("click did nothing").
 */
export function shouldApplyOpenDiffRequest(
	request: {changeId: string; nonce: number} | null | undefined,
	handledNonce: number | null
): boolean {
	return Boolean(request?.changeId && request.nonce !== handledNonce);
}
