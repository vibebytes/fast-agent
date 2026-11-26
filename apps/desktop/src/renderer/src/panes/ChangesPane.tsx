import {Fragment, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {GitFileChange, GitFileDiff, GitRepoStatus, GitStatus} from '@fast-ide/session-view';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronRight, FileText, RefreshCw} from 'lucide-react';
import {pathLabel} from '../session/path';

const KindLetter: Record<GitFileChange['kind'], {letter: string; labelKey: string; className: string}> = {
	added: {letter: 'A', labelKey: 'shell.changes.kindAdded', className: 'text-emerald-600 dark:text-emerald-400'},
	deleted: {letter: 'D', labelKey: 'shell.changes.kindDeleted', className: 'text-red-500 dark:text-red-400'},
	modified: {letter: 'M', labelKey: 'shell.changes.kindModified', className: 'text-amber-600 dark:text-amber-400'}
};

function workspacePath(repoPath: string, path: string): string {
	return repoPath ? `${repoPath.replace(/\/$/, '')}/${path}` : path;
}

function GitChangeCard({
	repo,
	file,
	status,
	onOpenFile
}: {
	repo: GitRepoStatus;
	file: GitFileChange;
	status: GitStatus;
	onOpenFile?: (path: string) => void;
}) {
	const {t} = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const [loading, setLoading] = useState(false);
	const [diff, setDiff] = useState<GitFileDiff | null>(null);
	const [error, setError] = useState<string | null>(null);
	const kind = KindLetter[file.kind];
	const label = pathLabel(file.path);

	useEffect(() => {
		if (!expanded) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		void window.fastIde.gitFileDiff(repo.path, file.path)
			.then(result => {
				if (cancelled) return;
				if (result.ok) setDiff(result.file);
				else setError(result.error);
			})
			.catch(error => {
				if (!cancelled) setError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [expanded, repo.path, file.path, status]);

	return (
		<div className="overflow-hidden rounded-md border border-border/60 bg-card">
			<div
				className="flex min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-muted/40"
				role="button"
				tabIndex={0}
				data-testid={`git-change-${repo.path}:${file.path}`}
				onClick={() => setExpanded(value => !value)}
				onKeyDown={event => {
					if (event.key === 'Enter' || event.key === ' ') setExpanded(value => !value);
				}}
			>
				<ChevronRight className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
				<span className={cn('w-3 text-center font-mono text-[11px] font-bold', kind.className)} title={t(kind.labelKey)}>
					{kind.letter}
				</span>
				<FileText className="size-3.5 shrink-0 text-muted-foreground" />
				<span
					className="min-w-0 flex-1 truncate font-mono text-[11px] hover:underline"
					data-testid={`git-open-${repo.path}:${file.path}`}
					title={file.path}
					onClick={event => {
						event.stopPropagation();
						onOpenFile?.(workspacePath(repo.path, file.path));
					}}
				>
					{label.dir ? <span className="text-muted-foreground">{label.dir}/</span> : null}
					<span className="font-medium">{label.name}</span>
				</span>
				{diff ? (
					<span className="shrink-0 font-mono text-[10px] tabular-nums">
						{diff.additions > 0 ? <span className="text-emerald-600">+{diff.additions}</span> : null}
						{diff.deletions > 0 ? <span className="ml-1 text-red-500">-{diff.deletions}</span> : null}
					</span>
				) : null}
			</div>
			{expanded ? (
				<div className="border-t border-border/50 bg-background font-mono text-[11px] leading-5">
					{loading ? (
						<p className="p-3 text-muted-foreground">{t('shell.changes.loadingDiff')}</p>
					) : error ? (
						<p className="p-3 text-destructive">{error}</p>
					) : diff ? (
						<>
							{diff.truncated ? (
								<p className="border-b border-border/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
									{t('shell.changes.scmTruncated')}
								</p>
							) : null}
							{diff.binary ? (
								<p className="p-3 text-muted-foreground">{t('shell.changes.scmBinary')}</p>
							) : diff.hunks.length ? (
								diff.hunks.map((hunk, index) => (
									<Fragment key={`${hunk.header}-${index}`}>
										<div className="border-y border-border/40 bg-muted/50 px-3 py-0.5 text-[10px] text-muted-foreground">
											{hunk.header}
										</div>
										{hunk.lines.map((line, lineIndex) => (
											<div
												key={lineIndex}
												className={cn(
													'whitespace-pre-wrap break-all px-3',
													line.startsWith('+') && 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
													line.startsWith('-') && 'bg-red-500/10 text-red-900 dark:text-red-200'
												)}
											>
												{line || ' '}
											</div>
										))}
									</Fragment>
								))
							) : !diff.truncated ? (
								<p className="p-3 text-muted-foreground">{t('shell.changes.scmNoDiff')}</p>
							) : null}
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** Repository-scoped working-tree changes. This pane is independent of agent checkpoint review. */
export function ChangesPane({
	status,
	onOpenFile,
	onRefresh
}: {
	status: GitStatus | null;
	onOpenFile?: (path: string) => void;
	onRefresh?: () => void;
}) {
	const {t} = useTranslation();
	const repos = useMemo<GitRepoStatus[]>(() => {
		if (!status) return [];
		if (status.repos) return status.repos;
		return [{path: '', name: status.branch, branch: status.branch, files: status.files}];
	}, [status]);
	const fileCount = repos.reduce((count, repo) => count + repo.files.length, 0);

	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
			<div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-2.5 py-1.5">
				<div className="min-w-0 flex-1">
					<p className="truncate text-xs font-medium">
						{fileCount === 1
							? t('shell.changes.oneFile')
							: t('shell.changes.filesCount', {count: fileCount})}
					</p>
					<p className="truncate text-[10px] text-muted-foreground">{t('shell.changes.workingTree')}</p>
				</div>
				<button
					type="button"
					className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title={t('shell.changes.refresh')}
					onClick={onRefresh}
				>
					<RefreshCw className="size-3.5" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-2">
				{!status ? (
					<p className="p-3 text-sm text-muted-foreground">{t('shell.changes.scmUnavailable')}</p>
				) : fileCount === 0 ? (
					<div className="p-3 text-sm text-muted-foreground">
						<p className="mb-1 font-medium text-foreground">{t('shell.changes.scmEmptyTitle')}</p>
						<p>{t('shell.changes.scmEmptyHint')}</p>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{repos.map(repo => (
							<section key={repo.path} className="flex flex-col gap-1.5">
								<header className="flex items-center gap-1.5 px-1 text-[11px]">
									<span className="truncate font-semibold">{repo.name}</span>
									<span className="truncate text-muted-foreground">{repo.branch}</span>
									<span className="ml-auto text-muted-foreground">{repo.files.length}</span>
								</header>
								{repo.files.map(file => (
									<GitChangeCard
										key={`${repo.path}:${file.path}`}
										repo={repo}
										file={file}
										status={status}
										onOpenFile={onOpenFile}
									/>
								))}
							</section>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
