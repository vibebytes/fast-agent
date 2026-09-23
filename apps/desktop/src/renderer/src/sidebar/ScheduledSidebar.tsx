import {shellT as t} from '../i18n/t';
import {useCallback, useEffect, useRef, useState} from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {Clock, MoreHorizontal} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ScheduledJobRow, ScheduledJobRunRow} from '../panes/ScheduledJobsPane';
import {scheduledJobsVisible} from '../panes/scheduledJobsVisible';
import {isRunInProgress, planFireLabel, planPlace, relativeLabel, runSlice} from './scheduledList';

/** Center-pane plan list. A run click opens that session's chat. */
export function ScheduledPlans({onOpenTask}: {onOpenTask: (taskId: string) => Promise<void>}) {
	const {i18n} = useTranslation();
	const [jobs, setJobs] = useState<ScheduledJobRow[]>([]);
	const [runs, setRuns] = useState<Record<string, ScheduledJobRunRow[]>>({});
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [page, setPage] = useState<Record<string, number>>({});
	const [notice, setNotice] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const loadSeq = useRef(0);

	const load = useCallback(async () => {
		const mine = ++loadSeq.current;
		try {
			const listed = await window.fastIde.listScheduledJobs(null);
			if (mine !== loadSeq.current) return;
			if (!listed.ok) {
				setNotice(listed.notice);
				return;
			}
			const visible = scheduledJobsVisible(listed.jobs);
			const next: Record<string, ScheduledJobRunRow[]> = {};
			await Promise.all(
				visible.map(async job => {
					const history = await window.fastIde.listScheduledJobRuns(job.id);
					next[job.id] = history.ok ? history.runs : [];
				})
			);
			if (mine !== loadSeq.current) return;
			setNotice(null);
			setJobs(visible);
			setRuns(next);
		} catch (e) {
			if (mine !== loadSeq.current) return;
			setNotice(e instanceof Error ? e.message : String(e));
		} finally {
			if (mine === loadSeq.current) setLoaded(true);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		let timer: number | undefined;
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const typ = (payload.event as {type?: string}).type;
			if (typ !== 'child_work_changed' && typ !== 'task_updated') return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void load(), 400);
		});
		return () => {
			unsub();
			window.clearTimeout(timer);
		};
	}, [load]);

	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(id);
	}, []);

	async function applyPlanAction(id: string, op: 'pause' | 'resume' | 'cancel' | 'fireNow') {
		if (op === 'cancel' && !window.confirm(t('shell.jobs.cancelConfirm'))) return;
		const r =
			op === 'pause'
				? await window.fastIde.pauseScheduledJob(id)
				: op === 'resume'
					? await window.fastIde.resumeScheduledJob(id)
					: op === 'fireNow'
						? await window.fastIde.fireNowScheduledJob(id)
						: await window.fastIde.cancelScheduledJob(id);
		if (!r.ok) setNotice(r.notice ?? null);
		await load();
	}

	async function editCron(job: ScheduledJobRow) {
		const cronExpr = window.prompt(t('shell.jobs.cronPrompt'), job.cronExpr ?? '')?.trim();
		if (!cronExpr) return;
		if (!window.confirm(t('shell.jobs.cronConfirm', {cron: cronExpr}))) return;
		const r = await window.fastIde.updateScheduledJobCron(job.id, cronExpr, job.timezone ?? undefined);
		if (!r.ok) setNotice(r.notice ?? null);
		await load();
	}

	async function openRun(run: ScheduledJobRunRow, job: ScheduledJobRow) {
		const title = run.sessionTitle?.trim() || job.title?.trim() || t('shell.jobs.unnamed');
		const sessionType = job.kind === 'platform' ? 'automation' : undefined;
		const opened = await window.fastIde.openScheduledRun(
			run.sessionId,
			job.projectId,
			title,
			sessionType,
			job.workspaceRoot
		);
		if (!opened.ok) {
			setNotice(opened.notice);
			return;
		}
		setNotice(null);
		await onOpenTask(opened.taskId);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<header className="flex h-10 shrink-0 items-center border-b px-4 text-sm font-medium">
				{t('shell.sidebar.scheduled')}
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
				{notice ? <p className="pb-2 text-xs text-muted-foreground">{notice}</p> : null}
				{loaded && jobs.length === 0 && !notice ? (
					<p className="text-sm text-muted-foreground">{t('shell.jobs.scheduleEmpty')}</p>
				) : null}
				<ul className="mx-auto flex max-w-3xl flex-col gap-1">
					{jobs.map(job => {
						const title = job.title?.trim() || job.promptText?.trim() || t('shell.jobs.unnamed');
						const paused = job.status.toLowerCase() === 'paused';
						const history = runs[job.id] ?? [];
						const open = expanded[job.id] === true;
						const place = planPlace(job);
						const slice = runSlice(history, page[job.id] ?? 0);
						return (
							<li key={job.id}>
								<div className="flex items-center gap-1">
									<button
										type="button"
										className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
										onClick={() => setExpanded(prev => ({...prev, [job.id]: !open}))}
									>
										<Clock className="size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate">{title}</span>
										{place ? (
											<span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{place}</span>
										) : null}
										<span className="shrink-0 text-xs text-muted-foreground">
											{paused ? t('shell.jobs.paused') : planFireLabel(job.nextFireAt, job.timezone)}
										</span>
									</button>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
												aria-label={title}
											>
												<MoreHorizontal className="size-4" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-40">
											<DropdownMenuItem onClick={() => void editCron(job)}>{t('shell.jobs.editCron')}</DropdownMenuItem>
											<DropdownMenuItem onClick={() => void applyPlanAction(job.id, 'fireNow')}>
												{t('shell.jobs.fireNow')}
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => void applyPlanAction(job.id, paused ? 'resume' : 'pause')}>
												{paused ? t('shell.jobs.resume') : t('shell.jobs.pause')}
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => void applyPlanAction(job.id, 'cancel')}>
												{t('shell.jobs.cancel')}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
								{open ? (
									<div className="pb-2 pl-8">
										{slice.rows.length === 0 ? (
											<p className="px-2 py-1.5 text-xs text-muted-foreground">{t('shell.jobs.noRuns')}</p>
										) : null}
										<ul>
											{slice.rows.map(run => {
												const live = isRunInProgress(run.status);
												const label = run.sessionTitle?.trim() || title;
												return (
													<li key={run.id}>
														<button
															type="button"
															className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
															onClick={() => void openRun(run, job)}
														>
															<span className="min-w-0 flex-1 truncate">{label}</span>
															<span className="shrink-0 text-xs text-muted-foreground">
																{live ? t('shell.jobs.inProgress') : relativeLabel(run.startedAt, now, i18n.language)}
															</span>
														</button>
													</li>
												);
											})}
										</ul>
										{slice.pages > 1 ? (
											<div className="flex items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
												<button
													type="button"
													disabled={slice.page === 0}
													className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40"
													onClick={() => setPage(prev => ({...prev, [job.id]: slice.page - 1}))}
												>
													{t('shell.jobs.pagePrev')}
												</button>
												<span>{t('shell.jobs.pageStatus', {page: slice.page + 1, pages: slice.pages})}</span>
												<button
													type="button"
													disabled={slice.page >= slice.pages - 1}
													className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40"
													onClick={() => setPage(prev => ({...prev, [job.id]: slice.page + 1}))}
												>
													{t('shell.jobs.pageNext')}
												</button>
											</div>
										) : null}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
