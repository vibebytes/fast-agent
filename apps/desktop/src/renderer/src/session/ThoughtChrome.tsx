import {useEffect, useRef, useState} from 'react';
import type {ProcessStackStep, TimelineItem} from '@fast-ide/session-view';
import {TextShimmer} from '@fast-ide/ui/components/ai-shimmer';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronRight} from 'lucide-react';
import type {TFunction} from 'i18next';
import {useTranslation} from 'react-i18next';
import {ToolCard} from '../ToolCard';
import {formatThoughtChrome} from './formatChrome';
import {LiveTicker} from './LiveTicker';
import {
	LIVE_TICKER_ROWS,
	auxiliaryChromeOpen,
	exploreTickerLines,
	nextAuxiliaryUserOpen,
	shouldMountExploringFullList,
	shouldUseLiveTicker,
	tickerTailLines
} from './tickerTail';

/** ~8 collapsed label rows; inner Thought/Exploring bodies scroll inside this budget. */
const PROCESS_STACK_MAX_H = 'max-h-[12.5rem]';

export function ThoughtCollapsible({item}: {item: Extract<TimelineItem, {kind: 'thought'}>}) {
	const {t} = useTranslation();
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const defaultOpen = item.open;
	const prevDefault = useRef(defaultOpen);
	const scrollRef = useRef<HTMLPreElement>(null);
	const label = formatThoughtChrome(item.chrome, t);

	useEffect(() => {
		if (prevDefault.current !== defaultOpen) {
			setUserOpen(null);
			prevDefault.current = defaultOpen;
		}
	}, [defaultOpen]);

	const open = auxiliaryChromeOpen({itemOpen: item.open, userOpen});
	const useTicker = shouldUseLiveTicker({itemOpen: item.open, userOpen});
	const tickerLines = useTicker
		? tickerTailLines(item.text, LIVE_TICKER_ROWS)
		: [];

	// Full-body mode: keep the pre scrolled to the live tail while streaming.
	useEffect(() => {
		if (!useTicker && open && item.open && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [open, item.open, item.text, useTicker]);

	return (
		<Collapsible
			className={cn(
				'group/thought',
				item.open && userOpen === null && 'transition-[max-height] duration-200 ease-out'
			)}
			open={open}
			onOpenChange={next =>
				setUserOpen(
					nextAuxiliaryUserOpen({
						itemOpen: item.open,
						userOpen,
						requestedOpen: next
					})
				)
			}
		>
			<CollapsibleTrigger className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-normal text-muted-foreground/80 outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
				<ChevronRight className="size-3.5 shrink-0 opacity-60 transition-transform group-data-[state=open]/thought:rotate-90" />
				{item.open ? (
					<TextShimmer className="text-[12px] font-normal" duration={1.6} spread={2}>
						{label}
					</TextShimmer>
				) : (
					<span className="inline-block min-w-0 max-w-full truncate">{label}</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				{useTicker ? (
					tickerLines.length > 0 ? <LiveTicker lines={tickerLines} /> : null
				) : (
					<pre
						ref={scrollRef}
						data-scrollable
						className="my-1 max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-border/70 pl-2.5 font-sans text-[12px] leading-relaxed text-muted-foreground/90"
					>
						{item.text}
					</pre>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

function visibleToolSummary(title: string, summary: string | null): string | null {
	const value = summary?.trim();
	if (!value) return null;
	if (value === title.trim() || title.includes(value)) return null;
	return value;
}

export function ExploringCollapsible({item}: {item: Extract<TimelineItem, {kind: 'exploring'}>}) {
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const defaultOpen = item.open;
	const prevDefault = useRef(defaultOpen);

	useEffect(() => {
		if (prevDefault.current !== defaultOpen) {
			setUserOpen(null);
			prevDefault.current = defaultOpen;
		}
	}, [defaultOpen]);

	const open = auxiliaryChromeOpen({itemOpen: item.open, userOpen});
	const useTicker = shouldUseLiveTicker({itemOpen: item.open, userOpen});
	const tickerLines = useTicker
		? exploreTickerLines(item.tools, LIVE_TICKER_ROWS)
		: [];
	const mountFullList = shouldMountExploringFullList({
		itemOpen: item.open,
		userOpen
	});

	return (
		<Collapsible
			className="group/exploring"
			open={open}
			onOpenChange={next =>
				setUserOpen(
					nextAuxiliaryUserOpen({
						itemOpen: item.open,
						userOpen,
						requestedOpen: next
					})
				)
			}
		>
			<CollapsibleTrigger className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-normal text-muted-foreground/80 outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
				<ChevronRight className="size-3.5 shrink-0 opacity-60 transition-transform group-data-[state=open]/exploring:rotate-90" />
				{item.open ? (
					<TextShimmer className="text-[12px] font-normal" duration={1.6} spread={2}>
						{item.summary}
					</TextShimmer>
				) : (
					<span className="inline-block min-w-0 max-w-full truncate">{item.summary}</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				{useTicker ? (
					tickerLines.length > 0 ? <LiveTicker lines={tickerLines} /> : null
				) : mountFullList ? (
					<ul className="my-1 space-y-0.5 border-l-2 border-border/70 pl-2.5 text-[11.5px] leading-5 text-muted-foreground">
						{item.tools.map(t => {
							const summary = visibleToolSummary(t.title, t.summary);
							return (
								<li
									key={t.id}
									className="flex min-w-0 items-baseline gap-1.5 font-mono text-[11.5px]"
								>
									<span className="max-w-[70%] shrink-0 truncate text-foreground/85">
										{t.title}
									</span>
									{summary ? (
										<span className="min-w-0 truncate text-muted-foreground/60">
											— {summary}
										</span>
									) : null}
								</li>
							);
						})}
					</ul>
				) : null}
			</CollapsibleContent>
		</Collapsible>
	);
}

function ProcessStackStepRow({step}: {step: ProcessStackStep}) {
	return (
		<div className="relative">
			{step.kind === 'thought' ? (
				<ThoughtCollapsible item={step} />
			) : step.kind === 'exploring' ? (
				<ExploringCollapsible item={step} />
			) : (
				<ToolCard item={step} />
			)}
		</div>
	);
}

function processStackCollapsedLabel(
	item: Extract<TimelineItem, {kind: 'processStack'}>,
	t: TFunction
): string {
	const last = item.steps.at(-1);
	if (!last) return t('shell.process.steps', {count: item.stepCount});
	if (last.kind === 'exploring') return last.summary;
	if (last.kind === 'thought') return formatThoughtChrome(last.chrome, t);
	return last.title || t('shell.process.steps', {count: item.stepCount});
}

export function ProcessStackView({item}: {item: Extract<TimelineItem, {kind: 'processStack'}>}) {
	const {t} = useTranslation();
	// Always start collapsed — `item.open` is the live-tip / shimmer signal only.
	const [open, setOpen] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const running = item.open;
	// Collapsed + running → latest folded line with shimmer (not a static "N steps").
	const triggerLabel =
		!open && running
			? processStackCollapsedLabel(item, t)
			: t('shell.process.steps', {count: item.stepCount});

	useEffect(() => {
		if (!open) return;
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [open, item.stepCount, item.steps]);

	return (
		<Collapsible
			data-slot="process-rail"
			className="group/process-stack before:bg-muted-foreground/45"
			open={open}
			onOpenChange={setOpen}
		>
			<CollapsibleTrigger className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-normal text-muted-foreground/80 outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
				<ChevronRight className="size-3.5 shrink-0 opacity-60 transition-transform group-data-[state=open]/process-stack:rotate-90" />
				{running ? (
					<TextShimmer className="text-[12px] font-normal" duration={1.6} spread={2}>
						{triggerLabel}
					</TextShimmer>
				) : (
					<span className="inline-block min-w-0 max-w-full truncate">{triggerLabel}</span>
				)}
				{item.cancelled ? (
					<span className="shrink-0 text-[10px] font-normal tracking-wide text-muted-foreground/45">
						{t('shell.process.cancelled')}
					</span>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div
					ref={scrollRef}
					data-scrollable
					className={cn(PROCESS_STACK_MAX_H, 'mt-1 overflow-y-auto pl-2 border-l border-border/50 ml-1.5 space-y-1 py-0.5')}
				>
					<div className="flex flex-col gap-1">
						{item.steps.map(step => (
							<ProcessStackStepRow key={step.id} step={step} />
						))}
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
