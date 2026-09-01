import {memo, useEffect, useRef, useState, type ReactNode} from 'react';
import {
	buildApprovalViewModel,
	type ProcessStackStep,
	type TimelineItem
} from '@fast-ide/session-view';
import {TextShimmer} from '@fast-ide/ui/components/ai-shimmer';
import {Badge} from '@fast-ide/ui/components/badge';
import {Bubble, BubbleContent} from '@fast-ide/ui/components/bubble';
import {Button} from '@fast-ide/ui/components/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle
} from '@fast-ide/ui/components/card';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {Input} from '@fast-ide/ui/components/input';
import {Message, MessageContent} from '@fast-ide/ui/components/message';
import {Spinner} from '@fast-ide/ui/components/spinner';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Bot,
	Boxes,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Flag,
	LoaderCircle,
	RefreshCw,
	ShieldAlert,
	Square,
	X
} from 'lucide-react';
import {ErrorCardRow} from './ErrorCardRow';
import type {TFunction} from 'i18next';
import {useTranslation} from 'react-i18next';
import {parseUserSkillDisplay} from '../slashCatalog';
import {timelineItemEqual} from '../timelineItemEqual';
import {OpenFileContext, StreamingMarkdownMessage} from '../MarkdownMessage';
import {MentionText} from '../MentionText';
import {ToolCard} from '../ToolCard';
import {DshToolCard} from '../dsh/tools/DshToolCard';
import {shouldHideToolItem} from '../toolPresentation';
import {FileEditCard} from './FileEditCard';
import {formatApproval} from './formatApproval';
import {formatThoughtChrome} from './formatChrome';
import {LiveTicker} from './LiveTicker';
import {
	sendApprovalDecision,
	sendQuestionAnswer,
	usePendingDecision,
	type PendingDecision
} from './pendingDecisions';
import {QuestionBatchCard} from './QuestionBatchCard';
import {SubagentWorkCard} from './SubagentWorkCard';
import {PlanCard} from './PlanCard';
import {
	LIVE_TICKER_ROWS,
	auxiliaryChromeOpen,
	exploreTickerLines,
	nextAuxiliaryUserOpen,
	shouldMountExploringFullList,
	shouldUseLiveTicker,
	tickerTailLines
} from './tickerTail';

/** Composer-matching skill pill chrome. */
const SYSTEM_BLUE_CHIP =
	'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

/** Long bodies clamp to ~4 lines; Expand / Collapse sit under the body. */
const LONG_BODY_CHARS = 320;
const PREVIEW_LINES = 'line-clamp-4';

function isLongBody(text: string): boolean {
	return text.length >= LONG_BODY_CHARS || text.split('\n').length > 5;
}

function stopCurrentRun() {
	void window.fastIde.cancelRun();
}

/** Composer-matching skill pill (name kebab kept as Catalog id label). */
function SkillChip({name}: {name: string}) {
	return (
		<span
			className={cn(
				'inline-flex max-w-[min(100%,20rem)] shrink-0 items-center gap-1.5 align-middle',
				'rounded-md px-2 py-0.5 text-[13px] font-medium',
				SYSTEM_BLUE_CHIP
			)}
		>
			<Boxes className="size-3.5 shrink-0" />
			<span className="truncate">{name}</span>
		</span>
	);
}

/** D10 regenerate slot threaded through the user-row shells. */
type RegenSlot = {runId: string; label: string; onRegenerate: (runId: string) => void};

/** Hover regenerate chip — takes the row-right slot where Restore used to live. */
function RegenChip({runId, label, onRegenerate}: RegenSlot) {
	return (
		<button
			type="button"
			className={cn(
				'group/regen pointer-events-none absolute top-1/2 right-2 z-10 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-1',
				'rounded-md border border-border/40 bg-background/80 px-2 text-[11px] font-medium text-muted-foreground shadow-2xs backdrop-blur-sm',
				'transition-all duration-150 hover:border-border/60 hover:bg-background hover:text-foreground',
				'opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
				'group-hover/msg:pointer-events-auto group-hover/msg:opacity-100'
			)}
			title={label}
			aria-label={label}
			onClick={() => onRegenerate(runId)}
		>
			<RefreshCw className="size-3 transition-transform duration-300 ease-out group-hover/regen:-rotate-180" />
			{label}
		</button>
	);
}

