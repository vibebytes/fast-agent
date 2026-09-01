import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MutableRefObject
} from 'react';
import type {
	GitFileChange,
	GitFileChangeKind,
	ReviewKind,
	ReviewList
} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger
} from '@fast-ide/ui/components/context-menu';
import {ScrollArea} from '@fast-ide/ui/components/scroll-area';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronRight, FileText, FolderOpen, RefreshCw} from 'lucide-react';
import type {ProjectState} from '../env';
import {FileTypeIcon} from '../files/FileTypeIcon';
import {FilePathMenuItems} from '../files/FilePathMenuItems';
import {
	agentDotClass,
	agentDotLabel,
	agentFilesMap,
	aggregateAgentKind,
	aggregateDirKind,
	gitDotClass,
	gitFilesMap,
	gitKindAt,
	gitNameClass
} from '../files/fileDecorations';
import {sortFsEntries} from '../files/sortFsEntries';
import {basename} from '../session/path';

type FsEntry = {name: string; kind: 'dir' | 'file'; relativePath: string};

const LIST_TRUNCATED_HINT = 'Showing first 5000 entries';

const TREE_ROW_INDENT = 16;

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function ancestorDirs(filePath: string): string[] {
	const parts = normPath(filePath).split('/').filter(Boolean);
	const dirs: string[] = [];
	let acc = '';
	for (let i = 0; i < parts.length - 1; i++) {
		acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
		dirs.push(acc);
	}
	return dirs;
}

