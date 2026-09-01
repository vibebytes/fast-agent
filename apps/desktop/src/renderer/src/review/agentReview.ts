import type {
	ReviewAnchor,
	ReviewChange,
	FileReviewDiff,
	ReviewDiffSnapshot,
	ReviewFile,
	ReviewKind,
	ReviewList,
	ReviewRefusal,
	ReviewSide
} from '@fast-ide/session-view';
import {shellT} from '../i18n/t';

/**
 * Whether a push means the review list this renderer holds is out of date.
 *
 * Both events matter, for different reasons: `review_changed` is the projection moving, while
 * `tree_advanced` is the work tree moving — including a restore this window did not start. The
 * revision the event carries is not used as a version to compare against, because a keep does not
 * move it; re-reading the list is the only safe response.
 */
export function reviewInvalidated(event: {type?: string}): boolean {
	return event.type === 'review_changed' || event.type === 'tree_advanced';
}

export const emptyReview: ReviewList = {revision: 0, changes: [], available: true};

/**
 * Content equality for a re-fetched list: the daemon re-reads on every push, so
 * an unchanged answer must keep the previous object identity — downstream row
 * memos (restore affordances) key on it.
 */
export function sameReviewList(a: ReviewList, b: ReviewList): boolean {
	if (a === b) return true;
	if (a.revision !== b.revision || a.available !== b.available) return false;
	if (a.changes.length !== b.changes.length) return false;
	for (let i = 0; i < a.changes.length; i++) {
		const x = a.changes[i]!;
		const y = b.changes[i]!;
		if (
			x.id !== y.id ||
			x.path !== y.path ||
			x.checkpointId !== y.checkpointId ||
			x.kind !== y.kind ||
			(x.groupId ?? null) !== (y.groupId ?? null) ||
			x.state.kind !== y.state.kind ||
			(x.state.reason ?? null) !== (y.state.reason ?? null)
		) {
			return false;
		}
	}
	const ac = a.checkpoints ?? [];
	const bc = b.checkpoints ?? [];
	if (ac.length !== bc.length) return false;
	for (let i = 0; i < ac.length; i++) {
		const x = ac[i]!;
		const y = bc[i]!;
		if (
			x.id !== y.id ||
			x.runId !== y.runId ||
			x.at !== y.at ||
			(x.messageId ?? null) !== (y.messageId ?? null)
		) {
			return false;
		}
	}
	return true;
}

/**
 * Filter a project-scoped review list down to the changes made by one session.
 *
 * Each change is anchored to a checkpoint, and each checkpoint names the run that opened it. A run
 * belongs to exactly one session, so matching the change's checkpoint runId against the session's
 * runIds keeps only that session's edits. The live projection already covers the current turn, so
 * this only trims the daemon's recorded rows.
 */
export function reviewListForSession(
	list: ReviewList,
	runIds: ReadonlySet<string>
): ReviewList {
	if (runIds.size === 0) return {...list, changes: []};
	const runByCheckpoint = new Map<string, string>();
	for (const anchor of list.checkpoints ?? []) {
		if (anchor.runId) runByCheckpoint.set(anchor.id, anchor.runId);
	}
	const changes = list.changes.filter(change => {
		const runId = runByCheckpoint.get(change.checkpointId);
		if (runId == null) return false;
		if (runIds.has(runId)) return true;
		// A row may be keyed by its turn (`<runId>-turn-1`) rather than the run; match either form.
		for (const candidate of runIds) {
			if (candidate.replace(/-turn-\d+$/, '') === runId) return true;
		}
		return false;
	});
	return {...list, changes};
}

/**
 * The checkpoint a transcript row can restore to, keyed by the run that row started.
 *
 * A run can open several checkpoints, and the earliest is the one that answers "put the workspace back
 * the way it was before I asked this": restoring to a later one would keep the first batch of edits
 * the message caused.
 */
export function restorePoints(list: ReviewList): Map<string, ReviewAnchor> {
	const byRun = new Map<string, ReviewAnchor>();
	for (const anchor of list.checkpoints ?? []) {
		if (!anchor.runId) continue;
		const seen = byRun.get(anchor.runId);
		if (!seen || anchor.at < seen.at) byRun.set(anchor.runId, anchor);
	}
	return byRun;
}

/**
 * The restore point for a transcript row, given the run it names.
 *
 * The suffix is stripped because a row may be keyed by its turn (`<runId>-turn-1`) rather than the run
 * itself depending on how the entry was built, and the two name the same moment.
 */
export function restorePoint(
	points: Map<string, ReviewAnchor>,
	runId: string | undefined
): ReviewAnchor | null {
	if (!runId) return null;
	return points.get(runId) ?? points.get(runId.replace(/-turn-\d+$/, '')) ?? null;
}

