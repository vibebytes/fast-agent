import {shellT as t} from '../i18n/t';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Activity,
	AlertCircle,
	CalendarClock,
	ChevronDown,
	Clock,
	Flag,
	History,
	Pause,
	Play,
	RefreshCw,
	Square,
	SquareTerminal,
	Trash2,
	Users,
	Zap
} from 'lucide-react';
import {openSessionTurn} from '../session/focusTurn';
import {formatCountdown} from '../session/scheduleCountdown';
import {asLivingProjects, type LivingProject, type LivingSession} from './livingTasksTypes';
import {projectLabel} from './projectLabel';
import {scheduledJobKindLabel, scheduledJobsVisible} from './scheduledJobsVisible';

export type ScheduledJobRow = {
	id: string;
	kind: string;
	status: string;
	sessionId: string;
	projectId?: string | null;
	projectDisplayName?: string | null;
	cronExpr?: string | null;
	timezone?: string | null;
	nextFireAt?: string | null;
	title?: string | null;
	promptText?: string | null;
	targetKind?: string | null;
	targetRef?: string | null;
};

export type ScheduledJobRunRow = {
	id: string;
	jobId: string;
	sessionId: string;
	status: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	summary?: string | null;
	error?: string | null;
	runId?: string | null;
};

/** IDE「调度任务」：上 LivingTask 跨项目树；下 ScheduledJob（跨项目）。 */
export function ScheduledJobsPane({
	focusSessionId,
	onOpenSession,
	onOpenTeams
}: {
	focusSessionId?: string | null;
	onOpenSession?: (sessionId: string, projectId?: string) => void;
	onOpenTeams?: (req: {
		tab?: 'teams' | 'agents' | 'goals';
		goalId?: string;
		teamId?: string;
		agentId?: string;
	}) => void;
}) {
	const [jobs, setJobs] = useState<ScheduledJobRow[]>([]);
	const [living, setLiving] = useState<LivingProject[]>([]);
	const [livingNotice, setLivingNotice] = useState<string | null>(null);
	const [jobsNotice, setJobsNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [runsByJob, setRunsByJob] = useState<Record<string, ScheduledJobRunRow[]>>({});
	const [runsOpen, setRunsOpen] = useState<Record<string, boolean>>({});
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [now, setNow] = useState(() => Date.now());
	const focusRef = useRef<HTMLLIElement | null>(null);

	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);

	const refresh = useCallback(async () => {
		setBusy(true);
		setLivingNotice(null);
		setJobsNotice(null);
		try {
			const [jobsR, livingR] = await Promise.all([
				window.fastIde.listScheduledJobs(),
				window.fastIde.listLivingTasks()
			]);
			if (!jobsR.ok) setJobsNotice(humanNotice(jobsR.notice));
			else setJobs(scheduledJobsVisible(jobsR.jobs));
			if (!livingR.ok) setLivingNotice(humanNotice(livingR.notice));
			else setLiving(asLivingProjects(livingR.projects));
		} catch (e) {
			setJobsNotice(humanNotice(e instanceof Error ? e.message : String(e)));
		} finally {
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		let t: number | undefined;
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const typ = (payload.event as {type?: string}).type;
			// child_work_changed = unified lifecycle wire for run/proc/goal/fire (covers
			// subagent + scheduled-fire changes the old per-kind list missed).
			// task_updated stays: ScheduledJob definition rows (armed/paused) are not child work.
			if (typ !== 'child_work_changed' && typ !== 'task_updated') {
				return;
			}
			window.clearTimeout(t);
			t = window.setTimeout(() => void refresh(), 400);
		});
		return () => {
			unsub();
			window.clearTimeout(t);
		};
	}, [refresh]);

	useEffect(() => {
		if (!focusSessionId) return;
		const project = living.find(p => p.sessions.some(s => s.sessionId === focusSessionId));
		if (!project) return;
		setExpanded(prev => ({
			...prev,
			[`p:${project.projectId}`]: true,
			[`s:${focusSessionId}`]: true
		}));
		requestAnimationFrame(() => {
			focusRef.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
		});
	}, [focusSessionId, living]);

	const livingNameByMeta = useMemo(() => {
		const m = new Map<string, string>();
		for (const p of living) {
			if (p.projectId) m.set(p.projectId, p.displayName);
		}
		return m;
	}, [living]);

	const jobsByProject = useMemo(() => {
		const m = new Map<string, {label: string; rows: ScheduledJobRow[]}>();
		for (const j of jobs) {
			const pid = j.projectId || '_unknown';
			const label = projectLabel(
				pid,
				j.projectDisplayName || livingNameByMeta.get(pid) || null
			);
			const cur = m.get(pid) ?? {label, rows: []};
			cur.rows.push(j);
			if (!cur.label || looksUuid(cur.label)) cur.label = label;
			m.set(pid, cur);
		}
		return [...m.entries()];
	}, [jobs, livingNameByMeta]);

	const livingCount = useMemo(
		() => living.reduce((n, p) => n + p.sessions.length, 0),
		[living]
	);

	async function loadRuns(jobId: string) {
		setBusy(true);
		try {
			const r = await window.fastIde.listScheduledJobRuns(jobId);
			if (!r.ok) {
				setJobsNotice(humanNotice(r.notice ?? t('shell.jobs.loadHistoryFailed')));
				return;
			}
			setRunsByJob(prev => ({...prev, [jobId]: r.runs}));
		} finally {
			setBusy(false);
		}
	}

	async function toggleRuns(jobId: string) {
		const next = !runsOpen[jobId];
		setRunsOpen(prev => ({...prev, [jobId]: next}));
		if (next && !runsByJob[jobId]) await loadRuns(jobId);
	}

	async function updateCron(job: ScheduledJobRow) {
		const cronExpr = window.prompt(t('shell.jobs.cronPrompt'), job.cronExpr ?? '')?.trim();
		if (!cronExpr) return;
		if (!window.confirm(t('shell.jobs.cronConfirm', {cron: cronExpr}))) return;
		setBusy(true);
		try {
			const r = await window.fastIde.updateScheduledJobCron(job.id, cronExpr, job.timezone ?? undefined);
			if (!r.ok) setJobsNotice(humanNotice(r.notice ?? t('shell.jobs.updateFailed')));
			await refresh();
		} finally {
			setBusy(false);
		}
	}

	async function act(id: string, op: 'pause' | 'resume' | 'cancel' | 'fireNow') {
		if (op === 'cancel' && !window.confirm(t('shell.jobs.cancelConfirm'))) return;
		setBusy(true);
		try {
			const r =
				op === 'pause'
					? await window.fastIde.pauseScheduledJob(id)
					: op === 'resume'
						? await window.fastIde.resumeScheduledJob(id)
						: op === 'fireNow'
							? await window.fastIde.fireNowScheduledJob(id)
							: await window.fastIde.cancelScheduledJob(id);
			if (!r.ok) setJobsNotice(humanNotice(r.notice ?? t('shell.jobs.opFailed')));
			await refresh();
		} finally {
			setBusy(false);
		}
	}

	function toggle(key: string) {
		setExpanded(prev => ({...prev, [key]: !prev[key]}));
	}

	function openSession(sessionId: string, projectId?: string) {
		onOpenSession?.(sessionId, projectId);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-xs font-semibold tracking-tight">{t('shell.jobs.title')}</span>
					{(livingCount > 0 || jobs.length > 0) && (
						<span className="truncate font-mono text-[10px] text-muted-foreground">
							{livingCount > 0 ? t('shell.jobs.runningCount', {count: livingCount}) : null}
							{livingCount > 0 && jobs.length > 0 ? ' · ' : null}
							{jobs.length > 0 ? t('shell.jobs.scheduledCount', {count: jobs.length}) : null}
						</span>
					)}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0"
					disabled={busy}
					aria-label={t('shell.jobs.refresh')}
					onClick={() => void refresh()}
				>
					<RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<section className="border-b border-border/60 px-2 py-2">
					<SectionHead
						icon={<Activity className="size-3" />}
						title={t('shell.jobs.livingTitle')}
						count={livingCount}
					/>
					{livingNotice ? <NoticeBanner text={livingNotice} onRetry={() => void refresh()} /> : null}
					{!livingNotice && living.length === 0 ? (
						<EmptyHint>{t('shell.jobs.livingEmpty')}</EmptyHint>
					) : null}
					{living.length > 0 ? (
						<ul className="mt-1 space-y-0.5">
							{living.map(p => {
								const pKey = `p:${p.projectId}`;
								const open = expanded[pKey] === true;
								const label = projectLabel(p.projectId, p.displayName);
								return (
									<li key={p.projectId}>
										<button
											type="button"
											className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
											onClick={() => toggle(pKey)}
										>
											<ChevronDown
												className={cn(
													'size-3 shrink-0 transition-transform',
													!open && '-rotate-90'
												)}
											/>
											<span className="min-w-0 flex-1 truncate">{label}</span>
											<span className="shrink-0 font-mono text-[10px] opacity-70">
												{p.sessions.length}
											</span>
										</button>
										{open ? (
											<ul className="ml-1.5 space-y-0.5 border-l border-border/40 pl-2">
												{p.sessions.map(s => (
													<SessionBranch
														key={s.sessionId}
														session={s}
														expanded={expanded}
														toggle={toggle}
														focus={s.sessionId === focusSessionId}
														focusRef={
															s.sessionId === focusSessionId ? focusRef : undefined
														}
														onOpen={() => openSession(s.sessionId, s.projectId)}
														onOpenTeams={onOpenTeams}
													/>
												))}
											</ul>
										) : null}
									</li>
								);
							})}
						</ul>
					) : null}
				</section>

				<section className="px-2 py-2">
					<SectionHead
						icon={<CalendarClock className="size-3" />}
						title={t('shell.jobs.scheduleTitle')}
						count={jobs.length}
					/>
					{jobsNotice ? <NoticeBanner text={jobsNotice} onRetry={() => void refresh()} /> : null}
					{!jobsNotice && jobs.length === 0 ? (
						<EmptyHint>{t('shell.jobs.scheduleEmpty')}</EmptyHint>
					) : null}
					{jobs.length > 0 ? (
						<ul className="mt-1 space-y-3">
							{jobsByProject.map(([pid, group]) => (
								<li key={pid}>
									<div className="mb-1 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
										{group.label}
									</div>
									<ul className="space-y-1">
										{group.rows.map(j => (
											<JobCard
												key={j.id}
												job={j}
												now={now}
												busy={busy}
												runsOpen={Boolean(runsOpen[j.id])}
												runs={runsByJob[j.id]}
												onOpen={() => openSession(j.sessionId, j.projectId ?? undefined)}
												onFire={() => void act(j.id, 'fireNow')}
												onCron={() => void updateCron(j)}
												onHistory={() => void toggleRuns(j.id)}
												onPauseResume={() =>
													void act(j.id, j.status === 'paused' ? 'resume' : 'pause')
												}
												onCancel={() => void act(j.id, 'cancel')}
											/>
										))}
									</ul>
								</li>
							))}
						</ul>
					) : null}
				</section>
			</div>
		</div>
	);
}

