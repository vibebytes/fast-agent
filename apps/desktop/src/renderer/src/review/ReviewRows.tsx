import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {FileTypeIcon} from '../files/FileTypeIcon';
import {basename} from '../session/path';
import type {ReviewRow} from './agentReview';
import {reviewRowChangeIds} from './agentReview';
import type {AgentReview} from './useAgentReview';

const KindLetter: Record<ReviewRow['kind'], {letter: string; label: string; className: string}> = {
	added: {letter: 'A', label: 'Added', className: 'text-emerald-600 dark:text-emerald-400'},
	deleted: {letter: 'D', label: 'Deleted', className: 'text-red-500 dark:text-red-400'},
	renamed: {letter: 'R', label: 'Renamed', className: 'text-sky-600 dark:text-sky-400'},
	modified: {letter: 'M', label: 'Modified', className: 'text-amber-600 dark:text-amber-400'}
};

/**
 * The reviewable file rows, shared by the composer strip and the Changes pane.
 *
 * Shared because which row offers which decision is the part that must not drift between the two
 * places: a Keep the strip offers and the pane withholds for the same file would be read as a bug in
 * whichever one the user believes less.
 */
export function ReviewRows({
	rows,
	review,
	onOpen,
	onOpenFile,
	onUndo,
	className
}: {
	rows: ReviewRow[];
	review: AgentReview;
	/** Opens the diff for a row; rows still being captured have nothing to open. */
	onOpen?: (row: ReviewRow) => void;
	/** Opens the plain file editor for a row that has no diff to show (already decided). */
	onOpenFile?: (path: string) => void;
	onUndo: (changeIds: string[]) => void;
	className?: string;
}) {
	return (
		<ul className={cn('space-y-0.5 px-1.5 pb-2', className)}>
			{rows.map(row => {
				const kind = KindLetter[row.kind];
				const decidable = row.state === 'pending' && Boolean(row.changeId) && review.list.available;
				return (
					<li key={row.id} className="group/row">
						<div
							className={cn(
								'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-muted/70',
								// A decided row is history: shown so the file does not vanish, dimmed so it
								// does not read as still awaiting an answer.
								row.state !== 'pending' && 'opacity-60'
							)}
							title={row.reason ?? row.path}
						>
							<button
								type="button"
								className="flex min-w-0 flex-1 items-center gap-2 text-left"
								disabled={!onOpen && !onOpenFile}
								onClick={() => {
									if (row.changeId && onOpen) onOpen(row);
									else onOpenFile?.(row.path);
								}}
							>
								<span
									className={cn(
										'w-3.5 shrink-0 text-center font-mono text-[11px] font-semibold leading-none',
										kind.className
									)}
									aria-label={kind.label}
								>
									{kind.letter}
								</span>
								<span className="flex size-4 shrink-0 items-center justify-center">
									<FileTypeIcon name={basename(row.path)} size={16} />
								</span>
								<span
									className={cn(
										'min-w-0 flex-1 truncate font-mono text-[12px] text-foreground',
										row.kind === 'deleted' && 'line-through decoration-red-500/60'
									)}
								>
									{row.path}
								</span>
							</button>
							<span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
								{row.add > 0 ? (
									<span className="text-emerald-600 dark:text-emerald-400">+{row.add}</span>
								) : null}
								{row.del > 0 ? (
									<span className="text-red-500 dark:text-red-400">-{row.del}</span>
								) : null}
								{row.state === 'capturing' ? (
									<span className="text-muted-foreground">…</span>
								) : null}
							</span>
							{decidable ? (
								<span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
									<Button
										type="button"
										variant="ghost"
										size="xs"
										className="h-5 px-1.5 text-[11px]"
										disabled={review.busy}
										onClick={() => onUndo(reviewRowChangeIds(row))}
									>
										Undo
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										className="h-5 px-1.5 text-[11px]"
										disabled={review.busy}
										onClick={() => void review.keep(reviewRowChangeIds(row))}
									>
										Keep
									</Button>
								</span>
							) : null}
							{row.state === 'conflict' ? (
								<span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
									conflict
								</span>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