/** Same shell as plain user messages: full-width rounded-2xl bubble. */
function UserMessageShell({
	canCancel,
	regen,
	children,
	className,
	/** Flatten bottom when Build Dock adheres below. */
	dockedBelow
}: {
	canCancel: boolean;
	regen?: RegenSlot;
	children: ReactNode;
	className?: string;
	dockedBelow?: boolean;
}) {
	return (
		<MessageStopHost
			canCancel={canCancel}
			className={cn('w-full bg-background', dockedBelow ? 'py-0' : 'py-1')}
		>
			<div
				className={cn(
					'w-full border-0 bg-muted/70',
					dockedBelow ? 'rounded-t-2xl rounded-b-none' : 'rounded-2xl',
					'px-4 py-3 text-[13px] leading-relaxed text-foreground wrap-break-word',
					canCancel && 'pr-12',
					className
				)}
			>
				{children}
			</div>
			{regen ? <RegenChip {...regen} /> : null}
		</MessageStopHost>
	);
}

function BodyToggle({
	expanded,
	onToggle
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	const Icon = expanded ? ChevronUp : ChevronDown;
	return (
		<button
			type="button"
			className={cn(
				'mt-2 ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
				'border border-border/40 bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground transition-colors shadow-2xs'
			)}
			onClick={onToggle}
		>
			<Icon className="size-3 shrink-0" />
			{expanded ? 'Collapse' : 'Expand'}
		</button>
	);
}

/** Clamped preview (2–3 lines) or full body; toggle always under the body. */
function CollapsibleBody({
	long,
	children
}: {
	long: boolean;
	children: ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);
	if (!long) return <>{children}</>;
	return (
		<div className="flex flex-col">
			<div
				className={cn(
					'whitespace-pre-wrap wrap-break-word',
					expanded ? 'max-h-72 overflow-auto' : PREVIEW_LINES
				)}
			>
				{children}
			</div>
			<BodyToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />
		</div>
	);
}

/**
 * Skill / slash user row: blue pill + user args only.
 * New path: `/$name [args]`. Legacy restore: `[Skill: name]…---…args` (body hidden).
 */
function SlashChip({
	text,
	canCancel,
	regen
}: {
	text: string;
	canCancel: boolean;
	regen?: RegenSlot;
}) {
	const skill = parseUserSkillDisplay(text);
	if (!skill) {
		return <UserBubble text={text} canCancel={canCancel} regen={regen} />;
	}
	const args = skill.args;
	const long = Boolean(args) && isLongBody(args);

	return (
		<UserMessageShell canCancel={canCancel} regen={regen}>
			<CollapsibleBody long={long}>
				<SkillChip name={skill.name} />
				{args ? (
					<>
						{' '}
						<MentionText text={args} />
					</>
				) : null}
			</CollapsibleBody>
		</UserMessageShell>
	);
}

/** Plain user bubble; long bodies clamp to 2–3 lines with bottom Expand/Collapse. */
function UserBubble({
	text,
	canCancel,
	regen,
	scheduled,
	wake,
	dockedBelow
}: {
	text: string;
	canCancel: boolean;
	regen?: RegenSlot;
	scheduled?: boolean;
	wake?: boolean;
	dockedBelow?: boolean;
}) {
	return (
		<UserMessageShell
			canCancel={canCancel}
			regen={regen}
			dockedBelow={dockedBelow}
			className={scheduled || wake ? 'border-l-2 border-primary/35 pl-3' : undefined}
		>
			{scheduled || wake ? (
				<span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					{scheduled ? 'Scheduled' : 'Background task'}
				</span>
			) : null}
			<CollapsibleBody long={isLongBody(text)}>
				<MentionText text={text} />
			</CollapsibleBody>
		</UserMessageShell>
	);
}

/** Hover stop only on the active user prompt and running tools/commands. */
function MessageStopHost({
	canCancel,
	children,
	className
}: {
	canCancel: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('group/msg relative', className)}>
			{children}
			{canCancel ? (
				<Button
						type="button"
					variant="default"
					size="icon-sm"
					className={cn(
						'absolute top-1/2 right-2 z-10 size-8 -translate-y-1/2 cursor-pointer rounded-full',
						'bg-foreground text-background shadow-sm hover:bg-foreground/90',
						'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100'
					)}
					aria-label="Stop"
					title="Stop (Esc)"
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						stopCurrentRun();
					}}
				>
					<Square className="size-2.5 fill-current" />
				</Button>
			) : null}
				</div>
	);
}

