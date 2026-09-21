import {useState, type ReactNode} from 'react';
import type {TimelineItem} from '@fast-ide/session-view';
import {TextShimmer} from '@fast-ide/ui/components/ai-shimmer';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {cn} from '@fast-ide/ui/lib/utils';
import {Bot, Boxes, Check, ChevronRight, Flag, LoaderCircle, X} from 'lucide-react';
import type {TFunction} from 'i18next';
import {StreamingMarkdownMessage} from '../MarkdownMessage';

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

export function GoalFlowChrome({
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

export function GoalStepConclusionChrome({
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

export function GoalOutcomeChrome({
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

/** Engine-injected context (recall / plugin snapshot) — collapsed by default, never a user bubble. */
export function ContextInjectionChrome({
	item
}: {
	item: Extract<TimelineItem, {kind: 'contextInjection'}>;
}) {
	const [open, setOpen] = useState(false);
	const label = item.label.trim() || item.sourceKind;
	return (
		<Collapsible
			className="group/ctx-injection"
			open={open}
			onOpenChange={setOpen}
		>
			<CollapsibleTrigger className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-normal text-muted-foreground/80 outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
				<ChevronRight className="size-3.5 shrink-0 opacity-60 transition-transform group-data-[state=open]/ctx-injection:rotate-90" />
				<Boxes className="size-3.5 shrink-0 opacity-60" aria-hidden />
				<span className="inline-block min-w-0 max-w-full truncate">{label}</span>
				<span className="shrink-0 text-[10px] tracking-wide text-muted-foreground/45">
					{item.sourceKind}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<pre
					data-scrollable
					className="my-1 max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-border/70 pl-2.5 font-sans text-[12px] leading-relaxed text-muted-foreground/90"
				>
					{item.text}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
