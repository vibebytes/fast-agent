import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {GitFileDiff} from '@fast-ide/session-view';
import {GitCompare} from 'lucide-react';
import type {MonacoEditorHandle} from '../MonacoEditor';
import {gitDiffHunks, gitDiffOverlay, type GitHunk} from '../gitDiffHunks';
import type {RailTab} from '../railTabs';

const MonacoEditor = lazy(() => import('../MonacoEditor').then(m => ({default: m.MonacoEditor})));
const MonacoDiff = lazy(() => import('../MonacoDiff').then(m => ({default: m.MonacoDiff})));

type GitDiffView = 'changes' | 'file' | 'diff';

function linePrefix(kind: GitHunk['lines'][number]['kind']): string {
	return kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
}

function HunkDiff({
	hunks,
	activeIndex,
	onSelect
}: {
	hunks: GitHunk[];
	activeIndex?: number;
	onSelect?: (index: number) => void;
}) {
	return (
		<div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-5">
			{hunks.map((hunk, index) => (
				<div key={`${hunk.header}-${index}`} data-testid={`git-hunk-panel-${index}`}>
					<button
						type="button"
						onClick={() => onSelect?.(index)}
						aria-pressed={activeIndex === index}
						className={
							activeIndex === index
								? 'flex w-full items-center gap-2 border-y border-border/40 bg-primary/10 px-3 py-0.5 text-left text-[10px] text-foreground'
								: 'flex w-full items-center gap-2 border-y border-border/40 bg-muted/50 px-3 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-muted'
						}
					>
						<span className="min-w-0 flex-1 truncate">{hunk.header}</span>
						<span className="shrink-0 tabular-nums">
							<span className="text-emerald-600">+{hunk.additions}</span>
							<span className="ml-1 text-red-500">-{hunk.deletions}</span>
						</span>
					</button>
					{hunk.lines.map((line, lineIndex) => (
						<div
							key={lineIndex}
							className={
								line.kind === 'add'
									? 'whitespace-pre-wrap break-all bg-emerald-500/10 px-3 text-emerald-900 dark:text-emerald-200'
									: line.kind === 'del'
										? 'whitespace-pre-wrap break-all bg-red-500/10 px-3 text-red-900 dark:text-red-200'
										: 'whitespace-pre-wrap break-all px-3'
							}
						>
							{`${linePrefix(line.kind)}${line.text}`}
						</div>
					))}
				</div>
			))}
		</div>
	);
}

function HunkNav({
	hunks,
	activeIndex,
	onSelect
}: {
	hunks: GitHunk[];
	activeIndex: number;
	onSelect: (index: number) => void;
}) {
	const {t} = useTranslation();
	return (
		<aside className="w-56 shrink-0 overflow-auto border-r bg-muted/20">
			<div className="border-b px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{t('shell.changes.workingTree')}
			</div>
			{hunks.map((hunk, index) => (
				<button
					key={`${hunk.header}-${index}`}
					type="button"
					data-testid={`git-hunk-nav-${index}`}
					aria-pressed={activeIndex === index}
					onClick={() => onSelect(index)}
					className={
						activeIndex === index
							? 'flex w-full flex-col gap-0.5 border-b border-border/40 bg-primary/10 px-2 py-1.5 text-left'
							: 'flex w-full flex-col gap-0.5 border-b border-border/40 px-2 py-1.5 text-left hover:bg-muted'
					}
				>
					<span className="truncate font-mono text-[10px] text-muted-foreground">{hunk.header}</span>
					<span className="font-mono text-[10px] tabular-nums">
						<span className="text-emerald-600">+{hunk.additions}</span>
						<span className="ml-1 text-red-500">-{hunk.deletions}</span>
					</span>
				</button>
			))}
		</aside>
	);
}