export type TimelineRowProps = {
	item: TimelineItem;
	/** Task-local key for Decision Transition records. */
	decisionScope: string;
	canCancel: boolean;
	showUserStop: boolean;
	onOpenFile?: (path: string, line?: number, endLine?: number) => void;
	/** PlanIds with an in-flight PlanBuild turn (PlanCard Building…). */
	buildActivePlanIds?: Set<string>;
	/** DSH respond is allow-once / reject only — hide Fast "Always allow". */
	engineKind?: 'fast' | 'dsh';
	/** P3 error-card Retry — reruns the failed run (engine RerunRun). */
	onRerun?: (runId: string) => void;
	/** P3 error-card Continue — sends a fresh plain-message run. */
	onContinueRun?: () => void;
	/** D10 regenerate — reruns the last completed answer (hover ↻ entry). */
	onRegenerate?: (runId: string) => void;
	/** D10 stale state machine — this assistant row's error card has a newer terminal. */
	errorStale?: boolean;
	/** D10 regenerate hover entry — id of the user row whose answer is the last completed one (session idle). */
	regenUserId?: string | null;
	/** A run is active in this Session — disables card actions. */
	runBusy?: boolean;
	/** Error-card Retry is in flight — not the same as composer canCancel. */
	retryBusy?: boolean;
};

