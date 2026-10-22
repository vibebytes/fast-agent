import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {useTranslation} from 'react-i18next';
import type {
	FileReviewDiff,
	ReviewDiffSnapshot,
	ReviewList,
	ReviewPreview,
	ReviewRefusal
} from '@fast-ide/session-view';
import {
	emptyReview,
	mergeReviewDiff,
	pendingChanges,
	refusalAction,
	reviewDiffFor,
	reviewInvalidated,
	sameReviewList,
	withRenameGroups
} from './agentReview';
import {settingsStore} from '../settings/useSettings';
import {reviewDiffDocPayload, reviewDiffSwitchOn} from '../settings/reviewDiffForm';

export type UndoTarget =
	| {kind: 'pending'}
	| {kind: 'whole'; checkpointId: string}
	| {kind: 'timeline'; checkpointId: string}
	| {kind: 'changes'; changeIds: string[]};

export type AgentReview = {
	list: ReviewList;
	pending: ReviewList['changes'];
	/**
	 * The daemon's batched per-path hunks for the undecided rows (review-diff-batch-hunks §三).
	 * One answer feeds every card and the editor overlay; null until the first answer lands.
	 */
	diff: ReviewDiffSnapshot | null;
	/** Hunks for one path from the batched snapshot, or undefined when that path has no pending effect. */
	diffFor: (path: string) => FileReviewDiff | undefined;
	/**
	 * One path with the batch hunk-line cap lifted. Used when the snapshot marked the file
	 * `too-many-changes` and the editor still needs hunks to paint.
	 */
	fileDiff: (path: string) => Promise<FileReviewDiff | null>;
	/** A read or decision is in flight; decision buttons should not stack up. */
	busy: boolean;
	/** Whatever the daemon last refused, in its own words. Cleared by the next successful call. */
	notice: string | null;
	/**
	 * Checkpoints whose snapshot the daemon says is gone.
	 *
	 * Remembered because the answer will not change: a restore point that has been pruned must stop
	 * being offered, not be offered again and fail again.
	 */
	expired: ReadonlySet<string>;
	refresh: () => void;
	keep: (changeIds: string[]) => Promise<boolean>;
	/** Plans an undo without writing; hand the result to `applyUndo` to commit it. */
	planUndo: (target: UndoTarget) => Promise<ReviewPreview | null>;
	applyUndo: (previewId: string, force?: boolean) => Promise<boolean>;
	redo: (restoreId: string) => Promise<boolean>;
	/** Experimental switch. Off means review commands are closed even when the checkpoint backend is git. */
	reviewDiffOn: boolean;
};

/** i18n key when the engine refuses review because the experimental switch is off. */
export const reviewDiffUnavailableKey = 'settings.experimental.reviewDiffUnavailable';

/**
 * Closed switch must not ask for hunks, even when pending rows are already on the list.
 * An open switch still skips the call when nothing is undecided.
 */
export function pullsReviewDiff(reviewDiffOn: boolean, pendingCount: number): boolean {
	return reviewDiffOn && pendingCount > 0;
}

/** `unavailable` while the experimental switch is off is the review-diff hint, not a disabled backend. */
export function shouldExplainReviewDiffOff(reviewDiffOn: boolean, unavailable: boolean): boolean {
	return unavailable && !reviewDiffOn;
}

/**
 * One decision for the poll loop: whether to ask for hunks, and whether a skipped ask should
 * carry the switch hint. `unavailable` reads it off the daemon's own list answer — the only
 * real signal — never off the local pending count, which says nothing about the switch.
 */
export function reviewDiffGate(reviewDiffOn: boolean, list: ReviewList | null): {
	pull: boolean;
	explain: boolean;
} {
	const pending = list != null ? pendingChanges(list).length : 0;
	return {
		pull: pullsReviewDiff(reviewDiffOn, pending),
		explain: shouldExplainReviewDiffOff(reviewDiffOn, list != null && !list.available)
	};
}

/**
 * The agent change review for one Project.
 *
 * Held per Project rather than per Task because a checkout is what gets changed: two conversations in
 * the same folder are looking at one list, and the daemon addresses it by checkout too. The list is
 * re-read on every push rather than patched locally — a restore can come from another window, and a
 * projection this window guessed at would offer undo for changes that are already gone.
 *
 * Contents stay out: rows carry no file bytes, and a diff is fetched only for the file being opened.
 */
