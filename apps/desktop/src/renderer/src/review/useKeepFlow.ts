import {createContext, useCallback, useRef, useState} from 'react';
import {dirtyOverlap, pathsCoveredBy} from './agentReview';
import type {AgentReview} from './useAgentReview';

/** Document-tab paths whose Monaco buffer has diverged from disk. Empty when the rail is clean. */
export const ReviewDirtyPaths = createContext<readonly string[]>([]);

/**
 * Wraps `review.keep` so a dirty editor cannot be accepted in one click
 * (review-diff-batch-hunks §5.3). Call sites keep using `review.keep`.
 */
export function useKeepFlow(
	review: AgentReview,
	dirtyPaths: readonly string[]
): {
	keep: (changeIds: string[]) => Promise<boolean>;
	pending: readonly string[] | null;
	confirm: () => void;
	cancel: () => void;
} {
	const [pending, setPending] = useState<{ids: string[]; dirty: string[]} | null>(null);
	const resolveRef = useRef<((ok: boolean) => void) | null>(null);
	const keepOf = review.keep;
	const list = review.list;

	const keep = useCallback(
		(changeIds: string[]) => {
			const dirty = dirtyOverlap(dirtyPaths, pathsCoveredBy(list, changeIds));
			if (dirty.length === 0) return keepOf(changeIds);
			resolveRef.current?.(false);
			return new Promise<boolean>(resolve => {
				resolveRef.current = resolve;
				setPending({ids: changeIds, dirty});
			});
		},
		[dirtyPaths, keepOf, list]
	);

	const confirm = useCallback(() => {
		const ids = pending?.ids;
		const resolve = resolveRef.current;
		resolveRef.current = null;
		setPending(null);
		if (!ids) {
			resolve?.(false);
			return;
		}
		void keepOf(ids).then(ok => resolve?.(ok));
	}, [keepOf, pending]);

	const cancel = useCallback(() => {
		resolveRef.current?.(false);
		resolveRef.current = null;
		setPending(null);
	}, []);

	return {keep, pending: pending?.dirty ?? null, confirm, cancel};
}