export const TimelineRow = memo(function TimelineRow({
	item,
	decisionScope,
	canCancel,
	showUserStop,
	onOpenFile,
	buildActivePlanIds,
	engineKind = 'fast',
	onRerun,
	onContinueRun,
	onRegenerate,
	errorStale,
	regenUserId,
	runBusy,
	retryBusy
}: TimelineRowProps) {
	const {t} = useTranslation();
	let body: ReactNode = null;

	switch (item.kind) {
		case 'user': {
			const regen =
				!runBusy && regenUserId === item.id && item.runId && onRegenerate
					? {
							runId: item.runId,
							label: t('session.rerun.regenerateAction'),
							onRegenerate
						}
					: undefined;
			body = item.isCommand ? (
				<SlashChip text={item.text} canCancel={showUserStop} regen={regen} />
			) : (
				<UserBubble
					text={item.text}
					canCancel={showUserStop}
					regen={regen}
					scheduled={item.origin === 'scheduler_generated'}
					wake={item.origin === 'background_wake'}
					dockedBelow={Boolean(item.planBuild)}
				/>
			);
			break;
		}
		case 'thought':
			body = <ThoughtCollapsible item={item} />;
			break;
		case 'exploring':
			body = <ExploringCollapsible item={item} />;
			break;
		case 'processStack':
			body = <ProcessStackView item={item} />;
			break;
		case 'activity':
			body = <p className="text-[13px] text-muted-foreground">{item.summary}</p>;
			break;
		case 'goalFlow':
			body = <GoalFlowChrome item={item} t={t} />;
			break;
		case 'goalStepConclusion':
			body = <GoalStepConclusionChrome item={item} t={t} />;
			break;
		case 'goalOutcome':
			body = <GoalOutcomeChrome item={item} t={t} />;
			break;
		case 'file':
			body =
				item.status === 'running' ? (
					<MessageStopHost canCancel={canCancel} className="w-full">
						<FileEditCard item={item} onOpenFile={onOpenFile} />
					</MessageStopHost>
				) : (
					<FileEditCard item={item} onOpenFile={onOpenFile} />
				);
			break;
		case 'tool':
			if (shouldHideToolItem(item)) break;
			body =
				item.status === 'running' ? (
					<MessageStopHost canCancel={canCancel} className="w-full">
						{item.dshCard ? (
							<DshToolCard card={{...item.dshCard, status: item.status}} />
						) : (
							<ToolCard item={item} />
						)}
					</MessageStopHost>
				) : item.dshCard ? (
					<DshToolCard card={{...item.dshCard, status: item.status}} />
				) : (
					<ToolCard item={item} />
				);
			break;
		case 'assistant':
			// Activity is signaled by shimmer on the running card header / latest
			// collapsed process line — never a standalone thinking row.
			body =
				item.status === 'error' && (item.fault || (item.text ?? '').trim()) ? (
					<ErrorCardRow
						fault={item.fault}
						text={item.text}
						runId={item.runId ?? item.id}
						busy={Boolean(retryBusy)}
						stale={errorStale === true}
						onRetry={runId => onRerun?.(runId)}
						onContinue={() => onContinueRun?.()}
					/>
				) : item.text ? (
					<div className="group relative">
						<Message align="start">
							<MessageContent>
								<Bubble variant="ghost" align="start">
									<BubbleContent className="text-[13.5px] leading-[1.65]">
								<StreamingMarkdownMessage
									text={item.text}
									streaming={item.status === 'streaming'}
								/>
								</BubbleContent>
							</Bubble>
						</MessageContent>
					</Message>
				</div>
			) : null;
			break;
		case 'plan':
			body = <PlanCard item={item} buildActive={buildActivePlanIds?.has(item.planId)} />;
			break;
		case 'system':
			body = (
				<p
					className={cn(
						'text-[13px]',
						item.tone === 'error' && 'text-destructive',
						item.tone === 'cancelled' && 'text-muted-foreground',
						item.tone === 'info' && 'font-mono text-muted-foreground'
					)}
				>
					{item.text}
				</p>
			);
			break;
		case 'approval':
			body = <ApprovalCard item={item} scope={decisionScope} engineKind={engineKind} />;
			break;
		case 'question':
			body = <QuestionCard item={item} scope={decisionScope} />;
			break;
		case 'question_batch':
			body = <QuestionBatchCard item={item} scope={decisionScope} />;
			break;
		case 'subagent':
			body = <SubagentWorkCard item={item} />;
			break;
		default:
			body = null;
	}

	// User prompt keeps full column width; reply stream is slightly narrower paper column.
	if (item.kind === 'user' || body == null) return body;
	return (
		<OpenFileContext.Provider value={onOpenFile}>
			<div className="relative z-0 mx-auto w-[calc(100%-2.5rem)] min-w-0 max-w-[calc(100%-2.5rem)] shrink-0 self-center">
				{body}
			</div>
		</OpenFileContext.Provider>
	);
}, timelineRowPropsEqual);

/** Memo comparator — exported so the perf harness probe counts with the production contract. */
export function timelineRowPropsEqual(
	prev: TimelineRowProps,
	next: TimelineRowProps
): boolean {
	return (
		prev.decisionScope === next.decisionScope &&
		prev.canCancel === next.canCancel &&
		prev.showUserStop === next.showUserStop &&
		prev.onOpenFile === next.onOpenFile &&
		prev.buildActivePlanIds === next.buildActivePlanIds &&
		prev.engineKind === next.engineKind &&
		prev.onRerun === next.onRerun &&
		prev.onContinueRun === next.onContinueRun &&
		prev.onRegenerate === next.onRegenerate &&
		prev.errorStale === next.errorStale &&
		prev.regenUserId === next.regenUserId &&
		prev.runBusy === next.runBusy &&
		prev.retryBusy === next.retryBusy &&
		timelineItemEqual(prev.item, next.item)
	);
}