export function useAgentReview(projectId: string | null, sessionId: string | null): AgentReview {
	const {t} = useTranslation();
	const settings = useSyncExternalStore(
		settingsStore.subscribe,
		settingsStore.getSnapshot,
		settingsStore.getSnapshot
	);
	const reviewDiffOn = reviewDiffSwitchOn(
		settings.status,
		reviewDiffDocPayload(settings.docs)
	);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [expired, setExpired] = useState<ReadonlySet<string>>(EMPTY_EXPIRED);
	// A refresh in flight when the next push lands must not overwrite the newer answer.
	const readSeq = useRef(0);
	// Last answer per (project, session): a task revisit starts from the cached
	// list instead of flashing empty, and an unchanged re-fetch keeps the object
	// identity (sameReviewList) so transcript row memos survive the round trip.
	const listCache = useRef(new Map<string, ReviewList>());
	const cacheKey = `${projectId ?? ''}\u0000${sessionId ?? ''}`;
	const [shown, setShown] = useState<{key: string; list: ReviewList}>(() => ({
		key: cacheKey,
		list: emptyReview
	}));
	const [diff, setDiff] = useState<ReviewDiffSnapshot | null>(null);
	const diffHeld = useRef<ReviewDiffSnapshot | null>(null);
	diffHeld.current = diff;
	// Render-phase swap: the first frame after a task switch must already carry
	// that session's cached list — a one-commit stale list rebuilt every
	// transcript row's renderItem cache and re-rendered all sections twice.
	if (shown.key !== cacheKey) {
		setShown({key: cacheKey, list: listCache.current.get(cacheKey) ?? emptyReview});
		setDiff(null);
	}
	const list = shown.list;
	const setList = useCallback(
		(next: ReviewList | ((prev: ReviewList) => ReviewList)) => {
			setShown(prev => ({
				key: prev.key,
				list: typeof next === 'function' ? next(prev.list) : next
			}));
		},
		[]
	);

	const refresh = useCallback((mode: 'full' | 'incremental' = 'full', deferNet = false) => {
		if (!projectId) {
			setList(emptyReview);
			setDiff(null);
			return;
		}
		const key = cacheKey;
		const seq = ++readSeq.current;
		const since = mode === 'incremental' ? diffHeld.current?.revision : undefined;
		const run = () => {
			// Closed switch: the daemon refuses every review command, so asking would only buy a
			// refused round trip on every push. Answer locally with the same shape the refusal would
			// have produced, and keep the hint the panes still show.
			if (!reviewDiffOn) {
				if (seq !== readSeq.current) return;
				const closed: ReviewList = {revision: 0, changes: [], available: false};
				setList(prev => {
					const stable = sameReviewList(prev, closed) ? prev : closed;
					rememberList(listCache.current, key, stable);
					return stable;
				});
				setNotice(t(reviewDiffUnavailableKey));
				setDiff(prev => prev ?? {revision: 0, files: []});
				return;
			}
			void (async () => {
				let list: ReviewList | null = null;
				try {
					const answer = await window.fastIde.listReviewChanges(projectId, null, sessionId);
					if (seq !== readSeq.current) return;
					if (answer.ok) {
						list = answer.list;
						setList(prev => {
							const stable = sameReviewList(prev, answer.list) ? prev : answer.list;
							rememberList(listCache.current, key, stable);
							return stable;
						});
						setNotice(null);
					} else if (refusalAction(answer) === 'unavailable') {
						const unavailable: ReviewList = {revision: 0, changes: [], available: false};
						list = unavailable;
						setList(prev => {
							const stable = sameReviewList(prev, unavailable) ? prev : unavailable;
							rememberList(listCache.current, key, stable);
							return stable;
						});
						setNotice(null);
					} else {
						setNotice(answer.notice);
					}
				} catch {
					if (seq !== readSeq.current) return;
					setNotice('Review engine unreachable');
					if (mode === 'full') setDiff(prev => prev ?? {revision: 0, files: []});
					return;
				}
				if (seq !== readSeq.current) return;
				const gate = reviewDiffGate(reviewDiffOn, list);
				if (!gate.pull) {
					if (gate.explain) {
						setNotice(t(reviewDiffUnavailableKey));
					}
					if (mode === 'full') setDiff(prev => prev ?? {revision: 0, files: []});
					return;
				}
				try {
					const diffAnswer = await window.fastIde.listReviewDiff(projectId, since);
					if (seq !== readSeq.current) return;
					if (diffAnswer.ok) {
						setDiff(prev => mergeReviewDiff(mode === 'incremental' ? prev : null, diffAnswer.diff));
					} else if (mode === 'full') {
						setDiff(prev => prev ?? {revision: 0, files: []});
					}
				} catch {
					if (seq !== readSeq.current) return;
					if (mode === 'full') setDiff(prev => prev ?? {revision: 0, files: []});
				}
			})();
		};
		if (!deferNet) run();
		else if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run());
		else setTimeout(run, 0);
	}, [projectId, sessionId, cacheKey, reviewDiffOn, t]);

	useEffect(() => {
		// List swap happens render-phase above; only chrome resets here.
		setNotice(null);
		setExpired(EMPTY_EXPIRED);
		refresh('full', true);
	}, [refresh, cacheKey]);

	useEffect(() => {
		if (!projectId) return;
		let timer: number | undefined;
		const unsub = window.fastIde.onBridgeEvent(payload => {
			if (payload.projectId !== projectId || !reviewInvalidated(payload.event)) return;
			// One agent batch fires both pushes; coalescing keeps a wide checkpoint from re-listing twice.
			window.clearTimeout(timer);
			timer = window.setTimeout(() => refresh('incremental'), 120);
		});
		return () => {
			unsub();
			window.clearTimeout(timer);
		};
	}, [projectId, refresh]);

	/** Runs one decision, reporting a refusal and re-reading afterwards either way. */
	const decide = useCallback(
		async <T>(
			run: (project: string) => Promise<{ok: true} & T | ReviewRefusal>,
			onRefusal?: (refusal: ReviewRefusal) => void
		): Promise<T | null> => {
			if (!projectId) return null;
			setBusy(true);
			try {
				const answer = await run(projectId);
				if (answer.ok) {
					setNotice(null);
					return answer as T;
				}
				const action = refusalAction(answer);
				setNotice(
					shouldExplainReviewDiffOff(reviewDiffOn, action === 'unavailable')
						? t(reviewDiffUnavailableKey)
						: answer.notice
				);
				onRefusal?.(answer);
				// A stale revision or a moved path means this window's list was behind, so the honest next
				// step is to show what the daemon actually has. An expired snapshot is not that: the list
				// is fine, the history it points at is gone.
				if (action !== 'report' && action !== 'expired') refresh();
				return null;
			} catch (e) {
				// Bridge died mid-call: surface it instead of dropping the failure silently.
				setNotice(e instanceof Error ? e.message : 'Review engine call failed');
				return null;
			} finally {
				setBusy(false);
			}
		},
		[projectId, refresh, reviewDiffOn, t]
	);

	const keep = useCallback(
		async (changeIds: string[]) => {
			const covered = withRenameGroups(list, changeIds);
			if (!covered.length) return false;
			const done = await decide(project =>
				window.fastIde.keepReviewChanges(project, covered, list.revision)
			);
			// A keep does not move the revision, so nothing pushes; re-read to drop the decided rows.
			if (done) refresh('full');
			return done !== null;
		},
		[decide, list, refresh]
	);

	const planUndo = useCallback(
		async (target: UndoTarget) => {
			const answer = await decide<{preview: ReviewPreview}>(
				project =>
					window.fastIde.previewRevert(project, {
						target: target.kind,
						revision: list.revision,
						...('checkpointId' in target ? {checkpointId: target.checkpointId} : {}),
						...('changeIds' in target
							? {changeIds: withRenameGroups(list, target.changeIds)}
							: {})
					}),
				refusal => {
					if (!refusal.expired || !('checkpointId' in target)) return;
					setExpired(prev => new Set(prev).add(target.checkpointId));
				}
			);
			return answer?.preview ?? null;
		},
		[decide, list]
	);

	const applyUndo = useCallback(
		async (previewId: string, force?: boolean) =>
			(await decide(project => window.fastIde.applyRevert(project, previewId, force))) !== null,
		[decide]
	);

	const redo = useCallback(
		async (restoreId: string) =>
			(await decide(project => window.fastIde.redoRevert(project, restoreId))) !== null,
		[decide]
	);

	const pending = useMemo(() => pendingChanges(list), [list]);
	const diffFor = useCallback((path: string) => reviewDiffFor(diff?.files, path), [diff]);
	const fileDiff = useCallback(
		async (path: string) => {
			if (!projectId) return null;
			const answer = await window.fastIde.getFileReviewDiff(projectId, path);
			if (answer.ok) return answer.file;
			if (shouldExplainReviewDiffOff(reviewDiffOn, refusalAction(answer) === 'unavailable')) {
				setNotice(t(reviewDiffUnavailableKey));
			}
			return null;
		},
		[projectId, reviewDiffOn, t]
	);

	return {
		list,
		pending,
		diff,
		diffFor,
		fileDiff,
		busy,
		notice,
		expired,
		reviewDiffOn,
		refresh,
		keep,
		planUndo,
		applyUndo,
		redo
	};
}

const EMPTY_EXPIRED: ReadonlySet<string> = new Set();

const LIST_CACHE_MAX = 16;

function rememberList(cache: Map<string, ReviewList>, key: string, list: ReviewList): void {
	cache.delete(key);
	cache.set(key, list);
	while (cache.size > LIST_CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) return;
		cache.delete(oldest);
	}
}
