import type {ReviewChangeDetail, ReviewSide} from '@fast-ide/session-view';
import {sideNotice} from './agentReview';

/**
 * Which two of the three recorded states a diff is showing.
 *
 * The agent's own change is `before → after`, and it is the default because it is the only pair that
 * answers "what did the agent do here" — the file on disk may have moved on since, and mixing that in
 * would put someone else's edit under the agent's name.
 */
export type DiffMode = 'agent' | 'since' | 'net';

export const DiffModes: {mode: DiffMode; label: string; hint: string}[] = [
	{mode: 'agent', label: 'Agent change', hint: 'Before the agent ↔ after the agent'},
	{mode: 'since', label: 'Since agent', hint: 'After the agent ↔ the file on disk now'},
	{mode: 'net', label: 'Net', hint: 'Before the agent ↔ the file on disk now'}
];

export type DiffView = {
	original: string;
	modified: string;
	originalLabel: string;
	modifiedLabel: string;
	/** Set when one side cannot be rendered; no editor should be mounted in that case. */
	blocked: string | null;
};

const Labels = {
	before: 'Before agent',
	after: 'After agent',
	current: 'On disk now'
} as const;

/**
 * Whether the file moved after the agent left it.
 *
 * Compared by blob id rather than by text, so it stays correct for the sides that were too large to
 * inline — those are exactly the files where a wrong answer would be most expensive.
 */
export function drifted(detail: ReviewChangeDetail): boolean {
	return (detail.after?.id ?? null) !== (detail.current?.id ?? null);
}

/** A missing side is an empty document — that is what added and deleted look like. */
function text(side: ReviewSide): {value: string} | {blocked: string} {
	if (!side) return {value: ''};
	if (side.text !== undefined) return {value: side.text};
	return {blocked: sideNotice(side) ?? 'Content unavailable'};
}

export function diffView(detail: ReviewChangeDetail, mode: DiffMode): DiffView {
	return buildView(
		mode === 'agent'
			? ([detail.before, detail.after, Labels.before, Labels.after] as const)
			: mode === 'since'
				? ([detail.after, detail.current, Labels.after, Labels.current] as const)
				: ([detail.before, detail.current, Labels.before, Labels.current] as const)
	);
}

function buildView(
	pair: readonly [ReviewSide, ReviewSide, string, string]
): DiffView {
	const [left, right, originalLabel, modifiedLabel] = pair;
	const original = text(left);
	const modified = text(right);
	const blocked =
		'blocked' in original ? original.blocked : 'blocked' in modified ? modified.blocked : null;
	return {
		original: 'value' in original ? original.value : '',
		modified: 'value' in modified ? modified.value : '',
		originalLabel,
		modifiedLabel,
		blocked
	};
}

export type CombinedDiff = {
	view: DiffView;
	/**
	 * True when a user edit landed between two agent edits, so the recorded chain no longer joins up.
	 * The view then falls back to the head change alone and the UI must say so rather than splice.
	 */
	broken: boolean;
};

/**
 * Combine N edits to one file into a single cumulative diff.
 *
 * `'agent'` = first `before` → last `after`; `'net'` = first `before` → last `current`;
 * `'since'` = last `after` → last `current`. The chain is validated by blob id —
 * `detail[i].after.id` must equal `detail[i+1].before.id`. A broken chain (a user edit between two
 * agent edits) falls back to the head change alone and reports `broken`.
 */
export function combinedDiffView(details: ReviewChangeDetail[], mode: DiffMode): CombinedDiff {
	if (details.length === 0) {
		return {view: buildView([null, null, Labels.before, Labels.after]), broken: false};
	}
	if (details.length === 1) return {view: diffView(details[0]!, mode), broken: false};

	const broken = details.some(
		(d, i) => i > 0 && d.before?.id !== details[i - 1]!.after?.id
	);
	if (broken) return {view: diffView(details[details.length - 1]!, mode), broken: true};

	const first = details[0]!;
	const head = details[details.length - 1]!;
	return {
		view: buildView(
			mode === 'agent'
				? ([first.before, head.after, Labels.before, Labels.after] as const)
				: mode === 'since'
					? ([head.after, head.current, Labels.after, Labels.current] as const)
					: ([first.before, head.current, Labels.before, Labels.current] as const)
		),
		broken: false
	};
}