/** ~8 collapsed label rows; inner Thought/Exploring bodies scroll inside this budget. */
const PROCESS_STACK_MAX_H = 'max-h-[12.5rem]';

function goalMemberStatusLabel(status: string, t: TFunction): string {
	const s = status.toLowerCase();
	if (s === 'running') return t('shell.goal.memberRunning');
	if (s === 'success' || s === 'succeeded' || s === 'passed') return t('shell.goal.memberSuccess');
	if (s === 'error' || s === 'failed') return t('shell.goal.memberFailed');
	if (s === 'cancelled') return t('shell.goal.memberCancelled');
	return status;
}

function goalPhaseLabel(phase: string, status: string | undefined, t: TFunction): string {
	switch (phase) {
		case 'started':
			return t('shell.background.running');
		case 'paused':
			return t('shell.background.paused');
		case 'escalated':
			return t('shell.background.needsAttention');
		case 'finished': {
			const s = (status ?? '').toLowerCase();
			if (s === 'cancelled') return t('shell.goal.outcomeCancelled');
			if (s === 'failed') return t('shell.goal.outcomeFailed');
			return t('shell.goal.outcomePassed');
		}
		default:
			return phase;
	}
}

function GoalStatusChip({
	label,
	tone,
	live,
	icon
}: {
	label: string;
	tone: 'neutral' | 'live' | 'ok' | 'bad';
	live?: boolean;
	icon?: ReactNode;
}) {
	const toneClass =
		tone === 'live'
			? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
			: tone === 'ok'
				? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
				: tone === 'bad'
					? 'border-destructive/30 bg-destructive/10 text-destructive'
					: 'border-border/60 bg-muted/40 text-muted-foreground';
	return (
		<span
			className={cn(
				'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
				toneClass
			)}
		>
			{icon}
			{live ? (
				<TextShimmer className="truncate text-[11px] font-medium" duration={1.6} spread={2}>
					{label}
				</TextShimmer>
			) : (
				<span className="truncate">{label}</span>
			)}
		</span>
	);
}

function GoalFlowChrome({
	item,
	t
}: {
	item: Extract<TimelineItem, {kind: 'goalFlow'}>;
	t: TFunction;
}) {
	const phaseLive = item.phase === 'started';
	const finishedOk =
		item.phase === 'finished' &&
		(item.status ?? 'passed').toLowerCase() !== 'failed' &&
		(item.status ?? '').toLowerCase() !== 'cancelled';
	const finishedBad =
		item.phase === 'finished' &&
		((item.status ?? '').toLowerCase() === 'failed' ||
			(item.status ?? '').toLowerCase() === 'cancelled');
	const phaseTone: 'live' | 'ok' | 'bad' | 'neutral' =
		item.phase === 'started'
			? 'live'
			: item.phase === 'escalated' || finishedBad
				? 'bad'
				: finishedOk
					? 'ok'
					: 'neutral';
	const phaseText = `${t('shell.goal.flowTitle')} · ${goalPhaseLabel(item.phase, item.status, t)}`;
	return (
		<div
			className="flex flex-wrap items-center gap-1.5 px-1 py-0.5"
			title={item.members.map(m => `${m.name}: ${m.status}`).join('\n')}
		>
			<GoalStatusChip
				label={phaseText}
				tone={phaseTone}
				live={phaseLive}
				icon={
					phaseLive ? (
						<LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />
					) : finishedOk ? (
						<Check className="size-3 shrink-0" aria-hidden />
					) : (
						<Flag className="size-3 shrink-0" aria-hidden />
					)
				}
			/>
			{item.members.map(m => {
				const running = m.status === 'running';
				const ok =
					m.status === 'success' || m.status === 'succeeded' || m.status === 'passed';
				const bad = m.status === 'error' || m.status === 'failed';
				const statusText = goalMemberStatusLabel(m.status, t);
				return (
					<GoalStatusChip
						key={`${m.name}:${m.stepId ?? m.status}`}
						label={`${m.name} · ${statusText}`}
						tone={running ? 'live' : ok ? 'ok' : bad ? 'bad' : 'neutral'}
						live={running}
						icon={
							running ? (
								<LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />
							) : ok ? (
								<Check className="size-3 shrink-0" aria-hidden />
							) : (
								<Bot className="size-3 shrink-0" aria-hidden />
							)
						}
					/>
				);
			})}
		</div>
	);
}

