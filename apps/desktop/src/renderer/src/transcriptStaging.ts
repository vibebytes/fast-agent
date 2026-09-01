/** Cold Transcript mount: show the newest Turn first, then reveal the tail window by frame. */
export const TRANSCRIPT_STAGING_INITIAL_SECTIONS = 1;

/** rAF batch while staging up to the tail window. */
export const TRANSCRIPT_STAGING_BATCH_SECTIONS = 3;

/**
 * Interactive tail window: a Task switch mounts only this many newest sections
 * eagerly, so switch cost is O(window) instead of O(conversation length).
 * Older sections arrive via idle backfill or near-top reveal. Measured: each
 * heavy section commits in 100–250ms, so 2 keeps the switch under ~300ms.
 */
export const TRANSCRIPT_TAIL_WINDOW_SECTIONS = 2;

/** Idle backfill batch — one heavy section per idle slice keeps input responsive. */
export const TRANSCRIPT_BACKFILL_BATCH_SECTIONS = 1;

/** Near-top reveal page — the user is actively reading history, page in more at once. */
export const TRANSCRIPT_REVEAL_PAGE_SECTIONS = 6;

export type TranscriptStagingPhase = 'waiting' | 'staging' | 'backfill' | 'complete';

export type TranscriptStagingState = {
	key: string | null;
	total: number;
	visible: number;
	phase: TranscriptStagingPhase;
};

export type TranscriptStagingInput = {
	key: string | null;
	total: number;
	/** A slim focus is still waiting for its authoritative body pull. */
	loading: boolean;
	/** This Task was already staged during the current Transcript mount (A→B→A). */
	revisited: boolean;
};

function complete(key: string | null, total: number): TranscriptStagingState {
	return {key, total, visible: total, phase: 'complete'};
}

function initial(input: TranscriptStagingInput): TranscriptStagingState {
	const total = Math.max(0, input.total);
	if (!input.key) return complete(input.key, total);
	if (input.revisited) {
		// Revisit skips the 1-section replay but still windows the tail: mounting
		// the full conversation at once blocked the renderer 1.5s+ on long threads.
		return total > TRANSCRIPT_TAIL_WINDOW_SECTIONS
			? {
					key: input.key,
					total,
					visible: TRANSCRIPT_TAIL_WINDOW_SECTIONS,
					phase: 'backfill'
				}
			: complete(input.key, total);
	}
	if (total > TRANSCRIPT_STAGING_INITIAL_SECTIONS) {
		return {
			key: input.key,
			total,
			visible: TRANSCRIPT_STAGING_INITIAL_SECTIONS,
			phase: 'staging'
		};
	}
	if (input.loading) return {key: input.key, total, visible: total, phase: 'waiting'};
	return complete(input.key, total);
}

/**
 * Reconcile staging with the latest Task/body shape.
 *
 * While the window is open (staging/backfill), a section-count change is a new
 * Turn appended at the tail (engine history prepends only fire after the local
 * window is fully revealed — near-top reveal precedes `requestOlderHistory`).
 * Grow `visible` by the delta so the window's top boundary stays stable and the
 * new Turn is visible immediately.
 */
export function reconcileTranscriptStaging(
	previous: TranscriptStagingState,
	input: TranscriptStagingInput
): TranscriptStagingState {
	const total = Math.max(0, input.total);
	if (previous.key !== input.key) return initial({...input, total});
	if (!input.key || previous.phase === 'complete') {
		return previous.total === total && previous.visible === total
			? previous
			: complete(input.key, total);
	}
	if (previous.phase === 'waiting') {
		if (total > TRANSCRIPT_STAGING_INITIAL_SECTIONS) return initial({...input, total});
		if (input.loading) {
			return previous.total === total && previous.visible === total
				? previous
				: {key: input.key, total, visible: total, phase: 'waiting'};
		}
		return complete(input.key, total);
	}
	// staging | backfill
	if (previous.total !== total) {
		const grown = Math.max(0, total - previous.total);
		const visible = Math.min(total, previous.visible + grown);
		return visible >= total
			? complete(input.key, total)
			: {key: input.key, total, visible, phase: previous.phase};
	}
	if (previous.visible >= total) return complete(input.key, total);
	return previous;
}

/**
 * Reveal `batch` more sections. Staging hands over to idle backfill once the
 * interactive tail window is mounted; backfill continues until complete.
 */
export function advanceTranscriptStaging(
	state: TranscriptStagingState,
	batch = TRANSCRIPT_STAGING_BATCH_SECTIONS
): TranscriptStagingState {
	if (state.phase !== 'staging' && state.phase !== 'backfill') return state;
	// Staging never overshoots the tail window — the batch exists to reach the
	// window fast, not to mount beyond it in one commit.
	const cap =
		state.phase === 'staging'
			? Math.max(state.visible, TRANSCRIPT_TAIL_WINDOW_SECTIONS)
			: Number.MAX_SAFE_INTEGER;
	const visible = Math.min(state.total, cap, state.visible + Math.max(1, batch));
	if (visible >= state.total) return complete(state.key, state.total);
	if (state.phase === 'staging' && visible >= TRANSCRIPT_TAIL_WINDOW_SECTIONS) {
		return {key: state.key, total: state.total, visible, phase: 'backfill'};
	}
	return {...state, visible};
}

/** Keep section boundaries intact; the window only changes how many newest Turns mount. */
export function visibleTranscriptSections<T>(
	sections: T[],
	state: TranscriptStagingState
): T[] {
	if (state.phase !== 'staging' && state.phase !== 'backfill') return sections;
	if (state.visible >= sections.length) return sections;
	return sections.slice(Math.max(0, sections.length - state.visible));
}
