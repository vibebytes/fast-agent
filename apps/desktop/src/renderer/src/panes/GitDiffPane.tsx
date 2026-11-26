import {lazy, Suspense, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {GitFileDiff} from '@fast-ide/session-view';
import {GitCompare} from 'lucide-react';
import type {RailTab} from '../railTabs';

const MonacoDiff = lazy(() => import('../MonacoDiff').then(m => ({default: m.MonacoDiff})));

export type GitDiffPresentation =
	| {kind: 'empty'}
	| {kind: 'binary'}
	| {kind: 'hunks'}
	| {kind: 'monaco'; original: string; modified: string};

export function gitDiffPresentation(diff: GitFileDiff | null): GitDiffPresentation {
	if (!diff) return {kind: 'empty'};
	if (diff.binary) return {kind: 'binary'};
	if (diff.original != null && diff.modified != null) {
		return {kind: 'monaco', original: diff.original, modified: diff.modified};
	}
	return diff.hunks.length > 0 ? {kind: 'hunks'} : {kind: 'empty'};
}

function HunkDiff({diff}: {diff: GitFileDiff}) {
	return (
		<div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-5">
			{diff.hunks.map((hunk, index) => (
				<div key={`${hunk.header}-${index}`}>
					<div className="border-y border-border/40 bg-muted/50 px-3 py-0.5 text-[10px] text-muted-foreground">
						{hunk.header}
					</div>
					{hunk.lines.map((line, lineIndex) => (
						<div
							key={lineIndex}
							className={
								line.startsWith('+')
									? 'whitespace-pre-wrap break-all bg-emerald-500/10 px-3 text-emerald-900 dark:text-emerald-200'
									: line.startsWith('-')
										? 'whitespace-pre-wrap break-all bg-red-500/10 px-3 text-red-900 dark:text-red-200'
										: 'whitespace-pre-wrap break-all px-3'
							}
						>
							{line || ' '}
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function GitDiffPane({tab, refreshToken = 0}: {tab: RailTab; refreshToken?: number}) {
	const {t} = useTranslation();
	const repoPath = tab.repoPath ?? '';
	const path = tab.filePath ?? tab.title;
	const [loading, setLoading] = useState(true);
	const [diff, setDiff] = useState<GitFileDiff | null>(null);
	const [error, setError] = useState<string | null>(null);
	const presentation = gitDiffPresentation(diff);

	useEffect(() => {
		let live = true;
		setLoading(true);
		setError(null);
		setDiff(null);
		void window.fastIde.gitFileDiff(repoPath, path, false)
			.then(result => {
				if (!live) return;
				if (result.ok) setDiff(result.file);
				else setError(result.error);
			})
			.catch(reason => {
				if (live) setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [repoPath, path, refreshToken]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
				<GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={path}>
					{repoPath ? `${repoPath}/${path}` : path}
				</span>
				{diff && diff.hunks.length > 0 ? (
					<span className="shrink-0 font-mono text-[10px] tabular-nums">
						<span className="text-emerald-600">+{diff.additions}</span>
						<span className="ml-1 text-red-500">-{diff.deletions}</span>
					</span>
				) : null}
			</div>
			{diff?.truncated ? (
				<p className="shrink-0 border-b border-border/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
					{t('shell.changes.scmTruncated')}
				</p>
			) : null}
			{loading ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{t('shell.changes.loadingDiff')}
				</div>
			) : error ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-destructive">{error}</div>
			) : presentation.kind === 'empty' ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{t('shell.changes.scmNoDiff')}
				</div>
			) : presentation.kind === 'binary' ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{t('shell.changes.scmBinary')}
				</div>
			) : presentation.kind === 'hunks' && diff ? (
				<HunkDiff diff={diff} />
			) : presentation.kind === 'monaco' ? (
				<Suspense
					fallback={
						<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
							{t('shell.changes.loadingDiff')}
						</div>
					}
				>
					<MonacoDiff original={presentation.original} modified={presentation.modified} path={path} />
				</Suspense>
			) : null}
		</div>
	);
}