function GoalStepConclusionChrome({
	item,
	t
}: {
	item: Extract<TimelineItem, {kind: 'goalStepConclusion'}>;
	t: TFunction;
}) {
	return (
		<div className="space-y-1.5 px-1 py-0.5">
			<div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
				<span className="inline-flex items-center gap-1.5 text-muted-foreground">
					<Bot className="size-3.5 shrink-0" aria-hidden />
					<span className="shrink-0 text-muted-foreground/70">{t('shell.goal.stepLabel')}</span>
					<span className="font-medium text-foreground">{item.agentName}</span>
				</span>
				{item.verdict === 'pass' ? (
					<GoalStatusChip label={t('shell.goal.verdictPass')} tone="ok" />
				) : null}
				{item.verdict === 'reject' ? (
					<GoalStatusChip label={t('shell.goal.verdictReject')} tone="bad" />
				) : null}
			</div>
			{item.text.trim() ? (
				<div className="border-l-2 border-border/50 pl-3 text-[13.5px] leading-[1.65]">
					<StreamingMarkdownMessage
						text={item.text}
						streaming={item.status === 'streaming'}
					/>
				</div>
			) : null}
		</div>
	);
}

function GoalOutcomeChrome({
	item,
	t
}: {
	item: Extract<TimelineItem, {kind: 'goalOutcome'}>;
	t: TFunction;
}) {
	const statusKey =
		item.goalStatus === 'passed'
			? 'shell.goal.outcomePassed'
			: item.goalStatus === 'cancelled'
				? 'shell.goal.outcomeCancelled'
				: 'shell.goal.outcomeFailed';
	const passTone = item.goalStatus === 'passed';
	return (
		<div className="space-y-1.5 px-1 py-0.5">
			<div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
				<span className="inline-flex items-center gap-1.5 text-muted-foreground">
					<Flag className="size-3.5 shrink-0" aria-hidden />
					<span className="font-medium text-foreground">{t('shell.goal.flowTitle')}</span>
				</span>
				<GoalStatusChip
					label={t(statusKey)}
					tone={passTone ? 'ok' : 'bad'}
					icon={
						passTone ? (
							<Check className="size-3 shrink-0" aria-hidden />
						) : (
							<X className="size-3 shrink-0" aria-hidden />
						)
					}
				/>
			</div>
			{item.text.trim() ? (
				<div className="border-l-2 border-border/50 pl-3 text-[13.5px] leading-[1.65] text-muted-foreground">
					<StreamingMarkdownMessage
						text={item.text}
						streaming={item.status === 'streaming'}
					/>
				</div>
			) : null}
		</div>
	);
}