/** Only these are still the user's to decide; the rest are shown as already settled. */
export function pendingChanges(list: ReviewList): ReviewChange[] {
	return list.changes.filter(change => change.state.kind === 'pending');
}

/**
 * The ids a decision on `changeIds` actually covers.
 *
 * A rename is two rows over one move, and undoing only the new path would leave the file in both
 * places. The daemon groups them; expanding here means the user cannot express half a rename in the
 * first place.
 */
export function withRenameGroups(list: ReviewList, changeIds: string[]): string[] {
	const chosen = new Set(changeIds);
	const groups = new Set(
		list.changes.filter(c => chosen.has(c.id) && c.groupId).map(c => c.groupId as string)
	);
	if (!groups.size) return [...chosen];
	for (const change of list.changes) {
		if (change.groupId && groups.has(change.groupId)) chosen.add(change.id);
	}
	return [...chosen];
}

/**
 * One file's worth of recorded changes, oldest first.
 *
 * The daemon records one change per checkpoint, so a file edited N times by an agent shows up as N
 * rows. Grouping by path is what lets the drawer collapse those into a single file-level row whose
 * diff spans the whole run (first `before` → last `after`/`current`) instead of one checkpoint.
 */
export type FileGroup = {
	path: string;
	kind: ReviewKind;
	state: ReviewChange['state']['kind'];
	reason?: string;
	/** All change ids for this path, oldest → newest. */
	changeIds: string[];
	/** The newest change — the one a diff tab is keyed by. */
	headChangeId: string;
};

/**
 * Group a review list's changes by file path, oldest change first within each group.
 *
 * Rename pairs share a `groupId` but sit under different paths, so they stay in separate groups here;
 * `withRenameGroups` still expands a decision across both when the user acts on one.
 */
export function groupChangesByPath(list: ReviewList): Map<string, FileGroup> {
	const groups = new Map<string, FileGroup>();
	for (const change of list.changes) {
		const key = reviewPathKey(change.path);
		const existing = groups.get(key);
		if (existing) {
			existing.changeIds.push(change.id);
			existing.headChangeId = change.id;
			existing.kind = change.kind;
			const undecided = change.state.kind === 'pending' || change.state.kind === 'conflict';
			const existingUndecided = existing.state === 'pending' || existing.state === 'conflict';
			if (undecided && existingUndecided) {
				// keep the first undecided reason; only a conflict may outrank a pending row
				if (change.state.kind === 'conflict' && existing.state === 'pending') {
					existing.state = 'conflict';
					existing.reason = change.state.reason;
				} else if (!existing.reason && change.state.reason) {
					existing.reason = change.state.reason;
				}
			} else if (undecided) {
				existing.state = change.state.kind;
				existing.reason = change.state.reason;
			} else if (!existingUndecided) {
				existing.state = change.state.kind;
			}
		} else {
			groups.set(key, {
				path: change.path,
				kind: change.kind,
				state: change.state.kind,
				reason: change.state.reason,
				changeIds: [change.id],
				headChangeId: change.id
			});
		}
	}
	return groups;
}

/**
 * The pending file group for a path, or `null` when the path has no undecided agent edits.
 *
 * Uses the same flexible path match as the +/- stats, so a tree click on `README.md` still finds a
 * group recorded as `agent/README.md`. Only `pending` groups qualify — a kept or reverted file opens
 * as a normal editor.
 */
export function pendingGroupForPath(
	list: ReviewList,
	path: string
): FileGroup | null {
	for (const group of groupChangesByPath(list).values()) {
		if (group.state !== 'pending') continue;
		if (reviewPathsMatch(group.path, path)) return group;
	}
	return null;
}

/**
 * A row in the drawer: the daemon's record of a path, plus whatever the live run knows about it.
 *
 * `capturing` is the one state with no `changeId`, and therefore the one with no decision to offer.
 * It is what a file looks like between the write tool finishing and the checkpoint being recorded —
 * showing it keeps the list from appearing to lag a run, and withholding the buttons keeps the user
 * from deciding on a change the daemon cannot name yet.
 */
export type ReviewRow = {
	id: string;
	path: string;
	kind: ReviewKind;
	state: ReviewChange['state']['kind'] | 'capturing';
	add: number;
	del: number;
	/** Absent while capturing; present means this row can be kept or undone. */
	changeId?: string;
	/** Every change id this file-level row covers, oldest first — what a decision acts on. */
	changeIds?: string[];
	reason?: string;
};

