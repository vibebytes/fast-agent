import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {reviewFiles} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ChevronRight, X} from 'lucide-react';
import type {CodeChange} from '../env';
import {FileTypeIcon} from '../files/FileTypeIcon';
import {blockedNotice, rememberReviewStats, reviewRowChangeIds, reviewRows, type ReviewRow} from '../review/agentReview';
import {CheckpointNotice} from '../review/CheckpointNotice';
import {UndoConfirm} from '../review/UndoConfirm';
import {useUndoFlow} from '../review/useUndoFlow';
import type {AgentReview} from '../review/useAgentReview';
import {basename} from '../session/path';

const KindLetter: Record<ReviewRow['kind'], {letter: string; labelKey: string; className: string}> = {
	added: {letter: 'A', labelKey: 'shell.changes.kindAdded', className: 'text-emerald-600 dark:text-emerald-400'},
	deleted: {letter: 'D', labelKey: 'shell.changes.kindDeleted', className: 'text-red-500 dark:text-red-400'},
	renamed: {letter: 'R', labelKey: 'shell.changes.kindRenamed', className: 'text-sky-600 dark:text-sky-400'},
	modified: {letter: 'M', labelKey: 'shell.changes.kindModified', className: 'text-amber-600 dark:text-amber-400'}
};

const StateLabel: Record<ReviewRow['state'], string> = {
	pending: 'shell.changes.statePending',
	reverted: 'shell.changes.stateReverted',
	kept: 'shell.changes.stateKept',
	conflict: 'shell.changes.stateConflict',
	capturing: 'shell.changes.capturing'
};

/**
 * Inline Diff Card: Codex-style card with file header and unified diff stream.
 */