function humanNotice(raw: string): string {
	const s = raw.trim();
	if (/timeout waiting for ListLivingTasks/i.test(s)) {
		return t('shell.jobs.livingTimeout');
	}
	if (/timeout waiting for ListScheduledJobs/i.test(s)) {
		return t('shell.jobs.jobsTimeout');
	}
	if (/Engine not ready/i.test(s)) return t('shell.jobs.engineNotReady');
	return s;
}

function looksUuid(s: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || s.startsWith(t('shell.jobs.projectPrefix'));
}

function SectionHead({
	icon,
	title,
	count
}: {
	icon: React.ReactNode;
	title: string;
	count: number;
}) {
	return (
		<div className="flex items-center gap-1.5 px-1.5 py-0.5">
			<span className="text-muted-foreground">{icon}</span>
			<span className="text-[11px] font-semibold tracking-wide text-foreground/90">{title}</span>
			{count > 0 ? (
				<span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
					{count}
				</span>
			) : null}
		</div>
	);
}

function EmptyHint({children}: {children: React.ReactNode}) {
	return <p className="px-1.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground/80">{children}</p>;
}

function NoticeBanner({text, onRetry}: {text: string; onRetry: () => void}) {
	return (
		<div className="mt-1 flex items-start gap-2 rounded-md border border-border/80 bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
			<AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
			<p className="min-w-0 flex-1 leading-snug">{text}</p>
			<button
				type="button"
				className="shrink-0 text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
				onClick={onRetry}
			>
				{t('shell.jobs.retry')}
			</button>
		</div>
	);
}

