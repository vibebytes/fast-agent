import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import type {ReviewChangeDetail} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {GitCompare} from 'lucide-react';
import type {RailTab} from '../railTabs';
import {groupChangesByPath} from '../review/agentReview';
import {combinedDiffView, DiffModes, drifted, type DiffMode} from '../review/diffSides';
import type {AgentReview} from '../review/useAgentReview';
import {UndoConfirm} from '../review/UndoConfirm';
import {useUndoFlow} from '../review/useUndoFlow';

// Monaco is multi-MB — same lazy boundary as the document editor (perf doc P1-9).
const MonacoDiff = lazy(() => import('../MonacoDiff').then(m => ({default: m.MonacoDiff})));

/**
 * One agent change, as a diff, with the decision attached.
 *
 * Content is fetched per open file rather than held in the review list: the list is re-read on every
 * push, and carrying file bytes in it would mean re-sending every diff in the workspace to answer
 * "which files changed".
 */
export function ReviewDiffPane({
	tab,
	review,
	projectId,
	refreshToken = 0
}: {
	tab: RailTab;
	review: AgentReview;
	projectId: string | null;
	/** Bumped on `workspace_file_changed` for this path — re-fetch current side. */
	refreshToken?: number;
}) {
	const changeId = tab.changeId ?? null;
	const [details, setDetails] = useState<ReviewChangeDetail[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [mode, setMode] = useState<DiffMode>('agent');
	const undo = useUndoFlow(review);

	// Re-read when the tree moves: `current` is a snapshot of the file on disk, so a restore or a
	// later write elsewhere makes the side already on screen stale.
	const revision = review.list.revision;

	// The change ids this tab covers: the whole file group, so a file edited N times shows one
	// cumulative diff (first before → last after/current) instead of one checkpoint.
	const changeIds = useMemo(() => {
		if (!changeId) return [];
		for (const group of groupChangesByPath(review.list).values()) {
			if (group.changeIds.includes(changeId)) return group.changeIds;
		}
		return [changeId];
	}, [review.list, changeId]);

	useEffect(() => {
		if (!projectId || changeIds.length === 0) return;
		let live = true;
		void (async () => {
			const answers = await Promise.all(
				changeIds.map(id => window.fastIde.getReviewChange(projectId, id))
			);
			if (!live) return;
			const fetched: ReviewChangeDetail[] = [];
			let refusedNotice: string | null = null;
			for (const answer of answers) {
				if (answer.ok) fetched.push(answer.change);
				else {
					refusedNotice = answer.notice;
					break;
				}
			}
			if (refusedNotice !== null) {
				setNotice(refusedNotice);
			} else {
				setDetails(fetched);
				setNotice(null);
			}
		})();
		return () => {
			live = false;
		};
	}, [projectId, changeIds, revision, refreshToken]);

	const row = useMemo(
		() => review.list.changes.find(change => change.id === changeId) ?? null,
		[review.list, changeId]
	);
	const decidable = row?.state.kind === 'pending' && review.list.available;
	const combined = useMemo(
		() => (details.length > 0 ? combinedDiffView(details, mode) : null),
		[details, mode]
	);
	const view = combined?.view ?? null;
	const path = details[0]?.path ?? tab.filePath ?? tab.title;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
				<div className="flex items-center gap-2">
					<GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={path}>
						{path}
					</span>
					{decidable ? (
						<span className="flex shrink-0 items-center gap-0.5">
							<Button
								type="button"
								variant="ghost"
								size="xs"
								className="h-6 px-2 text-xs"
								disabled={review.busy}
								onClick={() => undo.start({kind: 'changes', changeIds})}
							>
								Undo
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="xs"
								className="h-6 px-2 text-xs"
								disabled={review.busy}
								onClick={() => void review.keep(changeIds)}
							>
								Keep
							</Button>
						</span>
					) : (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{row ? row.state.kind : 'no longer pending'}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					{DiffModes.map(option => (
						<button
							key={option.mode}
							type="button"
							title={option.hint}
							onClick={() => setMode(option.mode)}
							className={cn(
								'rounded px-1.5 py-0.5 text-[11px]',
								option.mode === mode
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
							)}
						>
							{option.label}
						</button>
					))}
					{view ? (
						<span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
							{view.originalLabel} → {view.modifiedLabel}
						</span>
					) : null}
				</div>
				{combined?.broken ? (
					<p className="text-[11px] text-amber-600 dark:text-amber-400">
						You edited this file between the agent’s changes, so the edits no longer join up —
						showing the last one only.
					</p>
				) : details.length > 0 && drifted(details[details.length - 1]!) ? (
					// Said out loud because Keep accepts what is on disk, not what is on screen: a file
					// edited after the agent left it would be kept in its edited form.
					<p className="text-[11px] text-amber-600 dark:text-amber-400">
						This file changed again after the agent edited it — “Since agent” shows by whom.
					</p>
				) : null}
				{notice ? <p className="text-[11px] text-destructive">{notice}</p> : null}
				{review.notice ? <p className="text-[11px] text-destructive">{review.notice}</p> : null}
			</div>
			{!view ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{notice ? 'No diff to show' : 'Loading diff…'}
				</div>
			) : view.blocked ? (
				<div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
					{view.blocked}
				</div>
			) : (
				<Suspense
					fallback={
						<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
							Loading diff…
						</div>
					}
				>
					<MonacoDiff original={view.original} modified={view.modified} path={path} />
				</Suspense>
			)}
			{undo.plan ? (
				<UndoConfirm
					preview={undo.plan}
					busy={review.busy}
					onCancel={undo.cancel}
					onConfirm={undo.confirm}
				/>
			) : null}
		</div>
	);
}