function InlineDiffCard({
	row,
	projectId,
	review,
	onUndo,
	onOpenDiff,
	onOpenFile
}: {
	row: ReviewRow;
	projectId: string | null;
	review: AgentReview;
	onUndo: (changeIds: string[]) => void;
	onOpenDiff?: (row: ReviewRow) => void;
	onOpenFile?: (path: string) => void;
}) {
	const {t} = useTranslation();
	const [expanded, setExpanded] = useState(true);

	// The whole file group, so a file edited N times shows one cumulative diff instead of one
	// checkpoint. `row.changeIds` is oldest → newest; fall back to the head change alone.
	const changeIds = reviewRowChangeIds(row);
	const fileDiff = review.diffFor(row.path);
	const loading = review.diff === null && Boolean(projectId);
	const add = fileDiff && (fileDiff.additions > 0 || fileDiff.deletions > 0) ? fileDiff.additions : row.add;
	const del = fileDiff && (fileDiff.additions > 0 || fileDiff.deletions > 0) ? fileDiff.deletions : row.del;

	const kindInfo = KindLetter[row.kind];
	const decidable = row.state === 'pending' && Boolean(row.changeId) && review.list.available;

	return (
		<div className="box-border w-full min-w-[220px] overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xs">
			{/* Card Header */}
			<div
				className="flex w-full min-w-0 items-center justify-between border-b border-border/50 bg-muted/30 px-2 py-1.5 text-xs select-none hover:bg-muted/50 gap-1"
				onClick={() => setExpanded(prev => !prev)}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
					<button
						type="button"
						className="inline-flex size-4 shrink-0 items-center justify-center rounded-xs text-muted-foreground"
						aria-label={expanded ? t('shell.fileEdit.collapseDiff') : t('shell.fileEdit.expandDiff')}
					>
						<ChevronRight
							className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')}
						/>
					</button>
					<span
						className={cn(
							'w-3.5 shrink-0 text-center font-mono text-[11px] font-bold leading-none',
							kindInfo.className
						)}
						title={t(kindInfo.labelKey)}
					>
						{kindInfo.letter}
					</span>
					<span className="flex size-4 shrink-0 items-center justify-center">
						<FileTypeIcon name={basename(row.path)} size={15} />
					</span>
					<span
						className={cn(
							'min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-foreground',
							row.kind === 'deleted' && 'line-through decoration-red-500/60',
							onOpenFile && 'cursor-pointer hover:underline'
						)}
						title={row.path}
						onClick={
							onOpenFile
								? e => {
										e.stopPropagation();
										onOpenFile(row.path);
									}
								: undefined
						}
					>
						{row.path}
					</span>
					<span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] font-semibold tabular-nums">
						{add > 0 ? (
							<span className="text-emerald-600 dark:text-emerald-400">+{add}</span>
						) : null}
						{del > 0 ? (
							<span className="text-red-500 dark:text-red-400">-{del}</span>
						) : null}
					</span>
				</div>

				{/* Card Actions */}
				<div className="flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
					{decidable ? (
						<>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-5 text-muted-foreground hover:bg-red-500/15 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 active:scale-95 transition-all"
								disabled={review.busy}
								title={t('shell.changes.undoChange')}
								aria-label={t('shell.changes.undoChangeAria', {path: row.path})}
								onClick={() => onUndo(changeIds)}
							>
								<X className="size-3" />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-5 text-muted-foreground hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-400 active:scale-95 transition-all"
								disabled={review.busy}
								title={t('shell.changes.keepChange')}
								aria-label={t('shell.changes.keepChangeAria', {path: row.path})}
								onClick={() => void review.keep(changeIds)}
							>
								<Check className="size-3 text-emerald-600 dark:text-emerald-400" />
							</Button>
						</>
					) : (
						<span className="text-[10px] text-muted-foreground">{t(StateLabel[row.state])}</span>
					)}
					{onOpenDiff && row.changeId ? (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-5 px-1 text-[10px] text-muted-foreground hover:text-foreground"
							title={t('shell.changes.openFullDiff')}
							onClick={() => onOpenDiff(row)}
						>
							{t('shell.changes.full')}
						</Button>
					) : null}
				</div>
			</div>

			{/* Card Body (Diff Stream) */}
			{expanded ? (
				<div className="w-full min-w-0 bg-background">
					{loading ? (
						<div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
							{t('shell.changes.loadingDiff')}
						</div>
					) : fileDiff?.broken ? (
						<div className="p-3 text-xs text-muted-foreground">
							{t('shell.reviewStatus.cardBroken')}
						</div>
					) : fileDiff?.blocked ? (
						<div className="p-3 text-xs text-muted-foreground">
							{blockedNotice(fileDiff.blocked, 'card')}
						</div>
					) : fileDiff && fileDiff.hunks.length > 0 ? (
						<div className="w-full min-w-0 overflow-hidden font-mono text-[11px] leading-5 select-text">
							{fileDiff.hunks.map((hunk, hi) => (
								<Fragment key={hi}>
									<div className="border-y border-border/40 bg-muted/60 px-3 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground select-none">
										{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
									</div>
									{hunk.lines.map((line, idx) => {
										const isAdd = line.kind === 'add';
										const isDel = line.kind === 'del';
										return (
											<div
												key={idx}
												className={cn(
													'flex items-stretch px-2 py-0.5 transition-colors hover:bg-muted/30',
													isAdd &&
														'bg-emerald-500/10 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
													isDel &&
														'bg-red-500/10 text-red-900 dark:bg-red-500/15 dark:text-red-200'
												)}
											>
												<span className="w-6 shrink-0 pr-1 text-right font-mono text-[10px] text-muted-foreground/50 tabular-nums select-none">
													{line.kind !== 'add' ? line.oldLine : ''}
												</span>
												<span className="w-6 shrink-0 pr-1 text-right font-mono text-[10px] text-muted-foreground/50 tabular-nums select-none">
													{line.kind !== 'del' ? line.newLine : ''}
												</span>
												<span className="w-3 shrink-0 text-center font-mono font-semibold select-none">
													{isAdd ? '+' : isDel ? '-' : ' '}
												</span>
												<span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line.text}</span>
											</div>
										);
									})}
								</Fragment>
							))}
						</div>
					) : (
						<div className="p-3 text-xs text-muted-foreground">
							{decidable ? t('shell.changes.noPendingDiff') : t('shell.changes.clickToOpenDiff')}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}

/**
 * The Changes tab: Codex-style Inline Diff Stack with top stats and batch actions.
 */
export function ChangesPane({
	review,
	changes,
	projectId = null,
	onOpenDiff,
	onOpenFile
}: {
	review: AgentReview;
	changes: CodeChange[];
	projectId?: string | null;
	onOpenDiff?: (row: ReviewRow) => void;
	onOpenFile?: (path: string) => void;
}) {
	const {t} = useTranslation();
	const undo = useUndoFlow(review);
	const statsRef = useRef(new Map<string, {add: number; del: number}>());
	const rows = useMemo(() => {
		const live = reviewFiles([], changes);
		statsRef.current = rememberReviewStats(statsRef.current, live);
		return reviewRows(review.list, live, statsRef.current);
	}, [review.list, changes]);
	const decidable = rows.filter(row => row.state === 'pending' && row.changeId);

	const totalAdd = useMemo(
		() =>
			rows.reduce((acc, r) => {
				const d = review.diffFor(r.path);
				return acc + (d && (d.additions > 0 || d.deletions > 0) ? d.additions : r.add || 0);
			}, 0),
		[rows, review.diff]
	);
	const totalDel = useMemo(
		() =>
			rows.reduce((acc, r) => {
				const d = review.diffFor(r.path);
				return acc + (d && (d.additions > 0 || d.deletions > 0) ? d.deletions : r.del || 0);
			}, 0),
		[rows, review.diff]
	);

	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
			{/* Header with Codex-style +N -N stats and ✓ / ✕ batch buttons */}
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-2.5 py-1.5 select-none gap-1 min-w-0">
				<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
					<span className="truncate text-xs font-medium text-foreground">
						{rows.length === 1
							? t('shell.changes.oneFile')
							: t('shell.changes.filesCount', {count: rows.length})}
					</span>
					{(totalAdd > 0 || totalDel > 0) && (
						<span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-semibold tabular-nums">
							{totalAdd > 0 && (
								<span className="text-emerald-600 dark:text-emerald-400">+{totalAdd}</span>
							)}
							{totalDel > 0 && <span className="text-red-500 dark:text-red-400">-{totalDel}</span>}
						</span>
					)}
				</div>
				{review.list.available ? (
					<span className="flex shrink-0 items-center gap-0.5">
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-6 px-1.5 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 transition-colors"
							disabled={review.busy || decidable.length === 0}
							title={t('shell.changes.undoAllTitle')}
							onClick={() => undo.start({kind: 'pending'})}
						>
							<X className="size-3.5" />
							<span>{t('shell.changes.undoAll')}</span>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-6 px-1.5 text-xs text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-400 transition-colors"
							disabled={review.busy || decidable.length === 0}
							title={t('shell.changes.keepAllTitle')}
							onClick={() =>
								void review.keep(
									decidable.flatMap(row => reviewRowChangeIds(row))
								)
							}
						>
							<Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
							<span>{t('shell.changes.keepAll')}</span>
						</Button>
					</span>
				) : null}
			</div>

			<CheckpointNotice available={review.list.available} />
			{review.notice ? (
				<p className="shrink-0 border-b px-3 py-1 text-[11px] text-destructive">{review.notice}</p>
			) : null}

			{/*
			 * Native overflow, not Radix ScrollArea: its viewport child is display:table,
			 * so cards shrink-to-content instead of filling the rail as it is dragged.
			 */}
			<div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto">
				{rows.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						<p className="mb-1 font-medium text-foreground">{t('shell.changes.emptyTitle')}</p>
						{t('shell.changes.emptyHint')}
					</div>
				) : (
					<div className="box-border flex w-full min-w-0 flex-col gap-2.5 p-2">
						{rows.map(row => (
							<InlineDiffCard
								key={row.id}
								row={row}
								projectId={projectId}
								review={review}
								onUndo={changeIds => undo.start({kind: 'changes', changeIds})}
								onOpenDiff={onOpenDiff}
								onOpenFile={onOpenFile}
							/>
						))}
					</div>
				)}
			</div>

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