function ThoughtCollapsible({item}: {item: Extract<TimelineItem, {kind: 'thought'}>}) {
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

function ExploringCollapsible({item}: {item: Extract<TimelineItem, {kind: 'exploring'}>}) {
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

function ProcessStackView({item}: {item: Extract<TimelineItem, {kind: 'processStack'}>}) {
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

/** Decision Transition (刀 3-2): after ~10s without engine convergence, swap the
 *  transitional spinner for an "engine unconfirmed" hint (cli-ink semantics). */
const DECISION_UNCONFIRMED_MS = 10_000;

function useDecisionStale(sentAt: number): boolean {
	const [stale, setStale] = useState(() => Date.now() - sentAt >= DECISION_UNCONFIRMED_MS);
	useEffect(() => {
		const remaining = DECISION_UNCONFIRMED_MS - (Date.now() - sentAt);
		if (remaining <= 0) {
			setStale(true);
			return;
		}
		setStale(false);
		const t = window.setTimeout(() => setStale(true), remaining);
		return () => window.clearTimeout(t);
	}, [sentAt]);
	return stale;
}

/**
 * Compact decided row (CONTEXT.md「Decision Transition」): the card's terminal
 * presentation after a click — non-interactive (duplicate-submit guard), a
 * transitional spinner until engine events converge and unmount it.
 */
function DecidedRow({
	decision,
	summary
}: {
	decision: PendingDecision;
	summary: string;
}) {
	const {t} = useTranslation();
	const stale = useDecisionStale(decision.sentAt);
	const denied = decision.approved === false;
	const Icon = denied ? X : Check;
	return (
		<div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[13px]">
			<Icon
				className={cn('size-3.5 shrink-0', denied ? 'text-destructive' : 'text-muted-foreground')}
			/>
			<span className="shrink-0 font-medium text-foreground">{decision.label}</span>
			<span className="min-w-0 truncate text-muted-foreground">{summary}</span>
			{decision.failed ? (
				<span className="ml-auto shrink-0 text-[11px] text-destructive">
					{decision.failed}
				</span>
			) : stale ? (
				<span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
					{t('shell.question.engineUnconfirmed')}
				</span>
			) : (
				<Spinner className="ml-auto size-3 shrink-0" />
			)}
		</div>
	);
}

function ApprovalCard({
	item,
	scope,
	engineKind
}: {
	item: Extract<TimelineItem, {kind: 'approval'}>;
	scope: string;
	engineKind: 'fast' | 'dsh';
}) {
	const {t} = useTranslation();
	const decision = usePendingDecision(scope, 'approval', item.id);
	const view = formatApproval(
		buildApprovalViewModel({
			tool: item.tool,
			description: item.description,
			risk: item.risk,
			context: item.context
		}),
		t
	);
	const footer = item.note?.trim() || view.reason;

	// Decision Transition: clicked → compact row; failures never resurrect
	// silently — the failed note offers an explicit retry.
	if (decision) {
		return <DecidedRow decision={decision} summary={view.subject || view.title} />;
	}

	return (
		<Card className="gap-0 overflow-hidden py-0 shadow-none border border-amber-500/30 bg-amber-500/[0.03] dark:bg-amber-500/[0.05]">
			<CardHeader className="gap-1.5 px-4 py-3 border-b border-border/40 bg-muted/15">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
						<ShieldAlert className="size-3.5 shrink-0" />
						<span className="text-[11px] font-semibold uppercase tracking-wider">
							{t('session.approval.needed')}
						</span>
					</div>
					{view.riskLabel ? (
						<Badge
							variant="outline"
							className="border-amber-500/30 bg-amber-500/10 font-medium text-[11px] text-amber-700 dark:text-amber-300"
						>
							{view.riskLabel}
						</Badge>
					) : null}
				</div>
				<CardTitle className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
					{view.title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 px-4 py-3">
				<div className="space-y-1">
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						{view.subjectLabel}
					</p>
					{/* data-scrollable (刀 3-4): inner wheel scrolls this pre, never exits follow. */}
					<pre
						data-scrollable
						className="max-h-60 overflow-auto rounded-lg border border-border/50 bg-background/90 px-3.5 py-2.5 font-mono text-[12px] font-normal leading-relaxed text-foreground whitespace-pre-wrap break-all shadow-xs"
					>
						{view.subject || t('session.approval.empty')}
					</pre>
				</div>
				{view.secondary ? (
					<div className="space-y-1">
						<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							{view.secondaryLabel ?? t('session.approval.label.details')}
						</p>
						<pre
							data-scrollable
							className="max-h-40 overflow-auto rounded-lg border border-border/50 bg-background/70 px-3.5 py-2.5 font-mono text-[12px] font-normal leading-relaxed text-foreground whitespace-pre-wrap break-all"
						>
							{view.secondary}
						</pre>
					</div>
				) : null}
				<p className="text-[12px] leading-relaxed text-muted-foreground">{footer}</p>
			</CardContent>
			<CardFooter className="justify-end gap-2 border-t border-border/40 bg-muted/20 px-4 py-2.5">
				<Button
					type="button"
					size="sm"
					className="h-7.5 cursor-pointer rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:opacity-90 active:scale-95 transition-all"
					onClick={() => sendApprovalDecision(scope, item.id, true)}
				>
					{t('session.approval.allow')}
				</Button>
				{engineKind === 'dsh' ? null : (
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7.5 cursor-pointer rounded-md border-border/60 bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
						onClick={() => sendApprovalDecision(scope, item.id, true, 'always')}
					>
						{t('session.approval.always')}
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="destructive"
					className="h-7.5 cursor-pointer rounded-md bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 active:scale-95 transition-all px-3.5 text-xs font-medium"
					onClick={() => sendApprovalDecision(scope, item.id, false)}
				>
					{t('session.approval.deny')}
				</Button>
			</CardFooter>
		</Card>
	);
}

/**
 * User Question card. Custom-answer draft lives here (刀 3-1) — it used to be
 * lifted to SessionPane, where every keystroke re-rendered the whole pane and
 * reconciled the full transcript list.
 */
function QuestionCard({
	item,
	scope
}: {
	item: Extract<TimelineItem, {kind: 'question'}>;
	scope: string;
}) {
	const {t} = useTranslation();
	const decision = usePendingDecision(scope, 'question', item.id);
	const [custom, setCustom] = useState('');

	if (decision) {
		return <DecidedRow decision={decision} summary={item.question} />;
	}

	const submitCustom = () => {
		const trimmed = custom.trim();
		if (trimmed) sendQuestionAnswer(scope, item.id, trimmed);
	};

	return (
		<Card className="gap-0 overflow-hidden py-0 shadow-none">
			<CardHeader className="gap-1 px-3 py-2.5">
				<CardDescription className="text-[11px] leading-none">
					{item.title ?? t('shell.question.pleaseSelect')}
				</CardDescription>
				<CardTitle className="text-[13px] font-semibold leading-snug">
					{item.question}
				</CardTitle>
			</CardHeader>
			{item.options.length > 0 && (
				<CardContent className="flex flex-col gap-1 px-3 pb-2.5 pt-0">
					{item.options.map(option => (
						<button
							key={option.id}
							type="button"
							className={cn(
								'flex w-full items-start gap-2 rounded-md border border-border/60 bg-transparent',
								'px-2.5 py-1.5 text-left text-[13px] leading-snug text-foreground',
								'transition-colors hover:bg-muted/50 active:bg-muted/70',
								'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
							)}
							onClick={() => sendQuestionAnswer(scope, item.id, option.id, option.label)}
						>
							{/^\d+$/.test(option.id) ? (
								<>
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{option.id}.
									</span>
									<span className="min-w-0 whitespace-normal">{option.label}</span>
								</>
							) : (
								<span className="min-w-0 whitespace-normal">{option.label}</span>
							)}
						</button>
					))}
				</CardContent>
			)}
			{item.allowCustom && (
				<CardFooter className="gap-1.5 border-t border-border/60 px-3 py-2">
					<Input
						value={custom}
						onChange={e => setCustom(e.target.value)}
						placeholder={t('shell.question.customPlaceholder')}
						className="h-7 text-[12px] shadow-none"
						onKeyDown={e => {
							if (e.key === 'Enter' && custom.trim()) {
								e.preventDefault();
								submitCustom();
							}
						}}
					/>
					<Button
						type="button"
						size="sm"
						disabled={!custom.trim()}
						className="h-7 shrink-0 px-2.5 text-[12px]"
						onClick={submitCustom}
					>
						{t('shell.question.submit')}
					</Button>
				</CardFooter>
			)}
		</Card>
	);
}


