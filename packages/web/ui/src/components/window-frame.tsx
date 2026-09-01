import {useState, type ReactNode} from 'react';
import {TextShimmer} from '@fast-ide/ui/components/ai-shimmer';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronRight, FileCode2, Terminal} from 'lucide-react';

export type WindowFrameVariant = 'terminal' | 'editor';
export type WindowFrameTone = 'default' | 'error' | 'success';

type WindowFrameProps = {
	variant: WindowFrameVariant;
	/** Optional status tone (error highlights frame in subtle red). */
	tone?: WindowFrameTone;
	/** Optional semantic icon; defaults to the variant's terminal/editor glyph. */
	leading?: ReactNode;
	/** Center / primary title (tool name, filename, shell). */
	title: ReactNode;
	/** Optional right-side meta (e.g. +N -M, status). */
	trailing?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	/** Cursor-style: header only until expanded. */
	collapsible?: boolean;
	/** Initial open state when `collapsible` (default false). */
	defaultOpen?: boolean;
	/** Optional controlled open state for cards that derive their body window. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Sweep shimmer across the whole header while the tool is running. */
	titleShimmer?: boolean;
};

/**
 * Compact chat chrome (think / tool card style).
 * - `terminal` — tool runs / shell output
 * - `editor` — file edits & code (incl. diff)
 */
export function WindowFrame({
	variant,
	tone = 'default',
	leading,
	title,
	trailing,
	children,
	className,
	bodyClassName,
	collapsible = false,
	defaultOpen = false,
	open: controlledOpen,
	onOpenChange,
	titleShimmer = false
}: WindowFrameProps) {
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const open = controlledOpen ?? internalOpen;
	const isTerminal = variant === 'terminal';
	const isError = tone === 'error';
	const Icon = isTerminal ? Terminal : FileCode2;

	const headerInner = (
		<>
			{leading ?? (
				<Icon
					className={cn(
						'relative z-[1] size-3.5 shrink-0',
						isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
					)}
					aria-hidden
				/>
			)}
			{titleShimmer && typeof title === 'string' ? (
				<TextShimmer className="relative z-[1] min-w-0 flex-1 text-left text-xs font-medium tracking-[-0.01em]">
					{title}
				</TextShimmer>
			) : (
				<div
					className={cn(
						'relative z-[1] min-w-0 flex-1 truncate text-left text-xs font-medium tracking-[-0.01em]',
						isError ? 'text-red-950 dark:text-red-200' : 'text-foreground/85'
					)}
				>
					{title}
				</div>
			)}
			{trailing ? (
				<div className="relative z-[1] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
					{trailing}
				</div>
			) : null}
			{collapsible ? (
				<ChevronRight
					className={cn(
						'relative z-[1] size-3.5 shrink-0 text-muted-foreground transition-transform',
						open && 'rotate-90'
					)}
					aria-hidden
				/>
			) : null}
		</>
	);

	const frameClass = cn(
		'w-full min-w-0 overflow-hidden rounded-md text-foreground shadow-none transition-all duration-150',
		isError
			? collapsible && !open
				? 'border border-red-500/25 bg-red-500/[0.03] hover:border-red-500/40 hover:bg-red-500/[0.06]'
				: 'border border-red-500/30 bg-red-500/[0.02] dark:border-red-500/30 dark:bg-red-500/[0.04]'
			: collapsible && !open
				? 'border border-border/30 bg-muted/10 hover:border-border/50 hover:bg-muted/20'
				: 'border border-border/50 bg-background',
		className
	);

	const headerClass = cn(
		'relative flex h-8 w-full shrink-0 items-center gap-2 overflow-hidden px-2.5 text-left outline-none transition-colors',
		isError
			? collapsible && !open
				? 'bg-red-500/[0.05] hover:bg-red-500/[0.08]'
				: 'bg-red-500/[0.07] hover:bg-red-500/[0.10]'
			: collapsible && !open
				? 'bg-transparent hover:bg-muted/20'
				: 'bg-muted/15 hover:bg-muted/30',
		(!collapsible || open) && (isError ? 'border-b border-red-500/20' : 'border-b border-border/50'),
		collapsible && 'cursor-pointer select-none',
		titleShimmer && 'ai-shimmer-header'
	);

	// Explicitly avoid mounting heavy pre/highlight/diff children while closed.
	const body = !collapsible || open ? (
		<div
			className={cn(
				'min-h-0',
				isTerminal ? 'bg-background font-mono text-[12px] leading-relaxed' : 'bg-background',
				bodyClassName
			)}
		>
			{children}
		</div>
	) : null;

	if (!collapsible) {
		return (
			<div
				className={frameClass}
				data-slot="window-frame"
				data-variant={variant}
			>
				<div className={headerClass}>{headerInner}</div>
				{body}
			</div>
		);
	}

	return (
		<Collapsible
			open={open}
			onOpenChange={next => {
				if (controlledOpen === undefined) setInternalOpen(next);
				onOpenChange?.(next);
			}}
			className="w-full min-w-0"
			data-slot="window-frame"
			data-variant={variant}
			data-state={open ? 'open' : 'closed'}
		>
			<div className={frameClass}>
				<CollapsibleTrigger className={headerClass}>{headerInner}</CollapsibleTrigger>
				<CollapsibleContent>{body}</CollapsibleContent>
			</div>
		</Collapsible>
	);
}
