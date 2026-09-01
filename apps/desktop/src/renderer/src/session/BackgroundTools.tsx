import {shellT as t} from '../i18n/t';
import {useEffect, useMemo, useState} from 'react';
import type {GoalCardView, LiveChildWork, LiveProc, LiveTask} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@fast-ide/ui/components/collapsible';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Bot,
	ChevronDown,
	Clock,
	History,
	Pause,
	Play,
	Square,
	SquareTerminal,
	Flag,
	Trash2,
	Zap
} from 'lucide-react';
import {goalProgress} from '../goalProgress';
import {currentStepNames} from '../workflowNodeStatus';
import {parseWorkflowSteps, WorkflowReadonly} from '../WorkflowReadonly';
import {
	drawerTasks,
	goalDetailChildWork,
	goalStepChildWork,
	goalStepDisplayName
} from './backgroundTasks';
import {focusTranscriptTurn} from './focusTurn';
import {previewBodyLines, structureWorkPreview} from './workPreview';
import {displayToolOutput} from '../toolPresentation';

/** All Goal card phases paint the drawer — finished no longer requires live child_work. */
const GOAL_DRAWER_PHASES = new Set([
	'awaiting_confirm',
	'started',
	'paused',
	'escalated',
	'finished'
]);
const GOAL_PIPELINE_PHASES = new Set(['started', 'paused', 'escalated', 'finished']);

function goalEscalateLabel(card: GoalCardView): string {
	if (card.escalateKind === 'infra') return t('shell.background.supplyFault');
	return t('shell.background.needsDecision');
}

function goalDrawerLabel(card: GoalCardView): string {
	const phase =
		card.phase === 'awaiting_confirm'
			? t('shell.background.awaitingConfirm')
			: card.phase === 'started'
				? t('shell.background.running')
				: card.phase === 'paused'
					? t('shell.background.paused')
					: card.phase === 'escalated'
						? goalEscalateLabel(card)
						: card.status;
	const label = card.name?.trim() || card.statement?.trim();
	const short = label && label.length > 48 ? `${label.slice(0, 48)}…` : label;
	return short ? `Goal · ${phase} · ${short}` : `Goal · ${phase}`;
}