export function GitDiffPane({
	tab,
	refreshToken = 0,
	active = true
}: {
	tab: RailTab;
	refreshToken?: number;
	active?: boolean;
}) {
	const {t} = useTranslation();
	const repoPath = tab.repoPath ?? '';
	const path = tab.filePath ?? tab.title;
	const [loading, setLoading] = useState(true);
	const [diff, setDiff] = useState<GitFileDiff | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [view, setView] = useState<GitDiffView>('changes');
	const [activeHunk, setActiveHunk] = useState(0);
	const editorRef = useRef<MonacoEditorHandle | null>(null);
	const pendingReveal = useRef<number | null>(null);

	const hunks = useMemo(() => (diff ? gitDiffHunks(diff) : []), [diff]);
	const overlay = useMemo(() => (diff ? gitDiffOverlay(diff, hunks) : null), [diff, hunks]);
	const hasHunks = hunks.length > 0;
	const hasSides = diff?.original != null && diff?.modified != null;
	const modelPath = repoPath ? `${repoPath}/${path}` : path;

	const fetchDiff = useCallback(
		() => window.fastIde.gitFileDiff(repoPath, path, true),
		[repoPath, path]
	);

	useEffect(() => {
		let live = true;
		setLoading(true);
		setError(null);
		setSaveError(null);
		setDirty(false);
		setActiveHunk(0);
		setDiff(null);
		void fetchDiff()
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
	}, [fetchDiff, refreshToken]);

	useEffect(() => {
		if (!diff) return;
		setView(current => {
			if (current === 'diff' && !hasSides) return hasHunks ? 'changes' : 'file';
			if (current === 'file' && !hasSides) return hasHunks ? 'changes' : 'file';
			if (current === 'changes' && !hasHunks && hasSides) return 'file';
			return current;
		});
	}, [diff, hasHunks, hasSides]);

	const revealHunk = useCallback(
		(index: number) => {
			setActiveHunk(index);
			const line = hunks[index]?.targetLine ?? 1;
			const editor = editorRef.current;
			if (editor) {
				editor.revealPosition?.(line);
				pendingReveal.current = null;
			} else {
				pendingReveal.current = line;
			}
		},
		[hunks]
	);

	const openHunk = useCallback(
		(index: number) => {
			if (!hasSides) {
				setActiveHunk(index);
				return;
			}
			setView('file');
			revealHunk(index);
		},
		[hasSides, revealHunk]
	);

	const handleEditorReady = useCallback((handle: MonacoEditorHandle | null) => {
		editorRef.current = handle;
		if (!handle || pendingReveal.current == null) return;
		const line = pendingReveal.current;
		pendingReveal.current = null;
		handle.revealPosition?.(line);
	}, []);

	const save = useCallback(async () => {
		const editor = editorRef.current;
		if (!diff || !editor || !dirty) return;
		setSaving(true);
		setSaveError(null);
		const relativePath = repoPath ? `${repoPath}/${path}` : path;
		try {
			const result = await window.fastIde.saveWorkspaceFile(relativePath, editor.getValue());
			if (!result.ok) {
				setSaveError(result.error);
				return;
			}
			setDirty(false);
			const refreshed = await fetchDiff();
			if (refreshed.ok) setDiff(refreshed.file);
			else setSaveError(refreshed.error);
		} catch (reason) {
			setSaveError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setSaving(false);
		}
	}, [diff, dirty, fetchDiff, path, repoPath]);

	useEffect(() => {
		if (!active || view !== 'file' || !dirty) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
			event.preventDefault();
			void save();
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [active, dirty, save, view]);

	const viewOptions: Array<{id: GitDiffView; label: string; enabled: boolean}> = [
		{id: 'changes', label: t('shell.tabs.changes'), enabled: hasHunks},
		{id: 'file', label: t('shell.tabs.file'), enabled: diff?.modified != null},
		{id: 'diff', label: t('shell.tabs.diff'), enabled: hasSides}
	];

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
				<div role="group" aria-label={t('shell.changes.workingTree')} className="flex shrink-0 rounded-full bg-muted p-0.5">
					{viewOptions.map(option => (
						<button
							key={option.id}
							type="button"
							data-testid={`git-diff-view-${option.id}`}
							aria-pressed={view === option.id}
							disabled={!option.enabled}
							onClick={() => setView(option.id)}
							className={
								view === option.id
									? 'rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-foreground disabled:opacity-40'
									: 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
							}
						>
							{option.label}
						</button>
					))}
				</div>
				{view === 'file' && diff?.modified != null ? (
					<button
						type="button"
						data-testid="git-diff-save"
						disabled={!dirty || saving}
						onClick={() => void save()}
						className="shrink-0 rounded border px-2 py-0.5 text-[11px] disabled:opacity-40"
					>
						{saving ? t('shell.common.saving') : t('shell.common.save')}
					</button>
				) : null}
			</div>
			{saveError ? (
				<p className="shrink-0 border-b border-border/40 bg-destructive/10 p-2 text-[11px] text-destructive">
					{saveError}
				</p>
			) : null}
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
			) : !diff || diff.binary ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{diff?.binary ? t('shell.changes.scmBinary') : t('shell.changes.scmNoDiff')}
				</div>
			) : view === 'changes' && hasHunks ? (
				<HunkDiff hunks={hunks} activeIndex={activeHunk} onSelect={openHunk} />
			) : view === 'file' && diff.modified != null ? (
				<div className="flex min-h-0 flex-1">
					{hasHunks ? <HunkNav hunks={hunks} activeIndex={activeHunk} onSelect={revealHunk} /> : null}
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<Suspense
							fallback={
								<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
									{t('shell.changes.loadingDiff')}
								</div>
							}
						>
							<MonacoEditor
								defaultValue={diff.modified}
								path={modelPath}
								reviewDiff={overlay}
								reviewDirty={dirty}
								reviewReloadEpoch={refreshToken}
								reviewVisible={active}
								onChange={value => setDirty(value !== diff.modified)}
								onReady={handleEditorReady}
								className="flex-1"
							/>
						</Suspense>
					</div>
				</div>
			) : view === 'diff' && hasSides ? (
				<Suspense
					fallback={
						<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
							{t('shell.changes.loadingDiff')}
						</div>
					}
				>
					<MonacoDiff
						original={diff.original ?? ''}
						modified={diff.modified ?? ''}
						path={path}
					/>
				</Suspense>
			) : (
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{t('shell.changes.scmNoDiff')}
				</div>
			)}
		</div>
	);
}