function StatusPill({status}: {status: string}) {
	const paused = status.toLowerCase() === 'paused';
	const armed = status.toLowerCase() === 'armed' || status.toLowerCase() === 'running';
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium',
				paused && 'bg-muted text-muted-foreground',
				armed && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
				!paused && !armed && 'bg-muted text-muted-foreground'
			)}
		>
			{paused ? t('shell.jobs.paused') : status === 'armed' ? t('shell.jobs.armed') : status}
		</span>
	);
}

function JobCard({
	job,
	now,
	busy,
	runsOpen,
	runs,
	onOpen,
	onFire,
	onCron,
	onHistory,
	onPauseResume,
	onCancel
}: {
	job: ScheduledJobRow;
	now: number;
	busy: boolean;
	runsOpen: boolean;
	runs?: ScheduledJobRunRow[];
	onOpen: () => void;
	onFire: () => void;
	onCron: () => void;
	onHistory: () => void;
	onPauseResume: () => void;
	onCancel: () => void;
}) {
	const title = job.title?.trim() || job.promptText?.trim() || t('shell.jobs.unnamed');
	const countdown =
		job.status !== 'paused' ? formatCountdown(job.nextFireAt, now) || null : null;
	const kind = scheduledJobKindLabel(job.kind);

	return (
		<li className="group rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/40">
			<button type="button" className="w-full text-left" onClick={onOpen}>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="shrink-0 rounded bg-background/80 px-1 py-px text-[10px] font-medium text-muted-foreground ring-1 ring-border/60">
								{kind}
							</span>
							{job.targetKind ? (
								<span className="shrink-0 rounded bg-background/80 px-1 py-px text-[10px] font-medium text-muted-foreground ring-1 ring-border/60">
									→{job.targetKind}
								</span>
							) : null}
							<span className="truncate text-[13px] font-medium leading-snug">{title}</span>
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
							<StatusPill status={job.status} />
							{countdown ? (
								<span className="font-mono tabular-nums text-foreground/80">{countdown}</span>
							) : job.status === 'paused' ? (
								<span>{t('shell.jobs.paused')}</span>
							) : null}
							{job.cronExpr ? (
								<span className="font-mono text-[10px] opacity-70" title={job.cronExpr}>
									{job.cronExpr}
								</span>
							) : null}
						</div>
					</div>
				</div>
			</button>
			<div className="mt-1.5 flex items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
				<IconAction title={t('shell.jobs.fireNow')} disabled={busy} onClick={onFire}>
					<Zap className="size-3" />
				</IconAction>
				<IconAction title={t('shell.jobs.editCron')} disabled={busy} onClick={onCron}>
					<Clock className="size-3" />
				</IconAction>
				<IconAction title={t('shell.jobs.runHistory')} disabled={busy} onClick={onHistory}>
					<History className="size-3" />
				</IconAction>
				<IconAction
					title={job.status === 'paused' ? t('shell.jobs.resume') : t('shell.jobs.pause')}
					disabled={busy}
					onClick={onPauseResume}
				>
					{job.status === 'paused' ? <Play className="size-3" /> : <Pause className="size-3" />}
				</IconAction>
				<IconAction title={t('shell.jobs.cancel')} disabled={busy} danger onClick={onCancel}>
					<Trash2 className="size-3" />
				</IconAction>
			</div>
			{runsOpen ? (
				<ul className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
					{(runs ?? []).length === 0 ? (
						<li className="px-0.5 text-[10px] text-muted-foreground">{t('shell.jobs.noRuns')}</li>
					) : (
						(runs ?? []).slice(0, 8).map(run => (
							<li key={run.id}>
								<button
									type="button"
									className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
									disabled={!run.runId}
									onClick={() => void openSessionTurn(run.sessionId || job.sessionId, run.runId)}
								>
									{run.status}
									{run.startedAt ? ` · ${compactTime(run.startedAt)}` : ''}
									{run.summary ? ` · ${run.summary}` : ''}
								</button>
							</li>
						))
					)}
				</ul>
			) : null}
		</li>
	);
}