/** Agent summary text only — never tool_result / ShellEnvelope (those are「最近工具」). */
function agentSummary(raw?: string, max = 72): string {
	if (!raw?.trim()) return '';
	if (/tool_result\b|"exitCode"\s*:|"status"\s*:\s*"exited"/i.test(raw)) return '';
	const flat = displayToolOutput(raw).replace(/\s+/g, ' ').trim();
	if (!flat) return '';
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Compact last-tool chrome: tool · status · exit N (no run-status words). */
function lastToolBits(s: NonNullable<ReturnType<typeof structureWorkPreview>>): string {
	const bits: string[] = [];
	if (s.tool) bits.push(s.tool);
	if (s.status) bits.push(s.status);
	if (s.exitCode != null) bits.push(`exit ${s.exitCode}`);
	else if (s.success === false) bits.push('fail');
	else if (s.success === true && !s.status) bits.push('ok');
	return bits.join(' · ');
}

function currentMemberUse(
	workflowJson: string | undefined,
	stepIds: string | string[] | undefined
): string | undefined {
	const names = currentStepNames(stepIds, parseWorkflowSteps(workflowJson));
	return names.length > 0 ? names.join(' · ') : undefined;
}

/** Collapsed drawer status — finished Goals must not read as still running. */
function goalMemberStatus(card: GoalCardView): string {
	if (card.phase === 'paused') return 'paused';
	if (card.phase === 'escalated') return goalEscalateLabel(card);
	if (card.phase === 'awaiting_confirm') return 'awaiting';
	if (card.phase === 'finished') {
		const s = card.status?.trim().toLowerCase();
		if (s === 'passed' || s === 'failed' || s === 'cancelled') return s;
		return s || 'finished';
	}
	return 'running';
}

function GoalStepCard({
	work,
	workflowJson
}: {
	work: LiveChildWork;
	workflowJson?: string;
}) {
	const [open, setOpen] = useState(false);
	const name = goalStepDisplayName(work, workflowJson, parseWorkflowSteps);
	const elapsed = useElapsedLabel(work.startedAt);
	const body = previewLines(work.outputPreview, 12);
	const note = agentSummary(work.summary);
	const running = work.status.toLowerCase() === 'running';
	return (
		<li className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-sm">
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center gap-2 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
						aria-expanded={open}
						title={work.id}
					>
						<ChevronDown
							className={cn(
								'size-3 shrink-0 text-muted-foreground transition-transform',
								!open && '-rotate-90'
							)}
							aria-hidden
						/>
						<Bot
							className={cn(
								'size-3.5 shrink-0',
								running ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'
							)}
							aria-hidden
						/>
						<span className="min-w-0 flex-1 truncate font-medium">
							{name}
							<span className="ml-1 font-normal text-muted-foreground">
								· {work.status}
								{note ? ` · ${note}` : ''}
							</span>
						</span>
						{elapsed && running ? (
							<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
								{elapsed}
							</span>
						) : null}
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					{body ? (
						<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-muted-foreground">
							{body}
						</pre>
					) : running ? (
						<div className="mt-1 text-[11px] text-muted-foreground">Running…</div>
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

function GoalRow({
	card,
	stepWork,
	detailWork,
	detailProcs,
	onOpenTeams
}: {
	card: GoalCardView;
	/** L1 Goal step runs — rich body cards from child_work. */
	stepWork: LiveChildWork[];
	detailWork: LiveChildWork[];
	detailProcs: LiveProc[];
	onOpenTeams?: (req: {tab?: 'goals'; goalId?: string}) => void;
}) {
	// Wall clock for drawer elapsed — arm on first busy phase; reset on new goalId.
	const [startedAt, setStartedAt] = useState<number | undefined>();
	const [detailsOpen, setDetailsOpen] = useState(false);
	useEffect(() => {
		setStartedAt(undefined);
	}, [card.goalId]);
	useEffect(() => {
		if (card.phase === 'started' || card.phase === 'paused' || card.phase === 'escalated') {
			setStartedAt(prev => prev ?? Date.now());
		} else {
			setStartedAt(undefined);
		}
	}, [card.goalId, card.phase]);

	const elapsed = useElapsedLabel(startedAt);
	const showPipeline = GOAL_PIPELINE_PHASES.has(card.phase);
	const steps = useMemo(() => parseWorkflowSteps(card.workflowJson), [card.workflowJson]);
	const progress = useMemo(() => goalProgress(card.progressJson), [card.progressJson]);
	const memberUse = currentMemberUse(card.workflowJson, card.currentStepIds);
	const runningStep =
		stepWork.find(w => w.status.toLowerCase() === 'running') ?? stepWork[0] ?? undefined;
	const memberStartedAt = useMemo(() => {
		const times = [
			...stepWork.map(w => w.startedAt),
			...detailWork.map(w => w.startedAt),
			...detailProcs.map(p => p.startedAt)
		].filter((t): t is number => typeof t === 'number' && t > 0);
		if (times.length > 0) return Math.min(...times);
		return showPipeline && memberUse ? startedAt : undefined;
	}, [stepWork, detailWork, detailProcs, showPipeline, memberUse, startedAt]);
	const memberElapsed = useElapsedLabel(memberStartedAt);
	const memberNote =
		agentSummary(runningStep?.summary) ||
		agentSummary(detailWork.find(w => w.status === 'running')?.summary) ||
		agentSummary(detailProcs[0]?.command);
	const lastTool =
		structureWorkPreview(runningStep?.outputPreview) ??
		structureWorkPreview(detailWork.find(w => w.status === 'running')?.outputPreview) ??
		(detailProcs[0]
			? structureWorkPreview(
					JSON.stringify({
						status: detailProcs[0].status,
						outFile: detailProcs[0].outFile,
						outputPreview: detailProcs[0].outputPreview
					})
				)
			: null);
	const lastToolLine = lastTool ? lastToolBits(lastTool) : '';
	const detailCount = detailWork.length + detailProcs.length;

	return (
		<li className="rounded-md px-1.5 py-1 text-sm text-foreground">
			<div className="group/bg flex items-center gap-2">
				<Flag className="size-3.5 shrink-0 text-primary" aria-hidden />
				<span
					className="min-w-0 flex-1 truncate"
					title={`${card.status}\n${card.goalId}\n${card.statement ?? ''}`}
				>
					{goalDrawerLabel(card)}
				</span>
				{elapsed ? (
					<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
						{elapsed}
					</span>
				) : null}
				{card.phase === 'paused' ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
						aria-label={t('shell.background.resumeGoal')}
						title={t('shell.background.resumeGoalTitle')}
						onClick={e => {
							e.preventDefault();
							e.stopPropagation();
							void window.fastIde.resumeGoal();
						}}
					>
						<Play className="size-3" />
					</Button>
				) : null}
				{card.phase === 'escalated' ? (
					<>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
							title="EscalateResume"
							onClick={e => {
								e.preventDefault();
								e.stopPropagation();
								void window.fastIde.escalateGoal('resume');
							}}
						>
							Resume
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
							title="EscalateFail"
							onClick={e => {
								e.preventDefault();
								e.stopPropagation();
								void window.fastIde.escalateGoal('fail');
							}}
						>
							Fail
						</Button>
					</>
				) : null}
				{onOpenTeams ? (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
						title={t('shell.background.openInTeams')}
						onClick={e => {
							e.preventDefault();
							e.stopPropagation();
							onOpenTeams({tab: 'goals', goalId: card.goalId});
						}}
					>
						Teams
					</Button>
				) : null}
			</div>

			{showPipeline && steps.length > 0 ? (
				<div className="mt-1.5 space-y-1">
					<WorkflowReadonly
						steps={steps}
						mode="live"
						compact
						currentStepIds={card.currentStepIds}
						completedSteps={progress.completedSteps}
						pendingExtras={progress.pendingExtras}
						goalStatus={card.status}
						goalLabel={card.name?.trim() || undefined}
					/>
					{stepWork.length > 0 ? (
						<ul className="space-y-1 px-0.5">
							{stepWork.map(work => (
								<GoalStepCard
									key={`${work.kind}:${work.id}`}
									work={work}
									workflowJson={card.workflowJson}
								/>
							))}
						</ul>
					) : memberUse || card.reason?.trim() ? (
						<div className="space-y-0.5 px-0.5">
							{memberUse ? (
								<div className="flex items-center gap-2 text-xs">
									<Bot
										className={cn(
											'size-3.5 shrink-0',
											card.phase === 'escalated'
												? 'text-amber-600 dark:text-amber-400'
												: 'text-sky-600 dark:text-sky-400'
										)}
										aria-hidden
									/>
									<span className="min-w-0 flex-1 truncate font-medium">
										{memberUse}
										<span className="ml-1 font-normal text-muted-foreground">
											· {goalMemberStatus(card)}
											{memberNote && card.phase === 'started'
												? ` · ${memberNote}`
												: ''}
										</span>
									</span>
									{memberElapsed && card.phase === 'started' ? (
										<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
											{memberElapsed}
										</span>
									) : null}
								</div>
							) : null}
							{card.reason?.trim() ? (
								<div
									className="truncate pl-5 text-[11px] text-amber-700 dark:text-amber-300"
									title={card.reason}
								>
									{t('shell.background.reason', {reason: card.reason.trim()})}
								</div>
							) : null}
							{lastToolLine && card.phase === 'started' ? (
								<div
									className="truncate pl-5 text-[11px] text-muted-foreground"
									title={t('shell.background.lastToolHint', {line: lastToolLine})}
								>
									<span className="text-muted-foreground/80">{t('shell.background.lastTool')}</span>
									{' · '}
									{lastToolLine}
								</div>
							) : null}
						</div>
					) : null}
					{detailCount > 0 ? (
						<Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
							<CollapsibleTrigger asChild>
								<button
									type="button"
									className="flex h-6 w-full items-center gap-1 rounded px-0.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
								>
									<ChevronDown
										className={cn(
											'size-3 shrink-0 transition-transform',
											!detailsOpen && '-rotate-90'
										)}
									/>
									{t('shell.background.details')}
									<span className="tabular-nums">({detailCount})</span>
								</button>
							</CollapsibleTrigger>
							<CollapsibleContent>
								<ul className="mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
									{detailWork.map(work => (
										<ChildWorkRow key={`${work.kind}:${work.id}`} work={work} />
									))}
									{detailProcs.map(proc => (
										<ProcRow key={proc.procId} proc={proc} />
									))}
								</ul>
							</CollapsibleContent>
						</Collapsible>
					) : null}
				</div>
			) : null}
		</li>
	);
}

function formatElapsed(ms: number): string {
	const sec = Math.max(0, Math.floor(ms / 1000));
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

function formatCountdown(ms: number): string {
	if (ms <= 0) return 'due';
	return `in ${formatElapsed(ms)}`;
}

function useElapsedLabel(startedAt: number | undefined): string {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (startedAt == null) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [startedAt]);
	if (startedAt == null) return '';
	return formatElapsed(now - startedAt);
}

function useCountdownLabel(nextFireAt: string | undefined, paused: boolean): string {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!nextFireAt || paused) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [nextFireAt, paused]);
	if (!nextFireAt || paused) return '';
	const t = Date.parse(nextFireAt);
	if (Number.isNaN(t)) return '';
	return formatCountdown(t - now);
}

/** Last few non-empty lines for proc preview (already plain command output). */
function previewLines(raw: string | undefined, maxLines = 4): string {
	if (!raw) return '';
	return previewBodyLines(displayToolOutput(raw), maxLines);
}

type JobRunRow = {
	id: string;
	status: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	summary?: string | null;
	error?: string | null;
	runId?: string | null;
};

function ProcRow({proc}: {proc: LiveProc}) {
	const elapsed = useElapsedLabel(proc.startedAt);
	const label = proc.command.replace(/\s+/g, ' ').trim() || proc.procId;
	const preview = previewLines(proc.outputPreview);

	return (
		<li className="rounded-md px-1.5 py-1 text-sm text-foreground">
			<div className="group/bg flex items-center gap-2">
				<SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<span className="min-w-0 flex-1 truncate" title={`${label}\n${proc.procId}`}>
					{label}
				</span>
				{elapsed ? (
					<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
						{elapsed}
					</span>
				) : null}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					aria-label={t('shell.background.stopProcess')}
					title={t('shell.background.stopProcessTitle')}
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						void window.fastIde.killProc(proc.procId);
					}}
				>
					<Square className="size-2.5 fill-current" />
				</Button>
			</div>
			{preview ? (
				<pre
					className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-all rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] leading-snug text-muted-foreground"
					title={proc.outFile ? `outFile: ${proc.outFile}` : undefined}
				>
					{preview}
				</pre>
			) : null}
		</li>
	);
}

