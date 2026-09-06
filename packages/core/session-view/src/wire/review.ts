/**
 * Agent-change review wire types (desktop File Changes / restore).
 */

export type ReviewKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** Where a change stands. Only `pending` is still the user's to decide. */
export type ReviewChangeState = {
	kind: 'pending' | 'reverted' | 'kept' | 'conflict';
	/** Why an undo cannot run cleanly — shown as-is; the daemon writes it for a reader. */
	reason?: string;
};

/**
 * One side of a diff, or `null` when the path did not exist there.
 *
 * `omitted` is not a rendering hint: `missing` means the store no longer has the bytes, so this path
 * cannot be undone either, and the UI has to say that rather than keep offering a diff.
 */
export type ReviewSide = {
	id: string;
	text?: string;
	bytes?: number;
	omitted?: 'binary' | 'too-large' | 'missing';
} | null;

/** A review row without its file contents — what the drawer lists. */
export type ReviewChange = {
	id: string;
	checkpointId: string;
	path: string;
	kind: ReviewKind;
	state: ReviewChangeState;
	groupId?: string | null;
};

/** One row plus the three sides a diff needs, fetched only for the file being looked at. */
export type ReviewChangeDetail = ReviewChange & {
	before: ReviewSide;
	after: ReviewSide;
	/** What is on disk now — differs from `after` once the user has edited on top. */
	current: ReviewSide;
};

/**
 * A planned undo, before anything is written.
 *
 * The three path lists are the whole point of the two-phase shape: `forcePaths` needs a second
 * confirmation, `excludedPaths` cannot be undone at all, and `mergedPaths` will fold in edits made
 * after the agent's rather than discard them.
 */
export type ReviewPreview = {
	id: string;
	revision: number;
	target: {kind: 'timeline' | 'whole' | 'pending' | 'changes'; checkpointId?: string | null};
	changes: Array<{path: string; kind: ReviewKind; previousPath?: string | null}>;
	conflicts: Array<{path: string; reason: string}>;
	excludedPaths: string[];
	forcePaths: string[];
	mergedPaths: string[];
	/**
	 * Background commands still running in this checkout. Restoring rewrites files underneath them, so
	 * the user is warned before confirming; it never blocks the undo.
	 */
	activeShells?: string[];
};

export type ReviewRestored = {restoreId: string; revision: number};

/**
 * The review list for one checkout.
 *
 * `revision` is passed back on every decision so the daemon can refuse one made against a list that
 * has since moved; `available: false` means checkpoints are off and nothing here can be undone.
 */
export type ReviewList = {
	revision: number;
	changes: ReviewChange[];
	available: boolean;
	/**
	 * Where each checkpoint sits in the conversation, so a transcript row can offer "restore to this
	 * message". Matched by `runId`, which is what a transcript row is keyed by.
	 */
	checkpoints?: ReviewAnchor[];
};

export type ReviewAnchor = {
	id: string;
	runId: string;
	messageId?: string | null;
	/** Epoch millis the checkpoint was opened. */
	at: number;
};

/** A refusal the client can act on: resync to `revision`, or re-preview after `movedPaths`. */
export type ReviewRefusal = {
	ok: false;
	notice: string;
	revision?: number;
	conflicts?: Array<{path: string; reason: string}>;
	movedPaths?: string[];
	/** Checkpoints are off; retrying will not help. */
	unavailable?: boolean;
	/** The snapshot is gone: this restore point is expired and must stop being offered. */
	expired?: boolean;
};

/** One line of a server-computed hunk; `kind` is `context`, `add` or `del`. */
export type HunkLine = {
	kind: 'context' | 'add' | 'del';
	oldLine?: number | null;
	newLine?: number | null;
	text: string;
};

/**
 * A git-style hunk over one file's net agent effect. `oldStart`/`oldLines` address the before
 * snapshot, `newStart`/`newLines` the after snapshot — the coordinates a unified diff header would
 * carry, so an editor can place overlays without re-deriving anything.
 */
export type DiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: HunkLine[];
};

/**
 * The whole-file agent effect for one path, computed by the daemon (review-diff-batch-hunks §三).
 *
 * `broken` means the blob chain could not be validated — show a notice, never a plausible-looking
 * wrong diff. `blocked` carries the reason no hunks were produced (too large, not text).
 */
export type FileReviewDiff = {
	path: string;
	changeIds: string[];
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
	afterBlobId?: string | null;
	broken: boolean;
	blocked?: string | null;
};

/** One checkout's batched review diff at a revision. */
export type ReviewDiffSnapshot = {
	revision: number;
	files: FileReviewDiff[];
	/** Paths to drop from the previous snapshot; only set when `partial` is true. */
	removedPaths?: string[];
	/**
	 * When true, `files` is a delta against the snapshot the client already holds: merge, then
	 * drop `removedPaths`. When false or omitted, replace the whole map.
	 */
	partial?: boolean;
};