function IconAction({
	title,
	disabled,
	danger,
	onClick,
	children
}: {
	title: string;
	disabled?: boolean;
	danger?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			className={cn(
				'size-6',
				danger && 'text-muted-foreground hover:text-destructive'
			)}
			title={title}
			disabled={disabled}
			onClick={e => {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			}}
		>
			{children}
		</Button>
	);
}

function compactTime(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return iso;
	return new Date(t).toLocaleString(undefined, {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

function SessionBranch({
	session,
	expanded,
	toggle,
	focus,
	focusRef,
	onOpen,
	onOpenTeams
}: {
	session: LivingSession;
	expanded: Record<string, boolean>;
	toggle: (key: string) => void;
	focus: boolean;
	focusRef?: React.RefObject<HTMLLIElement | null>;
	onOpen: () => void;
	onOpenTeams?: (req: {
		tab?: 'teams' | 'agents' | 'goals';
		goalId?: string;
		teamId?: string;
		agentId?: string;
	}) => void;
}) {
	const key = `s:${session.sessionId}`;
	const open = expanded[key] === true;
	const bits = [
		session.goals.length ? `${session.goals.length} Goal` : null,
		session.procs.length ? `${session.procs.length} Proc` : null,
		session.subagents.length ? `${session.subagents.length} Sub` : null
	].filter(Boolean);

	return (
		<li
			ref={focus ? focusRef : undefined}
			className={cn(
				'rounded-md',
				focus && 'bg-primary/5 ring-1 ring-primary/25'
			)}
		>
			<div className="flex items-center gap-0.5 px-1 py-0.5">
				<button type="button" className="shrink-0 rounded p-0.5 hover:bg-muted" onClick={() => toggle(key)}>
					<ChevronDown className={cn('size-3 transition-transform', !open && '-rotate-90')} />
				</button>
				<button
					type="button"
					className="min-w-0 flex-1 truncate text-left text-[12px] font-medium"
					onClick={onOpen}
					title={session.sessionId}
				>
					{session.title || t('shell.jobs.session')}
					{bits.length > 0 ? (
						<span className="ml-1.5 font-normal text-[10px] text-muted-foreground">
							{bits.join(' · ')}
						</span>
					) : null}
				</button>
			</div>
			{open ? (
				<ul className="mb-1 ml-3 space-y-1 border-l border-border/40 pl-2 text-[11px]">
					{session.goals.map(g => (
						<li key={g.goalId} className="rounded-md bg-muted/30 px-1.5 py-1">
							<button type="button" className="flex w-full items-start gap-1.5 text-left" onClick={onOpen}>
								<Flag className="mt-0.5 size-3 shrink-0 text-primary" />
								<span className="min-w-0 flex-1">
									<span className="font-medium leading-snug">
										{g.name || g.statement || g.goalId.slice(0, 8)}
									</span>
									<span className="ml-1 text-[10px] text-muted-foreground">
										{g.phase || g.status}
									</span>
								</span>
							</button>
							{g.team ? (
								<div className="mt-1 ml-4 space-y-0.5">
									<div className="text-[10px] text-muted-foreground">
										Team · {g.team.name || g.team.teamId.slice(0, 8)}
									</div>
									{g.team.members.map(m => (
										<div key={m.agentId} className="pl-1">
											<button type="button" className="w-full text-left" onClick={onOpen}>
												{m.name}
												<span className="text-muted-foreground"> · {m.teamRole}</span>
											</button>
											{m.runs.length > 0 ? (
												<ul className="ml-1 font-mono text-[10px] text-muted-foreground">
													{m.runs.map(r => (
														<li key={r.runId}>
															<button type="button" onClick={onOpen}>
																{r.status} · {r.runId.slice(0, 8)}
															</button>
														</li>
													))}
												</ul>
											) : null}
										</div>
									))}
								</div>
							) : null}
							<div className="mt-1 ml-4 flex gap-0.5">
								{g.phase === 'paused' ? (
									<IconAction title={t('shell.jobs.resumeGoal')} onClick={() => void window.fastIde.resumeGoal(g.goalId)}>
										<Play className="size-3" />
									</IconAction>
								) : g.phase === 'started' || g.phase === 'escalated' ? (
									<IconAction title={t('shell.jobs.pauseGoal')} onClick={() => void window.fastIde.pauseGoal(g.goalId)}>
										<Pause className="size-3" />
									</IconAction>
								) : null}
								<IconAction title={t('shell.jobs.stopGoal')} onClick={() => void window.fastIde.cancelGoal(g.goalId)}>
									<Square className="size-3" />
								</IconAction>
								{onOpenTeams ? (
									<IconAction
										title={t('shell.jobs.openInTeams')}
										onClick={() => onOpenTeams({tab: 'goals', goalId: g.goalId})}
									>
										<Users className="size-3" />
									</IconAction>
								) : null}
								{g.team && onOpenTeams ? (
									<IconAction
										title={t('shell.jobs.openTeam')}
										onClick={() => onOpenTeams({tab: 'teams', teamId: g.team!.teamId})}
									>
										<span className="text-[9px] font-medium">T</span>
									</IconAction>
								) : null}
							</div>
						</li>
					))}
					{session.procs.map(p => (
						<li key={p.procId} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted/40">
							<SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
							<button
								type="button"
								className="min-w-0 flex-1 truncate text-left"
								onClick={onOpen}
							>
								{p.command || p.procId}
							</button>
							<IconAction
								title={t('shell.jobs.killProcess')}
								onClick={() =>
									void window.fastIde.killProc(p.procId, undefined, p.sessionId || session.sessionId)
								}
							>
								<Square className="size-3" />
							</IconAction>
						</li>
					))}
					{session.subagents.map(a => (
						<li key={a.runId}>
							<button
								type="button"
								className="w-full truncate rounded-md px-1.5 py-0.5 text-left hover:bg-muted/40"
								onClick={onOpen}
							>
								<span className="text-muted-foreground">Subagent</span>{' '}
								{a.title || a.runId.slice(0, 8)}
								<span className="ml-1 text-muted-foreground">{a.status}</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
		</li>
	);
}
