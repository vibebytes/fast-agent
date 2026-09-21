import {useEffect, useState} from 'react';
import {buildApprovalViewModel, type TimelineItem} from '@fast-ide/session-view';
import {Badge} from '@fast-ide/ui/components/badge';
import {Button} from '@fast-ide/ui/components/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle
} from '@fast-ide/ui/components/card';
import {Input} from '@fast-ide/ui/components/input';
import {Spinner} from '@fast-ide/ui/components/spinner';
import {cn} from '@fast-ide/ui/lib/utils';
import {Check, ShieldAlert, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {formatApproval} from './formatApproval';
import {
	sendApprovalDecision,
	sendQuestionAnswer,
	usePendingDecision,
	type PendingDecision
} from './pendingDecisions';

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

export function ApprovalCard({
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
export function QuestionCard({
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
