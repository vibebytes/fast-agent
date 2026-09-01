import {useMemo, useRef, useState} from 'react';
import type {ReviewFile, ReviewList} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown} from 'lucide-react';
import {rememberReviewStats, reviewRowChangeIds, reviewRows} from '../review/agentReview';
import {reviewRowOpenTarget} from '../review/openReviewDiff';
import {ReviewRows} from '../review/ReviewRows';
import type {AgentReview} from '../review/useAgentReview';
import {UndoConfirm} from '../review/UndoConfirm';
import {useUndoFlow} from '../review/useUndoFlow';

/**
 * File review chrome above the composer.
 *
 * The rows are the daemon's record of what the agent changed, not this window's guess at it: a keep
 * or an undo is a write against a specific revision, so offering one for a row the daemon does not
 * have would either fail or, worse, hit the wrong file.
 */
export function ReviewChangesStrip({
	review,
	list,
	files,
	onOpenChange,
	onOpenFile
}: {
	review: AgentReview;
	/** The daemon's review list trimmed to the current session — what the drawer shows. */
	list: ReviewList;
	/** Live projection from the running turn — fills stats and shows paths not yet recorded. */
	files: ReviewFile[];
	onOpenChange?: (changeId: string, path: string) => void;
	/** Opens the plain file editor for a row that has no diff to show (already decided). */
	onOpenFile?: (path: string) => void;
}) {
	const undo = useUndoFlow(review);
	// Survive the turn: once tool-event +/- is seen, keep it after the live projection clears.
	const statsRef = useRef(new Map<string, {add: number; del: number}>());
	const rows = useMemo(() => {
		statsRef.current = rememberReviewStats(statsRef.current, files);
		return reviewRows(list, files, statsRef.current);
	}, [list, files]);
	const decidable = rows.filter(row => row.state === 'pending' && row.changeId);
	const countLabel = `${rows.length} File${rows.length === 1 ? '' : 's'}`;
	// Strip only mounts when there are rows — start collapsed so the file list does not crowd the
	// composer on open; the user expands it when they want to review.
	const [open, setOpen] = useState(false);

	return (
		<>
			<Collapsible open={open} onOpenChange={setOpen}>
				<div className="flex h-7 items-center gap-1.5 px-2">
					<CollapsibleTrigger asChild>
						<button
							type="button"
							className={cn(
								'flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground',
								'hover:bg-muted/60 hover:text-foreground'
							)}
							aria-label={open ? 'Collapse file list' : 'Expand file list'}
						>
							<ChevronDown
								className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
							/>
							<span className="truncate">{countLabel}</span>
						</button>
					</CollapsibleTrigger>
					<div className="flex shrink-0 items-center gap-1">
						{list.available ? (
							<>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									className="h-6 px-2 text-xs text-muted-foreground"
									disabled={review.busy || decidable.length === 0}
									onClick={() =>
										undo.start({
											kind: 'changes',
											changeIds: decidable.flatMap(row => reviewRowChangeIds(row))
										})
									}
								>
									Undo All
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									className="h-6 px-2 text-xs text-muted-foreground"
									disabled={review.busy || decidable.length === 0}
									onClick={() =>
										void review.keep(decidable.flatMap(row => reviewRowChangeIds(row)))
									}
								>
									Keep All
								</Button>
							</>
						) : (
							// Checkpoints are off for this workspace: nothing was recorded, so there is no
							// undo to offer and pretending otherwise would be the worst outcome.
							<span className="px-1 text-[11px] text-muted-foreground">
								Can't be undone — checkpoints are off
							</span>
						)}
					</div>
				</div>
				{review.notice ? (
					<p className="px-3 pb-1 text-[11px] text-destructive">{review.notice}</p>
				) : null}
				<CollapsibleContent>
					{/* Commit-style file rows (no commit header): status · icon · path · +/- · decisions */}
					<ReviewRows
						rows={rows}
						review={review}
						className="max-h-56 overflow-y-auto"
						onOpen={row => {
							if (onOpenFile) onOpenFile(row.path);
							else {
								const target = reviewRowOpenTarget(row);
								if (target) onOpenChange?.(target.changeId, target.path);
							}
						}}
						onOpenFile={onOpenFile}
						onUndo={changeIds => undo.start({kind: 'changes', changeIds})}
					/>
				</CollapsibleContent>
			</Collapsible>
			{undo.plan ? (
				<UndoConfirm
					preview={undo.plan}
					busy={review.busy}
					onCancel={undo.cancel}
					onConfirm={undo.confirm}
				/>
			) : null}
		</>
	);
}
