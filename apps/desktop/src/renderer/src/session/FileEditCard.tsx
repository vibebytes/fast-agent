import {useMemo, useState} from 'react';
import {diffPreview, lineNumberFor, type DiffLine, type TimelineItem} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronDown, ChevronUp} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {basename} from './path';
import {shouldThresholdFoldFile} from '../thresholdFold';
import {formatFileOp} from './formatChrome';

const FILE_DIFF_COLLAPSED_LINES = 5;
/** ~17 rows at leading-5 — matches expanded file-card max height. */
const FILE_DIFF_EXPANDED_MAX_LINES = 17;

export function FileEditCard({
	item,
	onOpenFile
}: {
	item: Extract<TimelineItem, {kind: 'file'}>;
	onOpenFile?: (path: string, line?: number, endLine?: number) => void;
}) {
	const {t} = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const [thresholdOpen, setThresholdOpen] = useState(false);
	const fileName = basename(item.path);
	const opLabel = formatFileOp(item.op, t);
	const thresholdFold = shouldThresholdFoldFile(item);
	const hasNoLines = item.lines.length === 0;
	const foldEmpty = hasNoLines && item.status !== 'running';
	const collapsible = thresholdFold || foldEmpty;
	const bodyVisible = !collapsible || thresholdOpen;
	const canExpand = !thresholdFold && item.lines.length > FILE_DIFF_COLLAPSED_LINES;
	const collapsedLines = useMemo(
		() => diffPreview(item.lines, FILE_DIFF_COLLAPSED_LINES),
		[item.lines]
	);
	const expandedLines = useMemo(
		() => item.lines.slice(0, Math.min(item.lines.length, 48)),
		[item.lines]
	);
	const bodyExpanded = thresholdFold || expanded;
	const visibleLines = bodyVisible
		? bodyExpanded
			? expandedLines
			: collapsedLines
		: [];
	const truncatedBeyondCard = item.hidden > 0 || item.lines.length > FILE_DIFF_EXPANDED_MAX_LINES;
	const gutterWidth = Math.max(
		1,
		...visibleLines.map(line => String(lineNumberFor(line) ?? '').length),
		1
	);

	const trailing = (
		<>
			{item.add > 0 ? <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">+{item.add}</span> : null}
			{item.add > 0 && item.del > 0 ? ' ' : null}
			{item.del > 0 ? <span className="font-mono font-medium text-red-600 dark:text-red-400">-{item.del}</span> : null}
			{item.add === 0 && item.del === 0 ? (
				<span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
					{item.status === 'running' ? '…' : (opLabel || 'Updated')}
				</span>
			) : null}
		</>
	);

	const title = onOpenFile && !thresholdFold ? (
		<button
			type="button"
			className="min-w-0 max-w-full cursor-pointer truncate text-left hover:underline"
			title={item.path}
			onClick={e => {
				e.preventDefault();
				e.stopPropagation();
				onOpenFile(item.path);
			}}
		>
			{fileName}
		</button>
	) : (
		fileName
	);

	return (
		<WindowFrame
			variant="editor"
			title={title}
			trailing={trailing}
			titleShimmer={item.status === 'running'}
			collapsible={collapsible}
			defaultOpen={item.status === 'running'}
			{...(collapsible
				? {open: thresholdOpen, onOpenChange: setThresholdOpen}
				: {})}
			className="w-full"
		>
			{bodyVisible ? (
				<>
					{item.lines.length > 0 ? (
						<div className="group/diff relative">
							<div
								className={cn(
									'font-mono text-[11px] leading-5',
									bodyExpanded ? 'overflow-y-auto' : 'overflow-hidden'
								)}
								style={{
									maxHeight: bodyExpanded
										? `calc(${FILE_DIFF_EXPANDED_MAX_LINES} * 1.25rem)`
										: `calc(${FILE_DIFF_COLLAPSED_LINES} * 1.25rem)`
								}}
							>
								{visibleLines.map((line, index) => (
									<DiffRow
										key={`${item.id}-${bodyExpanded ? index : `c-${index}`}`}
										line={line}
										gutterWidth={gutterWidth}
									/>
								))}
							</div>
							{canExpand ? (
								<button
									type="button"
									aria-expanded={expanded}
									aria-label={expanded ? t('shell.fileEdit.collapseDiff') : t('shell.fileEdit.expandDiff')}
									className={cn(
										'absolute inset-x-0 bottom-0 z-10 flex h-7 cursor-pointer items-end justify-center pb-0.5',
										'text-muted-foreground transition-opacity hover:text-foreground',
										'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
										expanded
											? 'opacity-100'
											: 'opacity-0 group-hover/diff:opacity-100'
									)}
									onClick={() => setExpanded(v => !v)}
								>
									<span
										aria-hidden
										className={cn(
											'pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent',
											expanded && 'opacity-0'
										)}
									/>
									{expanded ? (
										<ChevronUp className="relative size-3.5" />
									) : (
										<ChevronDown className="relative size-3.5" />
									)}
								</button>
							) : null}
						</div>
					) : (
						<div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs text-muted-foreground bg-muted/10">
							<div className="flex items-center gap-2">
								<span className="font-medium text-foreground/80">
									{item.status === 'running' ? 'Writing…' : (opLabel || 'File updated')}
								</span>
								{item.status !== 'running' && (
									<span className="text-[11px] text-muted-foreground/70">
										· full content write
									</span>
								)}
							</div>
							{onOpenFile ? (
								<Button
									type="button"
									variant="ghost"
									size="xs"
									className="h-6 cursor-pointer gap-1 px-2 text-[11px] text-foreground/80 hover:bg-muted hover:text-foreground"
									onClick={() => onOpenFile(item.path)}
								>
									Open file
								</Button>
							) : null}
						</div>
					)}
					{truncatedBeyondCard && onOpenFile ? (
						<div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5">
							<span className="text-[11px] text-muted-foreground">
								Preview capped
								{item.hidden > 0 ? ` · ${item.hidden} more lines in file` : ''}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="xs"
								className="h-6 px-2 text-[11px]"
								onClick={() => onOpenFile(item.path)}
							>
								Open full file
							</Button>
						</div>
					) : null}
				</>
			) : null}
		</WindowFrame>
	);
}

function DiffRow({line, gutterWidth}: {line: DiffLine; gutterWidth: number}) {
	if (line.type === 'hunk' || line.type === 'other') {
	return (
			<div className="px-3 py-0.5 text-muted-foreground">{line.content}</div>
		);
	}
	const number = lineNumberFor(line);
	const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
	const rowClass =
		line.type === 'add'
			? 'bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
			: line.type === 'del'
				? 'bg-red-500/10 text-red-950 dark:text-red-100'
				: 'text-foreground';
	const gutterClass =
		line.type === 'add'
			? 'bg-emerald-500/15 text-emerald-800/80 dark:text-emerald-200/80'
			: line.type === 'del'
				? 'bg-red-500/15 text-red-800/80 dark:text-red-200/80'
				: 'text-muted-foreground';

	return (
		<div className={cn('flex min-w-0', rowClass)}>
			<span
				className={cn(
					'w-10 shrink-0 select-none pr-2 text-right tabular-nums',
					gutterClass
				)}
				style={{width: `${gutterWidth + 1.5}ch`}}
			>
				{number ?? ''}
			</span>
			<span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2 py-0.5">
				<span className="select-none opacity-70">{prefix} </span>
				{line.content}
			</span>
			</div>
	);
}

