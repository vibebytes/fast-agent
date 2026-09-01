import type {GoalCardView} from '../env';

/**
 * React key for GoalCardPanel — local edits / steer drafts must reset when the
 * task or goal changes (review fix: state bled across task switches).
 */
export function goalCardKey(taskId: string | null, card: GoalCardView): string {
	return `${taskId ?? 'none'}:${card.goalId}`;
}