function TaskRow({task}: {task: LiveTask}) {
	const label = task.title?.trim() || task.detail?.trim() || task.taskId;
	const kindLabel = task.kind === 'loop' ? 'Loop' : 'Automation';
	const paused = task.status.toLowerCase() === 'paused';
	const countdown = useCountdownLabel(task.nextFireAt, paused);
	const [runsOpen, setRunsOpen] = useState(false);
	const [runs, setRuns] = useState<JobRunRow[] | null>(null);
	const [runsBusy, setRunsBusy] = useState(false);

	async function toggleRuns() {
		const next = !runsOpen;
		setRunsOpen(next);
		if (!next || runs != null) return;
		setRunsBusy(true);
		try {
			const r = await window.fastIde.listScheduledJobRuns(task.taskId);
			if (r.ok) setRuns(r.runs);
		} finally {
			setRunsBusy(false);
		}
	}

	return (
		<li className="rounded-md px-1.5 py-1 text-sm text-foreground">
			<div className="group/bg flex items-center gap-2">
				<Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<span className="min-w-0 flex-1 truncate" title={`${kindLabel}: ${label}\n${task.taskId}`}>
					<span className="text-[11px] text-muted-foreground">{kindLabel}</span>{' '}
					{label}
					{paused ? (
						<span className="ml-1 text-[11px] text-muted-foreground">(paused)</span>
					) : null}
				</span>
				{countdown ? (
					<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
						{countdown}
					</span>
				) : null}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					aria-label={t('shell.background.fireNow')}
					title={t('shell.background.fireNow')}
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						void window.fastIde.fireNowScheduledJob(task.taskId);
					}}
				>
					<Zap className="size-3" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
					aria-label={t('shell.background.showRunHistory')}
					title={t('shell.background.fireHistory')}
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						void toggleRuns();
					}}
				>
					<History className="size-3" />
				</Button>
				{paused ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
						aria-label={t('shell.background.resumeJob')}
						title={t('shell.background.resumeJobTitle')}
						onClick={e => {
							e.preventDefault();
							e.stopPropagation();
							void window.fastIde.resumeScheduledJob(task.taskId);
						}}
					>
						<Play className="size-3" />
					</Button>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
						aria-label={t('shell.background.pauseJob')}
						title={t('shell.background.pauseJobTitle')}
						onClick={e => {
							e.preventDefault();
							e.stopPropagation();
							void window.fastIde.pauseScheduledJob(task.taskId);
						}}
					>
						<Pause className="size-3" />
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
					aria-label={t('shell.background.cancelJob')}
					title={t('shell.background.cancelJobTitle')}
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						if (!window.confirm('Cancel this scheduled job?')) return;
						void window.fastIde.cancelScheduledJob(task.taskId);
					}}
				>
					<Trash2 className="size-3" />
				</Button>
			</div>
			{runsOpen ? (
				<ul className="mt-1 space-y-0.5 rounded bg-muted/40 px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
					{runsBusy ? <li>loading…</li> : null}
					{!runsBusy && (runs?.length ?? 0) === 0 ? <li>no fires yet</li> : null}
					{(runs ?? []).slice(0, 8).map(r => (
						<li key={r.id}>
							<button
								type="button"
								className={cn(
									'w-full truncate text-left hover:text-foreground',
									!r.runId && 'cursor-default'
								)}
								title={r.error || r.summary || r.runId || r.id}
								disabled={!r.runId}
								onClick={() => focusTranscriptTurn(r.runId)}
							>
								{r.status}
								{r.startedAt ? ` · ${r.startedAt}` : ''}
								{r.summary ? ` · ${r.summary}` : ''}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</li>
	);
}

/** Unified LiveChildWork row — title + last-tool summary; preview collapsed like GoalStepCard. */
function ChildWorkRow({work}: {work: LiveChildWork}) {
	const [open, setOpen] = useState(false);
	const elapsed = useElapsedLabel(work.startedAt);
	const kindLabel = work.kind.charAt(0).toUpperCase() + work.kind.slice(1);
	const structured = structureWorkPreview(work.outputPreview);
	const body = structured
		? previewBodyLines(structured.body, 5)
		: previewLines(work.outputPreview);
	const titleHint = work.title.trim().toLowerCase() === 'subagent' ? 'subagent' : work.title;
	const note = agentSummary(work.summary);
	const lastTool = structured ? lastToolBits(structured) : '';
	const hasToolChrome =
		Boolean(structured) &&
		Boolean(
			structured!.tool ||
				structured!.success != null ||
				structured!.exitCode != null ||
				structured!.status ||
				structured!.outFile
		);
	return (
		<li className="rounded-md px-1.5 py-1 text-sm text-foreground">
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center gap-2 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
						aria-expanded={open}
						title={`${kindLabel}: ${work.title}${work.summary ? `\n${work.summary}` : ''}`}
					>
						<ChevronDown
							className={cn(
								'size-3 shrink-0 text-muted-foreground transition-transform',
								!open && '-rotate-90'
							)}
							aria-hidden
						/>
						<Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						<span className="min-w-0 flex-1 truncate">
							<span className="text-[11px] text-muted-foreground">{kindLabel}</span>{' '}
							{titleHint}
							<span className="ml-1 text-[11px] text-muted-foreground">
								· {work.status}
								{note ? ` · ${note}` : ''}
								{lastTool ? ` · ${lastTool}` : ''}
							</span>
						</span>
						{elapsed ? (
							<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
								{elapsed}
							</span>
						) : null}
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					{hasToolChrome || body ? (
						<div className="mt-1 space-y-1 rounded bg-muted/40 px-1.5 py-1 text-[11px] leading-snug text-muted-foreground">
							{hasToolChrome ? (
								<div
									className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-sans"
									title={t('shell.background.lastToolTitle')}
								>
									<span className="text-muted-foreground/80">{t('shell.background.lastTool')}</span>
									{structured!.tool ? (
										<span className="rounded bg-background/70 px-1 font-medium text-foreground/80">
											{structured!.tool}
										</span>
									) : null}
									{structured!.success === true ? (
										<span className="text-emerald-600 dark:text-emerald-400">{t('shell.background.callOk')}</span>
									) : null}
									{structured!.success === false ? (
										<span className="text-destructive">{t('shell.background.callFail')}</span>
									) : null}
									{structured!.status ? <span>{t('shell.background.processStatus', {status: structured!.status})}</span> : null}
									{structured!.exitCode != null ? (
										<span className="font-mono tabular-nums">exit {structured!.exitCode}</span>
									) : null}
								</div>
							) : null}
							{structured?.outFile ? (
								<div className="truncate font-mono text-[10px]" title={structured.outFile}>
									log: {structured.outFile}
								</div>
							) : null}
							{body ? (
								<pre className="max-h-20 overflow-hidden whitespace-pre-wrap break-all font-mono">
									{body}
								</pre>
							) : null}
						</div>
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

/** Session-scoped Fg+Bg Proc + loop/automation + Goal drawer. Row Stop = KillProc / pause+cancel job. */
export function BackgroundToolsSection({
	procs,
	tasks = [],
	childWork = [],
	goalCard = null,
	onOpenTeams
}: {
	procs: LiveProc[];
	tasks?: LiveTask[];
	/** Unified child-workload rows (child_work_changed) — goal steps / subagents / fires. */
	childWork?: LiveChildWork[];
	/** Active Goal chrome — awaiting_confirm / started / paused / escalated / finished. */
	goalCard?: GoalCardView | null;
	onOpenTeams?: (req: {tab?: 'goals'; goalId?: string}) => void;
}) {
	const [open, setOpen] = useState(false);
	const running = procs.filter(p => p.status === 'running');
	const activeTasks = drawerTasks(tasks);
	const stepWork = goalCard ? goalStepChildWork(childWork, goalCard.goalId) : [];
	const showGoal = Boolean(goalCard && GOAL_DRAWER_PHASES.has(goalCard.phase));
	const nestUnderGoal = Boolean(goalCard && GOAL_PIPELINE_PHASES.has(goalCard.phase));
	const detailWork = nestUnderGoal ? goalDetailChildWork(childWork) : [];
	const stepIds = new Set(stepWork.map(w => w.id));
	const detailIds = new Set(detailWork.map(w => w.id));
	const topChildWork = nestUnderGoal
		? childWork.filter(w => !detailIds.has(w.id) && !stepIds.has(w.id))
		: childWork.filter(w => !stepIds.has(w.id));
	const topProcs = nestUnderGoal ? [] : running;
	const detailProcs = nestUnderGoal ? running : [];
	const memberHint =
		nestUnderGoal && goalCard
			? currentMemberUse(goalCard.workflowJson, goalCard.currentStepIds)
			: undefined;

	if (
		running.length === 0 &&
		activeTasks.length === 0 &&
		!showGoal &&
		childWork.length === 0
	) {
		return null;
	}

	const parts: string[] = [];
	if (showGoal && goalCard) {
		const st = goalMemberStatus(goalCard);
		// Finished: no live member cursor — don't keep a stale "分析师 running" shape.
		parts.push(
			memberHint && goalCard.phase !== 'finished'
				? `1 goal · ${memberHint} ${st}`
				: `1 goal · ${st}`
		);
	}
	if (topChildWork.length > 0) {
		parts.push(`${topChildWork.length} working`);
	}
	if (topProcs.length > 0) {
		parts.push(`${topProcs.length} terminal${topProcs.length === 1 ? '' : 's'}`);
	} else if (nestUnderGoal && detailProcs.length > 0) {
		parts.push(`${detailProcs.length} terminal${detailProcs.length === 1 ? '' : 's'}`);
	}
	if (activeTasks.length > 0) {
		parts.push(`${activeTasks.length} job${activeTasks.length === 1 ? '' : 's'}`);
	}
	const label = parts.join(' · ');

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div className="flex h-8 items-center gap-1 px-2">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
					>
						<ChevronDown
							className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
						/>
						<span className="truncate">{label}</span>
					</button>
				</CollapsibleTrigger>
			</div>
			<CollapsibleContent>
				<ul className="space-y-0.5 px-2 pb-2">
					{showGoal && goalCard ? (
						<GoalRow
							card={goalCard}
							stepWork={stepWork}
							detailWork={detailWork}
							detailProcs={detailProcs}
							onOpenTeams={onOpenTeams}
						/>
					) : null}
					{topChildWork.map(work => (
						<ChildWorkRow key={`${work.kind}:${work.id}`} work={work} />
					))}
					{topProcs.map(proc => (
						<ProcRow key={proc.procId} proc={proc} />
					))}
					{activeTasks.map(task => (
						<TaskRow key={task.taskId} task={task} />
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}