export function FilesPane({
	project,
	onOpenFile,
	activeFilePath,
	gitFiles,
	agentReview,
	onRefreshGit
}: {
	project: ProjectState | null;
	onOpenFile: (relativePath: string) => void;
	/** Last focused document path — highlight + reveal when Files tab is shown. */
	activeFilePath?: string | null;
	gitFiles?: GitFileChange[];
	/** Undecided agent changes — a second overlay, independent of git and of any `.git` existing. */
	agentReview?: ReviewList;
	onRefreshGit?: () => void;
}) {
	const [entries, setEntries] = useState<FsEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	/** True only after a short delay — avoids a 5s “Loading files…” when I/O is just slow to start. */
	const [showLoadingLabel, setShowLoadingLabel] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [childrenByPath, setChildrenByPath] = useState<Map<string, FsEntry[]>>(() => new Map());
	const [truncatedDirs, setTruncatedDirs] = useState<Set<string>>(() => new Set());
	const [rootTruncated, setRootTruncated] = useState(false);
	const [dirErrors, setDirErrors] = useState<Map<string, string>>(() => new Map());
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
	const rowEls = useRef<Map<string, HTMLButtonElement>>(new Map());
	const revealGen = useRef(0);
	const childrenRef = useRef(childrenByPath);
	childrenRef.current = childrenByPath;
	const projectPath = project?.path ?? null;
	const selectedPath = activeFilePath ? normPath(activeFilePath) : null;
	const gitMap = useMemo(() => gitFilesMap(gitFiles), [gitFiles]);
	const agentMap = useMemo(() => agentFilesMap(agentReview), [agentReview]);

	const loadDir = useCallback(async (relativePath: string): Promise<FsEntry[] | null> => {
		if (typeof window.fastIde.listWorkspaceDir !== 'function') {
			setDirErrors(prev => {
				const next = new Map(prev);
				next.set(relativePath, 'listWorkspaceDir API unavailable — restart the desktop app');
				return next;
			});
			return null;
		}
		setLoadingDirs(prev => new Set(prev).add(relativePath));
		try {
			const result = await window.fastIde.listWorkspaceDir(relativePath);
			if (!result.ok) {
				setDirErrors(prev => {
					const next = new Map(prev);
					next.set(relativePath, result.error ?? 'Failed to list');
					return next;
				});
				setChildrenByPath(prev => {
					const next = new Map(prev);
					next.set(relativePath, []);
					return next;
				});
				setTruncatedDirs(prev => {
					const next = new Set(prev);
					next.delete(relativePath);
					return next;
				});
				return [];
			}
			setDirErrors(prev => {
				const next = new Map(prev);
				next.delete(relativePath);
				return next;
			});
			const sorted = sortFsEntries(result.entries);
			setChildrenByPath(prev => {
				const next = new Map(prev);
				next.set(relativePath, sorted);
				return next;
			});
			setTruncatedDirs(prev => {
				const next = new Set(prev);
				if (result.truncated) next.add(relativePath);
				else next.delete(relativePath);
				return next;
			});
			return sorted;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setDirErrors(prev => {
				const next = new Map(prev);
				next.set(relativePath, message);
				return next;
			});
			setChildrenByPath(prev => {
				const next = new Map(prev);
				next.set(relativePath, []);
				return next;
			});
			setTruncatedDirs(prev => {
				const next = new Set(prev);
				next.delete(relativePath);
				return next;
			});
			return [];
		} finally {
			setLoadingDirs(prev => {
				const next = new Set(prev);
				next.delete(relativePath);
				return next;
			});
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		let tipTimer: ReturnType<typeof setTimeout> | null = null;

		async function loadRoot() {
			if (!projectPath) {
				setEntries([]);
				setError(null);
				setLoading(false);
				setExpanded(new Set());
				setChildrenByPath(new Map());
				return;
			}
			if (typeof window.fastIde.listWorkspaceDir !== 'function') {
				setEntries([]);
				setError('listWorkspaceDir API unavailable — restart the desktop app after update');
				setLoading(false);
				return;
			}

			setLoading(true);
			// Defer the label so a fast list never flashes “Loading files…”.
			tipTimer = setTimeout(() => {
				if (!cancelled) setShowLoadingLabel(true);
			}, 120);
			setExpanded(new Set());
			setChildrenByPath(new Map());
			setTruncatedDirs(new Set());
			setRootTruncated(false);
			setDirErrors(new Map());
			try {
				const result = await window.fastIde.listWorkspaceDir('');
				if (cancelled) return;
				if (!result.ok) {
					setEntries([]);
					setError(result.error ?? 'Failed to list directory');
					return;
				}
				setError(null);
				setEntries(sortFsEntries(result.entries));
				setRootTruncated(Boolean(result.truncated));
			} catch (err) {
				if (cancelled) return;
				setEntries([]);
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				if (tipTimer) clearTimeout(tipTimer);
				if (!cancelled) {
					setShowLoadingLabel(false);
					setLoading(false);
				}
			}
		}

		void loadRoot();
		return () => {
			cancelled = true;
			if (tipTimer) clearTimeout(tipTimer);
		};
	}, [projectPath, reloadToken]);

	useEffect(() => {
		if (!selectedPath || !projectPath) return;
		const target = selectedPath;
		const gen = ++revealGen.current;
		const dirs = ancestorDirs(target);

		async function reveal() {
			for (const dir of dirs) {
				if (revealGen.current !== gen) return;
				setExpanded(prev => {
					if (prev.has(dir)) return prev;
					const next = new Set(prev);
					next.add(dir);
					return next;
				});
				if (childrenRef.current.get(dir) === undefined) {
					await loadDir(dir);
					if (revealGen.current !== gen) return;
				}
			}
			requestAnimationFrame(() => {
				if (revealGen.current !== gen) return;
				rowEls.current.get(target)?.scrollIntoView({block: 'nearest'});
			});
		}

		void reveal();
	}, [selectedPath, projectPath, reloadToken, loadDir]);

	async function toggleDir(relativePath: string) {
		const key = normPath(relativePath);
		if (expanded.has(key)) {
			setExpanded(prev => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
			return;
		}
		setExpanded(prev => new Set(prev).add(key));
		if (!childrenByPath.has(key)) {
			await loadDir(key);
		}
	}

	function onRefresh() {
		setReloadToken(n => n + 1);
		onRefreshGit?.();
	}

	if (!project || !projectPath) {
		return (
			<div className="p-3 text-xs leading-snug text-muted-foreground">
				<p className="mb-0.5 font-medium text-foreground">No project selected</p>
				Open a project to browse its files.
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col text-xs leading-5">
			<div className="flex h-8 shrink-0 items-center gap-0.5 border-b px-2">
				<span
					className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground"
					title={projectPath}
				>
					{project.displayName?.trim() || basename(projectPath)}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-6 shrink-0"
					aria-label="Refresh files"
					title="Refresh"
					disabled={loading}
					onClick={onRefresh}
				>
					<RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
				</Button>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				{error ? (
					<p className="px-2 py-1.5 text-xs text-destructive">{error}</p>
				) : showLoadingLabel && loading && entries.length === 0 ? (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">Loading files…</p>
				) : entries.length === 0 && !loading ? (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">Empty folder</p>
				) : (
					<ul className="px-1 py-1">
						{entries.map(entry => (
							<FileTreeNode
								key={entry.relativePath}
								entry={entry}
								depth={0}
								expanded={expanded}
								childrenByPath={childrenByPath}
								truncatedDirs={truncatedDirs}
								loadingDirs={loadingDirs}
								dirErrors={dirErrors}
								selectedPath={selectedPath}
								gitMap={gitMap}
								agentMap={agentMap}
								projectPath={projectPath}
								onOpenFile={onOpenFile}
								onToggleDir={path => void toggleDir(path)}
								rowEls={rowEls}
							/>
						))}
						{rootTruncated ? (
							<li className="px-2 py-1 text-xs text-muted-foreground">{LIST_TRUNCATED_HINT}</li>
						) : null}
					</ul>
				)}
			</ScrollArea>
		</div>
	);
}

function FileTreeNode({
	entry,
	depth,
	expanded,
	childrenByPath,
	truncatedDirs,
	loadingDirs,
	dirErrors,
	selectedPath,
	gitMap,
	agentMap,
	projectPath,
	onOpenFile,
	onToggleDir,
	rowEls
}: {
	entry: FsEntry;
	depth: number;
	expanded: Set<string>;
	childrenByPath: Map<string, FsEntry[]>;
	truncatedDirs: Set<string>;
	loadingDirs: Set<string>;
	dirErrors: Map<string, string>;
	selectedPath: string | null;
	gitMap: Map<string, GitFileChangeKind>;
	agentMap: Map<string, ReviewKind>;
	projectPath: string;
	onOpenFile: (relativePath: string) => void;
	onToggleDir: (relativePath: string) => void;
	rowEls: MutableRefObject<Map<string, HTMLButtonElement>>;
}) {
	const path = normPath(entry.relativePath);
	const isDir = entry.kind === 'dir';
	const open = isDir && expanded.has(path);
	const selected = !isDir && selectedPath === path;
	const padLeft = 8 + depth * TREE_ROW_INDENT;
	const gitKind = isDir ? aggregateDirKind(path, gitMap) : gitKindAt(path, gitMap);
	const agentKind = isDir ? aggregateAgentKind(path, agentMap) : (agentMap.get(path) ?? null);
	const children = isDir && open ? (childrenByPath.get(path) ?? null) : null;
	const loading = isDir && open && loadingDirs.has(path);
	const dirError = isDir && open ? (dirErrors.get(path) ?? null) : null;
	const truncated = isDir && open && truncatedDirs.has(path);

	return (
		<li className="relative">
			{depth > 0 ? (
				<span
					className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/70"
					style={{left: 8 + (depth - 1) * TREE_ROW_INDENT + 5}}
					aria-hidden
				/>
			) : null}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						ref={el => {
							if (el) rowEls.current.set(path, el);
							else rowEls.current.delete(path);
						}}
						className={cn(
							'flex h-7 w-full items-center gap-1 rounded-md pr-1.5 text-left text-xs text-foreground',
							'hover:bg-muted/60',
							selected && 'bg-muted data-[selected]:bg-muted'
						)}
						style={{paddingLeft: padLeft}}
						title={entry.relativePath}
						data-selected={selected || undefined}
						onClick={() => {
							if (isDir) onToggleDir(path);
							else onOpenFile(entry.relativePath);
						}}
					>
						{isDir ? (
							<ChevronRight
								className={cn(
									'size-3.5 shrink-0 text-muted-foreground/80 transition-transform',
									open && 'rotate-90'
								)}
							/>
						) : (
							<span className="size-3.5 shrink-0" />
						)}
						{isDir ? null : <FileTypeIcon name={entry.name} size={14} />}
						<span
							className={cn(
								'min-w-0 flex-1 truncate',
								gitKind ? gitNameClass(gitKind) : null
							)}
						>
							{entry.name}
						</span>
						{agentKind ? (
							<span
								className={cn('size-2 shrink-0 rounded-full', agentDotClass())}
								title={agentDotLabel(agentKind)}
								aria-label={agentDotLabel(agentKind)}
							/>
						) : null}
						{gitKind ? (
							<span
								className={cn('size-2 shrink-0 rounded-full', gitDotClass(gitKind))}
								title={gitKind}
								aria-label={gitKind}
							/>
						) : null}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-52">
					<FilePathMenuItems
						relativePath={path}
						projectPath={projectPath}
						onOpen={() => {
							if (isDir) onToggleDir(path);
							else onOpenFile(entry.relativePath);
						}}
						openIcon={
							isDir ? <FolderOpen className="size-3.5" /> : <FileText className="size-3.5" />
						}
					/>
				</ContextMenuContent>
			</ContextMenu>
			{isDir && open ? (
				<ul>
					{loading ? (
						<li
							className="h-7 px-1 text-xs leading-7 text-muted-foreground"
							style={{paddingLeft: padLeft + TREE_ROW_INDENT}}
						>
							Loading…
						</li>
					) : null}
					{dirError ? (
						<li
							className="h-7 px-1 text-xs leading-7 text-destructive"
							style={{paddingLeft: padLeft + TREE_ROW_INDENT}}
						>
							{dirError}
						</li>
					) : null}
					{children?.map(child => (
						<FileTreeNode
							key={child.relativePath}
							entry={child}
							depth={depth + 1}
							expanded={expanded}
							childrenByPath={childrenByPath}
							truncatedDirs={truncatedDirs}
							loadingDirs={loadingDirs}
							dirErrors={dirErrors}
							selectedPath={selectedPath}
							gitMap={gitMap}
							agentMap={agentMap}
							projectPath={projectPath}
							onOpenFile={onOpenFile}
							onToggleDir={onToggleDir}
							rowEls={rowEls}
						/>
					))}
					{truncated ? (
						<li
							className="h-7 px-1 text-xs leading-7 text-muted-foreground"
							style={{paddingLeft: padLeft + TREE_ROW_INDENT}}
						>
							{LIST_TRUNCATED_HINT}
						</li>
					) : null}
					{children && children.length === 0 && !loading && !dirError ? (
						<li
							className="h-7 px-1 text-xs leading-7 text-muted-foreground"
							style={{paddingLeft: padLeft + TREE_ROW_INDENT}}
						>
							Empty
						</li>
					) : null}
				</ul>
			) : null}
		</li>
	);
}
