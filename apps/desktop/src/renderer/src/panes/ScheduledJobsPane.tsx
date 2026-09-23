import {shellT as t} from '../i18n/t';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Activity,
	AlertCircle,
	ChevronDown,
	Flag,
	Pause,
	Play,
	RefreshCw,
	Square,
	SquareTerminal,
	Users
} from 'lucide-react';
import {asLivingProjects, type LivingProject, type LivingSession} from './livingTasksTypes';
import {projectLabel} from './projectLabel';

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
	workspaceName?: string | null;
	workspaceRoot?: string | null;
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
	sessionTitle?: string | null;
};

/** Right rail keeps LivingTask only. Plan lists live in the left sidebar. */
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
	const [living, setLiving] = useState<LivingProject[]>([]);
	const [livingNotice, setLivingNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const focusRef = useRef<HTMLLIElement | null>(null);

	const refresh = useCallback(async () => {
		setBusy(true);
		setLivingNotice(null);
		try {
			const livingR = await window.fastIde.listLivingTasks();
			if (!livingR.ok) setLivingNotice(humanNotice(livingR.notice));
			else setLiving(asLivingProjects(livingR.projects));
		} catch (e) {
			setLivingNotice(humanNotice(e instanceof Error ? e.message : String(e)));
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

	const livingCount = useMemo(
		() => living.reduce((n, p) => n + p.sessions.length, 0),
		[living]
	);

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
					{livingCount > 0 ? (
						<span className="truncate font-mono text-[10px] text-muted-foreground">
							{t('shell.jobs.runningCount', {count: livingCount})}
						</span>
					) : null}
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
				<section className="px-2 py-2">
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
