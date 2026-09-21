import {shellT as t} from '../i18n/t';
import {useState} from 'react';
import type {LiveProc, LiveTask} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {Clock, History, Pause, Play, Square, SquareTerminal, Trash2, Zap} from 'lucide-react';
import {focusTranscriptTurn} from './focusTurn';
import {previewLines, useCountdownLabel, useElapsedLabel} from './drawerPreview';

type JobRunRow = {
	id: string;
	status: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	summary?: string | null;
	error?: string | null;
	runId?: string | null;
};

export function ProcRow({proc}: {proc: LiveProc}) {
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

export function TaskRow({task}: {task: LiveTask}) {
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
