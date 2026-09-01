import {useCallback, useState} from 'react';
import type {ReviewPreview} from '@fast-ide/session-view';
import type {AgentReview, UndoTarget} from './useAgentReview';

/**
 * The two phases of an undo, held together: plan first, write only after the user has seen the plan.
 *
 * Every entry point shares this hook so none of them can grow a one-click undo — the confirm step is
 * where excluded paths, merged edits and forced overwrites are disclosed, and skipping it anywhere
 * would make those disclosures optional.
 */
export function useUndoFlow(review: AgentReview): {
	plan: ReviewPreview | null;
	start: (target: UndoTarget) => void;
	confirm: (force: boolean) => void;
	cancel: () => void;
} {
	const [plan, setPlan] = useState<ReviewPreview | null>(null);

	const start = useCallback(
		(target: UndoTarget) =>
			void (async () => {
				const preview = await review.planUndo(target);
				if (preview) setPlan(preview);
			})(),
		[review.planUndo]
	);

	const confirm = useCallback(
		(force: boolean) =>
			void (async () => {
				if (!plan) return;
				if (await review.applyUndo(plan.id, force)) setPlan(null);
			})(),
		[plan, review.applyUndo]
	);

	const cancel = useCallback(() => setPlan(null), []);

	return {plan, start, confirm, cancel};
}