/** Path key used for +/- stats — slash-normalized, no leading `./`. */
export function reviewPathKey(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Find live/remembered line stats for a daemon path.
 *
 * Tool events and checkpoint rows often disagree on prefix (`README.md` vs `agent/README.md`); an
 * exact miss would drop the strip to +0 −0 the moment the daemon list arrives.
 */
export function reviewStatsFor(
	path: string,
	stats: ReadonlyMap<string, {add: number; del: number}>
): {add: number; del: number} {
	const key = reviewPathKey(path);
	const direct = stats.get(key);
	if (direct) return direct;
	const base = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
	for (const [p, s] of stats) {
		if (p === key || key.endsWith('/' + p) || p.endsWith('/' + key)) return s;
		const pBase = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
		if (base.length > 0 && pBase === base) return s;
	}
	return {add: 0, del: 0};
}

/** Merge freshly observed live stats into a durable map (keeps counts after the turn projection clears). */
export function rememberReviewStats(
	prior: ReadonlyMap<string, {add: number; del: number}>,
	live: ReviewFile[]
): Map<string, {add: number; del: number}> {
	const next = new Map(prior);
	for (const file of live) {
		if (file.add > 0 || file.del > 0) {
			next.set(reviewPathKey(file.path), {add: file.add, del: file.del});
		}
	}
	return next;
}

/**
 * The drawer's rows: the daemon's list is authoritative, the live projection only fills gaps.
 *
 * The other way round would be worse than merely wrong — an optimistic row for a path the daemon has
 * already reverted would offer to undo a change that no longer exists.
 *
 * `remembered` carries +/- from an earlier live projection so counts survive after the turn's
 * tool-event map is gone.
 */
export function reviewRows(
	list: ReviewList,
	live: ReviewFile[],
	remembered: ReadonlyMap<string, {add: number; del: number}> = new Map()
): ReviewRow[] {
	const stats = rememberReviewStats(remembered, live);
	// One row per file, not per checkpoint: N edits to a path collapse into a single row whose
	// decision covers every change id in the group.
	const rows: ReviewRow[] = [...groupChangesByPath(list).values()].map(group => {
		const {add, del} = reviewStatsFor(group.path, stats);
		return {
			id: group.headChangeId,
			path: group.path,
			kind: group.kind,
			state: group.state,
			add,
			del,
			changeId: group.headChangeId,
			changeIds: group.changeIds,
			reason: group.reason
		};
	});
	for (const file of live) {
		// Same flexible match as stats — otherwise `README.md` (live) + `agent/README.md` (daemon)
		// would list the path twice, once as capturing with no Keep/Undo.
		if (list.changes.some(change => reviewPathsMatch(change.path, file.path))) continue;
		rows.push({
			id: file.id,
			path: file.path,
			kind: file.del > 0 && file.add === 0 ? 'deleted' : file.add > 0 && file.del === 0 ? 'added' : 'modified',
			state: 'capturing',
			add: file.add,
			del: file.del
		});
	}
	return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function reviewPathsMatch(a: string, b: string): boolean {
	const ka = reviewPathKey(a);
	const kb = reviewPathKey(b);
	if (ka === kb || ka.endsWith('/' + kb) || kb.endsWith('/' + ka)) return true;
	const ba = ka.includes('/') ? ka.slice(ka.lastIndexOf('/') + 1) : ka;
	const bb = kb.includes('/') ? kb.slice(kb.lastIndexOf('/') + 1) : kb;
	return ba.length > 0 && ba === bb;
}

/**
 * The change ids a file-level row's Keep/Undo must cover: the whole group, not just the head.
 * Passing only `changeId` would keep the newest checkpoint and leave the rest pending forever.
 */
export function reviewRowChangeIds(row: Pick<ReviewRow, 'changeId' | 'changeIds'>): string[] {
	return row.changeIds?.length ? row.changeIds : row.changeId ? [row.changeId] : [];
}

/** Paths a Keep/Undo of `changeIds` will settle, including the other half of a rename. */
export function pathsCoveredBy(list: ReviewList, changeIds: string[]): string[] {
	const chosen = new Set(withRenameGroups(list, changeIds));
	return [...new Set(list.changes.filter(c => chosen.has(c.id)).map(c => c.path))];
}

/**
 * Open dirty editor paths that overlap a decision's files. Empty means the Keep/Undo can
 * proceed without asking — there is no unsaved buffer to overwrite or leave behind.
 */
export function dirtyOverlap(
	dirtyPaths: readonly string[],
	changePaths: readonly string[]
): string[] {
	if (!dirtyPaths.length || !changePaths.length) return [];
	return [...new Set(dirtyPaths.filter(d => changePaths.some(p => reviewPathsMatch(d, p))))];
}

/** Hunks for one path from a batched snapshot, using the same flexible match as the tree overlay. */
export function reviewDiffFor(
	files: readonly FileReviewDiff[] | undefined,
	path: string
): FileReviewDiff | undefined {
	if (!files?.length) return undefined;
	const keyed = reviewPathKey(path);
	const exact = files.find(f => reviewPathKey(f.path) === keyed);
	if (exact) return exact;
	const hits = files.filter(f => reviewPathsMatch(f.path, path));
	return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Apply a `ListReviewDiff` answer to the snapshot the renderer already holds.
 *
 * A full snapshot replaces. A partial one merges `files` and drops `removedPaths` — that is what
 * `sinceRevision` is for: agent writes during a session send only the files that moved.
 */
export function mergeReviewDiff(
	prev: ReviewDiffSnapshot | null,
	next: ReviewDiffSnapshot
): ReviewDiffSnapshot {
	if (!next.partial || !prev) {
		return {revision: next.revision, files: next.files};
	}
	const map = new Map(prev.files.map(f => [f.path, f]));
	for (const path of next.removedPaths ?? []) map.delete(path);
	for (const file of next.files) map.set(file.path, file);
	return {revision: next.revision, files: [...map.values()]};
}

/**
 * Git's blob object id for text content: SHA-1 over `blob <len>\0<bytes>`.
 *
 * Useful as a fingerprint, but not as the overlay's paint gate: Monaco `getValue()` and the
 * captured blob disagree on CRLF vs LF and a trailing newline, which would hide every mark.
 */
export async function gitBlobId(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const header = new TextEncoder().encode(`blob ${bytes.length}\u0000`);
	const payload = new Uint8Array(header.length + bytes.length);
	payload.set(header);
	payload.set(bytes, header.length);
	const digest = await crypto.subtle.digest('SHA-1', payload);
	return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 1-based line lookup matching DiffHunks / Monaco: split on `\n`, drop a trailing empty
 * fragment from a final newline, strip `\r` so CRLF and LF compare equal.
 */
export function overlayLineAt(text: string): (n: number) => string | undefined {
	const raw = text.split('\n');
	if (raw.length && raw[raw.length - 1] === '') raw.pop();
	const lines = raw.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
	return n => (n >= 1 && n <= lines.length ? lines[n - 1] : undefined);
}

export type OverlayAnchorHunks = {
	lines: readonly {kind: string; newLine?: number | null; text: string}[];
};

/**
 * Whether hunk line numbers still land on the same text in the buffer. This is what the overlay
 * actually paints against — a whole-file blob mismatch (EOL, trailing newline) is not drift.
 */
export function overlayAnchorsMatch(
	hunks: readonly OverlayAnchorHunks[],
	lineAt: (n: number) => string | undefined
): boolean {
	for (const hunk of hunks) {
		for (const entry of hunk.lines) {
			if (entry.kind === 'del') continue;
			const n = entry.newLine;
			if (n == null) continue;
			if (lineAt(n) !== entry.text) return false;
		}
	}
	return true;
}

/** What a diff side has to say when it has no text to show. */
export function sideNotice(side: ReviewSide): string | null {
	if (!side?.omitted) return null;
	switch (side.omitted) {
		case 'binary':
			return 'Binary file — no textual diff';
		case 'too-large':
			return 'Too large to show inline';
		// Not a display limit: the bytes are gone from the store, so this path cannot be put back
		// either, and offering an undo for it would be a lie.
		case 'missing':
			return 'No longer in the checkpoint store — this change cannot be undone';
	}
}

/**
 * What an inline diff says when the snapshot produced no hunks for a file.
 *
 * The two surfaces word the same reasons differently — the card is body copy with a next step, the
 * overlay status line one truncated sentence — so the context picks the phrasing.
 */
export function blockedNotice(blocked: string, context: 'overlay' | 'card'): string {
	const p = context === 'card' ? 'card' : 'overlay';
	if (blocked === 'too-large') return shellT(`shell.reviewStatus.${p}TooLarge`);
	if (blocked === 'binary') return shellT(`shell.reviewStatus.${p}Binary`);
	if (blocked === 'too-many-changes') return shellT(`shell.reviewStatus.${p}TooMany`);
	return shellT(`shell.reviewStatus.${p}None`);
}

/** How a refusal should be handled: resync, re-preview, give up, or just report. */
export type RefusalAction = 'resync' | 're-preview' | 'unavailable' | 'expired' | 'report';

export function refusalAction(refusal: ReviewRefusal): RefusalAction {
	if (refusal.unavailable) return 'unavailable';
	// Before the revision check: an expired point also reports one, and resyncing would only make the
	// UI offer the same impossible restore against a fresher list.
	if (refusal.expired) return 'expired';
	if (refusal.revision !== undefined) return 'resync';
	if (refusal.movedPaths?.length) return 're-preview';
	return 'report';
}
