import {shellT as t} from './i18n/t';
import {
	lazy,
	memo,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState
} from 'react';
import type {GitFileChange} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList
} from '@fast-ide/ui/components/command';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import {PanelRight, Plus, X} from 'lucide-react';
import type {CodeChange, ProjectState} from './env';
import {ConflictChoiceDialog, type ConflictChoiceRequest} from './ConflictChoiceDialog';
import {CloseDirtyDialog, type CloseDirtyRequest} from './CloseDirtyDialog';
import {
	isSelfEcho,
	missingDocumentPatch,
	openFileAlert,
	probeDisk,
	resolveConflict,
	saveDocument
} from './documentFs';
import {type CloseDirtyChoice, type ConflictChoice} from './documentMerge';
import type {EditorCursorStatus, MonacoEditorHandle} from './MonacoEditor';
import {ErrorBoundary} from './ErrorBoundary';
import {BrowserPane} from './panes/BrowserPane';
import {CanvasPane} from './panes/CanvasPane';
import {ChangesPane} from './panes/ChangesPane';
import {ContextPane} from './panes/ContextPane';
import {DocumentPane} from './panes/DocumentPane';
import {FilesPane} from './panes/FilesPane';
import {ReviewDiffPane} from './panes/ReviewDiffPane';
import {TerminalPane} from './panes/TerminalPane';
import type {ReviewRow} from './review/agentReview';
import {openReviewDiff} from './review/openReviewDiff';
import type {AgentReview} from './review/useAgentReview';

// Low-frequency pane — load on first open (perf doc P1-9).
const ScheduledJobsPane = lazy(() =>
	import('./panes/ScheduledJobsPane').then(m => ({default: m.ScheduledJobsPane}))
);
import {
	createRailTab,
	diffTabId,
	filesTab,
	FILES_TAB_ID,
	newTabOptions,
	newTabId,
	railTabTitle,
	type NewTabKind,
	type RailTab,
	type RailTabKind,
	TabKindIcon
} from './railTabs';
import {basename} from './session/path';

export type {RailTabKind, RailTab};
export {createRailTab};

function RightWorkbenchImpl({
	changes,
	project,
	layout,
	onCollapse,
	openFileRequest,
	onOpenFileRequestHandled,
	openDiffRequest,
	openScheduledRequest,
	onOpenScheduledRequestHandled,
	focusSessionId,
	onOpenLivingSession,
	onOpenTeams,
	onEditorStatus,
	gitFiles,
	review,
	onReviewDirtyPaths,
	onRefreshGit
}: {
	changes: CodeChange[];
	project: ProjectState | null;
	layout: 'coding' | 'general';
	onCollapse: () => void;
	/** When set (e.g. from chat file cards), open that path as a document tab. */
	openFileRequest?: {
		path: string;
		line?: number;
		endLine?: number;
		nonce: number;
	} | null;
	onOpenFileRequestHandled?: () => void;
	/** When set (e.g. from the composer review strip), open that agent change as a diff tab. */
	openDiffRequest?: {changeId: string; path: string; nonce: number} | null;
	/** @deprecated Kept for App wiring; clearing the request races Strict Mode remounts. */
	onOpenDiffRequestHandled?: () => void;
	/** When set (e.g. left sidebar Scheduled), focus/create the scheduled rail tab. */
	openScheduledRequest?: {nonce: number} | null;
	onOpenScheduledRequestHandled?: () => void;
	/** Active Task/session for LivingTask expand-follow. */
	focusSessionId?: string | null;
	onOpenLivingSession?: (sessionId: string, projectId?: string) => void;
	onOpenTeams?: (req: {
		tab?: 'teams' | 'agents' | 'goals';
		goalId?: string;
		teamId?: string;
		agentId?: string;
	}) => void;
	onEditorStatus?: (status: EditorCursorStatus | null) => void;
	gitFiles?: GitFileChange[];
	/** The checkout's agent change review — the Changes tab, the diff tabs and the tree overlay. */
	review: AgentReview;
	/** Document tabs whose buffer has diverged — Keep/Undo must confirm before covering them. */
	onReviewDirtyPaths?: (paths: readonly string[]) => void;
	onRefreshGit?: () => void;
}) {
	const [tabs, setTabs] = useState<RailTab[]>(() => [
		filesTab(),
		createRailTab(layout === 'coding' ? 'changes' : 'context')
	]);
	const [activeId, setActiveId] = useState(FILES_TAB_ID);
	const [menuOpen, setMenuOpen] = useState(false);
	const [lastDocumentPath, setLastDocumentPath] = useState<string | null>(null);
	const [bridgeConnectionId, setBridgeConnectionId] = useState<string | null>(null);
	const [diffRefresh, setDiffRefresh] = useState(0);
	const [conflictRequest, setConflictRequest] = useState<ConflictChoiceRequest | null>(null);
	const [closeDirtyRequest, setCloseDirtyRequest] = useState<CloseDirtyRequest | null>(null);
	const buffersRef = useRef(new Map<string, MonacoEditorHandle>());
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;

	useEffect(() => {
		const paths = tabs.flatMap(tab =>
			tab.kind === 'document' && tab.dirty && tab.filePath ? [tab.filePath] : []
		);
		onReviewDirtyPaths?.(paths);
	}, [tabs, onReviewDirtyPaths]);

	useEffect(() => () => onReviewDirtyPaths?.([]), [onReviewDirtyPaths]);
	const conflictBusy = useRef(false);
	/** While a conflict dialog is open, keep the newest disk snapshot per tab. */
	const conflictPending = useRef(
		new Map<string, {diskContent: string; diskMtime: number; diskBytes?: number}>()
	);

	const chooseConflict = useCallback((path: string): Promise<ConflictChoice> => {
		return new Promise(resolve => {
			setConflictRequest({path, resolve});
		});
	}, []);

	const chooseCloseDirty = useCallback((title: string): Promise<CloseDirtyChoice> => {
		return new Promise(resolve => {
			setCloseDirtyRequest({title, resolve});
		});
	}, []);

	const active = tabs.find(t => t.id === activeId) ?? tabs[0] ?? null;

	useEffect(() => {
		let cancelled = false;
		void window.fastIde.getProject().then(snap => {
			if (!cancelled && snap.bridgeConnectionId) setBridgeConnectionId(snap.bridgeConnectionId);
		});
		return () => {
			cancelled = true;
		};
	}, [project?.id, project?.workspaceId]);

	// Keep-alive (perf doc P2-12): once activated, a pane stays mounted and is
	// hidden with CSS — FilesPane tree state, Browser webviews and Monaco models
	// survive tab switches. Panes mount on first activation only.
	const [everActive, setEverActive] = useState<Set<string>>(() => new Set([FILES_TAB_ID]));
	useEffect(() => {
		const id = active?.id;
		if (!id) return;
		setEverActive(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
	}, [active?.id]);

	useEffect(() => {
		if (active?.kind === 'document' && active.filePath) {
			setLastDocumentPath(active.filePath);
		}
	}, [active?.id, active?.kind, active?.filePath]);

	function addTab(kind: NewTabKind) {
		const sameKind = tabs.filter(t => t.kind === kind).length;
		const tab = createRailTab(kind, sameKind + 1);
		setTabs(prev => [...prev, tab]);
		setActiveId(tab.id);
		setMenuOpen(false);
	}

	async function openFileTab(
		relativePath: string,
		line?: number,
		endLine?: number,
		_forcePlain = false
	) {
		const cleanPath = relativePath.trim().replace(/^@/, '').replace(/^\.\//, '');
		let targetPath = cleanPath;
		if (project?.path && targetPath.startsWith(project.path)) {
			targetPath = targetPath.slice(project.path.length).replace(/^[/\\]+/, '');
		}
		if (!targetPath.includes('/')) {
			const fromGit = gitFiles?.find(g => g.path.endsWith('/' + targetPath) || g.path === targetPath)?.path;
			const fromReview = review?.list?.changes?.find(c => c.path.endsWith('/' + targetPath) || c.path === targetPath)?.path;
			const fromChanges = changes?.find(c => c.path.endsWith('/' + targetPath) || c.path === targetPath)?.path;
			if (fromGit) targetPath = fromGit;
			else if (fromReview) targetPath = fromReview;
			else if (fromChanges) targetPath = fromChanges;
		}
		const targetPos = line ? {line, endLine, nonce: Date.now()} : undefined;

		// Pending agent edits overlay themselves on the document editor. Diff tabs stay a
		// secondary "Full" action from the change cards — opening a file from any entry
		// (tree, transcript, strip) is always the editable buffer.

		// 1. Check if tab already exists in current tabs ref
		const existing = tabsRef.current.find(
			t =>
				t.kind === 'document' &&
				(t.filePath === targetPath ||
					t.filePath === targetPath.replace(/^[/\\]+/, '') ||
					t.filePath?.endsWith(`/${targetPath}`) ||
					basename(t.filePath ?? '') === targetPath)
		);
		if (existing) {
			setEverActive(prev => (prev.has(existing.id) ? prev : new Set(prev).add(existing.id)));
			if (targetPos) {
				setTabs(prev => prev.map(t => (t.id === existing.id ? {...t, targetPosition: targetPos} : t)));
			}
			setActiveId(existing.id);
			if (line) {
				const buf = buffersRef.current.get(existing.id);
				buf?.revealPosition?.(line, 1, endLine);
			}
			return;
		}

		// 2. Fetch file content
		if (typeof window.fastIde.getWorkspaceFile !== 'function') {
			window.alert('getWorkspaceFile API unavailable — restart the desktop app after update');
			return;
		}
		const result = await window.fastIde.getWorkspaceFile(targetPath);
		if (!result.ok) {
			openFileAlert(result);
			return;
		}

		const filePath = result.relativePath ?? targetPath;

		// 3. Check again in case it was opened during the async fetch
		const existingAfterFetch = tabsRef.current.find(
			t => t.kind === 'document' && t.filePath === filePath
		);
		if (existingAfterFetch) {
			setEverActive(prev => (prev.has(existingAfterFetch.id) ? prev : new Set(prev).add(existingAfterFetch.id)));
			if (targetPos) {
				setTabs(prev => prev.map(t => (t.id === existingAfterFetch.id ? {...t, targetPosition: targetPos} : t)));
			}
			setActiveId(existingAfterFetch.id);
			if (line) {
				const buf = buffersRef.current.get(existingAfterFetch.id);
				buf?.revealPosition?.(line, 1, endLine);
			}
			return;
		}

		// 4. Create new tab with deterministic pre-generated ID
		const tabId = newTabId();
		const tab: RailTab = {
			id: tabId,
			kind: 'document',
			title: basename(filePath),
			filePath,
			workspaceId: project?.workspaceId ?? undefined,
			baseContent: result.content,
			savedMtimeMs: result.mtime,
			savedBytes: result.bytes,
			dirty: false,
			editorEpoch: 0,
			targetPosition: targetPos
		};

		setEverActive(prev => (prev.has(tabId) ? prev : new Set(prev).add(tabId)));
		setTabs(prev => [...prev, tab]);
		setActiveId(tabId);
	}

	const patchTabMeta = useCallback((tabId: string, patch: Partial<RailTab>) => {
		setTabs(prev => prev.map(t => (t.id === tabId ? {...t, ...patch} : t)));
	}, []);

	const applyDiskSilent = useCallback(
		(tabId: string, content: string, mtime: number, bytes?: number) => {
			const buf = buffersRef.current.get(tabId);
			if (buf) {
				// In-place reload — keep cursor/undo; avoid Monaco remount storms.
				buf.setValue(content);
				patchTabMeta(tabId, {
					baseContent: content,
					savedMtimeMs: mtime,
					savedBytes: bytes,
					dirty: false
				});
				return;
			}
			patchTabMeta(tabId, {
				baseContent: content,
				savedMtimeMs: mtime,
				savedBytes: bytes,
				dirty: false,
				editorEpoch: (tabsRef.current.find(t => t.id === tabId)?.editorEpoch ?? 0) + 1
			});
		},
		[patchTabMeta]
	);

	const runConflict = useCallback(
		async (tab: RailTab, diskContent: string, diskMtime: number, diskBytes?: number) => {
			if (conflictBusy.current) {
				conflictPending.current.set(tab.id, {diskContent, diskMtime, diskBytes});
				return;
			}
			conflictBusy.current = true;
			try {
				let content = diskContent;
				let mtime = diskMtime;
				let bytes = diskBytes;
				for (;;) {
					const buf = buffersRef.current.get(tab.id);
					const ours = buf?.getValue() ?? tab.baseContent ?? '';
					const liveTab = tabsRef.current.find(t => t.id === tab.id) ?? tab;
					const applied = await resolveConflict({
						tab: liveTab,
						ours,
						diskContent: content,
						diskMtime: mtime,
						diskBytes: bytes,
						choose: chooseConflict
					});
					if (applied) {
						if (applied.buffer != null) buf?.setValue(applied.buffer);
						patchTabMeta(tab.id, applied.patch);
					}
					const pending = conflictPending.current.get(tab.id);
					conflictPending.current.delete(tab.id);
					if (!pending) break;
					// Disk moved again while the dialog was open — re-prompt with the latest.
					content = pending.diskContent;
					mtime = pending.diskMtime;
					bytes = pending.diskBytes;
				}
			} finally {
				conflictBusy.current = false;
			}
		},
		[patchTabMeta, chooseConflict]
	);

	const saveActiveDocument = useCallback(
		async (content: string) => {
			const tab = tabsRef.current.find(t => t.id === activeId);
			if (!tab || tab.kind !== 'document' || !tab.filePath) return;
			const patch = await saveDocument({
				tab,
				content,
				buffer: buffersRef.current.get(tab.id),
				choose: chooseConflict
			});
			if (patch) {
				patchTabMeta(tab.id, patch);
				// Hub learns connectionId from Save echo; only fetch when renderer still lacks it.
				if (!bridgeConnectionId) {
					void window.fastIde.getProject().then(snap => {
						if (snap.bridgeConnectionId) setBridgeConnectionId(snap.bridgeConnectionId);
					});
				}
			}
		},
		[activeId, patchTabMeta, bridgeConnectionId, chooseConflict]
	);

	const markDocumentMissing = useCallback(
		(tabId: string) => {
			patchTabMeta(tabId, missingDocumentPatch());
		},
		[patchTabMeta]
	);

	const refreshDocumentFromDisk = useCallback(
		async (tab: RailTab) => {
			const probe = await probeDisk(tab, buffersRef.current.get(tab.id));
			if (probe.kind === 'silent') {
				applyDiskSilent(tab.id, probe.content, probe.mtime, probe.bytes);
			} else if (probe.kind === 'advance-cursor') {
				patchTabMeta(tab.id, {savedMtimeMs: probe.mtime, savedBytes: probe.bytes});
			} else if (probe.kind === 'conflict') {
				await runConflict(tab, probe.diskContent, probe.diskMtime, probe.diskBytes);
			} else if (probe.kind === 'missing') {
				markDocumentMissing(tab.id);
			}
		},
		[applyDiskSilent, runConflict, markDocumentMissing, patchTabMeta]
	);

	/**
	 * One tab per change, so opening the same file from the strip twice does not stack up.
	 *
	 * `diffTabId` is computed **before** `setTabs`: React 18 queues the updater for the next
	 * render, so reading a `focusId` written inside the updater left `setActiveId` with
	 * `undefined` and the rail stuck on Changes ("click did nothing").
	 */
	function openDiffTab(changeId: string, filePath: string) {
		if (!changeId) return;
		const id = diffTabId(changeId);
		setEverActive(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
		setTabs(prev => openReviewDiff({tabs: prev, activeId: id}, changeId, filePath).tabs);
		setActiveId(id);
	}

	// Track which App nonce we already applied. Do **not** clear App's openDiffRequest on
	// success — Strict Mode remounts wipe rail state while a cleared request cannot re-open.
	const handledDiffNonce = useRef<number | null>(null);
	useLayoutEffect(() => {
		if (!openDiffRequest?.changeId) return;
		if (handledDiffNonce.current === openDiffRequest.nonce) return;
		handledDiffNonce.current = openDiffRequest.nonce;
		openDiffTab(openDiffRequest.changeId, openDiffRequest.path);
	}, [openDiffRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by nonce only

	useEffect(() => {
		if (!openFileRequest?.path) return;
		let cancelled = false;
		void openFileTab(openFileRequest.path, openFileRequest.line, openFileRequest.endLine).finally(() => {
			if (!cancelled) onOpenFileRequestHandled?.();
		});
		return () => {
			cancelled = true;
		};
	}, [openFileRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by nonce only

	useEffect(() => {
		if (!openScheduledRequest) return;
		let cancelled = false;
		let focusId: string | undefined;
		setTabs(prev => {
			const existing = prev.find(t => t.kind === 'scheduled');
			if (existing) {
				focusId = existing.id;
				return prev;
			}
			const tab = createRailTab('scheduled');
			focusId = tab.id;
			return [...prev, tab];
		});
		// Defer clear so React Strict Mode remount still sees the same request.
		queueMicrotask(() => {
			if (cancelled) return;
			if (focusId) setActiveId(focusId);
			onOpenScheduledRequestHandled?.();
		});
		return () => {
			cancelled = true;
		};
	}, [openScheduledRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by nonce only

	async function closeTab(id: string) {
		if (id === FILES_TAB_ID) return;
		const tab = tabsRef.current.find(t => t.id === id);
		if (tab?.kind === 'document' && tab.dirty) {
			const choice = await chooseCloseDirty(railTabTitle(tab));
			if (choice === 'cancel') return;
			if (choice === 'save') {
				if (!tab.filePath) {
					window.alert('Untitled files cannot be saved yet.');
					return;
				}
				const content = buffersRef.current.get(id)?.getValue() ?? tab.baseContent ?? '';
				const patch = await saveDocument({
					tab,
					content,
					buffer: buffersRef.current.get(id),
					choose: chooseConflict
				});
				if (!patch || patch.dirty) return;
			}
		}
		buffersRef.current.delete(id);
		setTabs(prev => {
			const next = prev.filter(t => t.id !== id);
			if (activeId === id) {
				const idx = prev.findIndex(t => t.id === id);
				const fallback = next[Math.max(0, idx - 1)] ?? next[0];
				if (fallback) setActiveId(fallback.id);
			}
			return next;
		});
	}

	// Per-tab patch — with keep-alive, hidden panes must patch themselves, not
	// whatever tab happens to be active (P2-12).
	function patchTab(tabId: string, patch: Partial<RailTab>) {
		setTabs(prev => prev.map(t => (t.id === tabId && !t.pinned ? {...t, ...patch} : t)));
	}

	useEffect(() => {
		if (active?.kind !== 'document') {
			onEditorStatus?.(null);
		}
	}, [active?.id, active?.kind, onEditorStatus]);

	// Tab re-activate: re-Get when a Document becomes active.
	useEffect(() => {
		if (active?.kind !== 'document' || !active.filePath) return;
		void refreshDocumentFromDisk(active);
	}, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by tab id

	// Window focus: same probe for the active Document.
	useEffect(() => {
		const onFocus = () => {
			const tab = tabsRef.current.find(t => t.id === activeId);
			if (tab?.kind === 'document' && tab.filePath) void refreshDocumentFromDisk(tab);
		};
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [activeId, refreshDocumentFromDisk]);

	// Slice 5 — workspace_file_changed decision table.
	useEffect(() => {
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const event = payload.event;
			if (event.type !== 'workspace_file_changed') return;
			if (project?.id && payload.projectId !== project.id) return;
			if (isSelfEcho(event, bridgeConnectionId)) return;

			const rel = event.relativePath.replace(/^[/\\]+/, '');
			for (const tab of tabsRef.current) {
				if (tab.kind === 'diff' && tab.filePath?.replace(/^[/\\]+/, '') === rel) {
					setDiffRefresh(n => n + 1);
				}
				if (tab.kind !== 'document' || tab.filePath?.replace(/^[/\\]+/, '') !== rel) continue;
				// Same decision table as focus/activate — never conflict on event alone.
				void refreshDocumentFromDisk(tab);
			}
		});
		return unsub;
	}, [project?.id, bridgeConnectionId, refreshDocumentFromDisk]);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
			<div className="app-region-drag flex h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-muted/20 px-2 select-none">
				<div className="app-region-no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
					{tabs.map(tab => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveId(tab.id)}
							className={cn(
								'group flex h-7 max-w-[9rem] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-all duration-150',
								tab.id === active?.id
									? 'bg-background text-foreground shadow-2xs border border-border/80 font-medium'
									: 'text-muted-foreground/90 hover:bg-muted/50 hover:text-foreground'
							)}
							title={railTabTitle(tab)}
						>
							<TabKindIcon kind={tab.kind} />
							<span className="min-w-0 truncate tracking-tight">
								{railTabTitle(tab)}
								{tab.kind === 'document' && tab.dirty ? ' •' : ''}
							</span>
							{!tab.pinned ? (
								<span
									role="button"
									tabIndex={0}
									className={cn(
										'rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15 hover:text-foreground active:scale-95 transition-all duration-150',
										tab.id === active?.id && 'opacity-60'
									)}
									aria-label={t('shell.tabs.close', {title: railTabTitle(tab)})}
									onClick={e => {
										e.stopPropagation();
										void closeTab(tab.id);
									}}
									onKeyDown={e => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											e.stopPropagation();
											void closeTab(tab.id);
										}
									}}
								>
									<X className="size-3" />
								</span>
							) : null}
						</button>
					))}
				</div>

				<Popover open={menuOpen} onOpenChange={setMenuOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="app-region-no-drag size-7 shrink-0"
							aria-label={t('shell.tabs.newTab')}
							title={t('shell.tabs.newTab')}
						>
							<Plus className="size-4" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-72 p-0" align="end" sideOffset={6}>
						<Command>
							<CommandInput placeholder={t('shell.tabs.openAny')} />
							<CommandList>
								<CommandEmpty>{t('shell.palette.empty')}</CommandEmpty>
								<CommandGroup>
									{newTabOptions(t).map(option => (
										<CommandItem
											key={option.kind}
											value={`${option.label} ${option.hint}`}
											onSelect={() => addTab(option.kind)}
										>
											<option.icon className="size-4 text-muted-foreground" />
											<span className="flex-1">{option.label}</span>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>

				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="app-region-no-drag size-7 shrink-0"
					aria-label={t('shell.tabs.collapseRight')}
					title={t('shell.tabs.collapseRight')}
					onClick={onCollapse}
				>
					<PanelRight className="size-4" />
				</Button>
			</div>

			<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
				{tabs
					.filter(tab => tab.id === active?.id || everActive.has(tab.id))
					.map(tab => (
						<div
							key={tab.kind === 'files' ? `files:${project?.path ?? 'none'}` : tab.id}
							className={cn(
								'h-full min-h-0 w-full min-w-0 overflow-hidden',
								tab.id === active?.id ? 'block' : 'hidden'
							)}
						>
							<ErrorBoundary label={railTabTitle(tab)}>
								<Suspense
									fallback={
										<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
											{t('shell.common.loading')}
										</div>
									}
								>
									<RailTabBody
										tab={tab}
										changes={changes}
										project={project}
										onPatch={patch => patchTab(tab.id, patch)}
										onOpenFile={path => void openFileTab(path, undefined, undefined, true)}
										onEditorStatus={tab.id === active?.id ? onEditorStatus : undefined}
										activeFilePath={lastDocumentPath}
										gitFiles={gitFiles}
										review={review}
										diffRefresh={diffRefresh}
										onOpenDiff={row => {
											// Same sync-id path as the composer strip — never rely on
											// writing focusId inside a setTabs updater.
											if (row.changeId) openDiffTab(row.changeId, row.path);
										}}
										onRefreshGit={onRefreshGit}
										focusSessionId={focusSessionId}
										onOpenLivingSession={onOpenLivingSession}
										onOpenTeams={onOpenTeams}
										documentActive={tab.id === active?.id}
										onDocumentSave={content => void saveActiveDocument(content)}
										onDocumentBuffer={handle => {
											if (handle) buffersRef.current.set(tab.id, handle);
											else buffersRef.current.delete(tab.id);
										}}
									/>
								</Suspense>
							</ErrorBoundary>
						</div>
					))}
			</div>
			<ConflictChoiceDialog
				request={conflictRequest}
				onSettled={() => setConflictRequest(null)}
			/>
			<CloseDirtyDialog
				request={closeDirtyRequest}
				onSettled={() => setCloseDirtyRequest(null)}
			/>
		</div>
	);
}

function RailTabBody({
	tab,
	changes,
	project,
	onPatch,
	onOpenFile,
	onEditorStatus,
	activeFilePath,
	gitFiles,
	review,
	diffRefresh,
	onOpenDiff,
	onRefreshGit,
	focusSessionId,
	onOpenLivingSession,
	onOpenTeams,
	documentActive,
	onDocumentSave,
	onDocumentBuffer
}: {
	tab: RailTab;
	changes: CodeChange[];
	project: ProjectState | null;
	onPatch: (patch: Partial<RailTab>) => void;
	onOpenFile: (relativePath: string) => void;
	onEditorStatus?: (status: EditorCursorStatus | null) => void;
	activeFilePath?: string | null;
	gitFiles?: GitFileChange[];
	review: AgentReview;
	diffRefresh: number;
	onOpenDiff: (row: ReviewRow) => void;
	onRefreshGit?: () => void;
	focusSessionId?: string | null;
	onOpenLivingSession?: (sessionId: string, projectId?: string) => void;
	onOpenTeams?: (req: {
		tab?: 'teams' | 'agents' | 'goals';
		goalId?: string;
		teamId?: string;
		agentId?: string;
	}) => void;
	documentActive?: boolean;
	onDocumentSave?: (content: string) => void;
	onDocumentBuffer?: (handle: MonacoEditorHandle | null) => void;
}) {
	switch (tab.kind) {
		case 'files':
			return (
				<FilesPane
					project={project}
					onOpenFile={onOpenFile}
					activeFilePath={activeFilePath}
					gitFiles={gitFiles}
					agentReview={review.list}
					onRefreshGit={onRefreshGit}
				/>
			);
		case 'changes':
			return (
				<ChangesPane
					review={review}
					changes={changes}
					projectId={project?.id ?? null}
					onOpenDiff={onOpenDiff}
					onOpenFile={onOpenFile}
				/>
			);
		case 'diff':
			return (
				<ReviewDiffPane
					tab={tab}
					review={review}
					projectId={project?.id ?? null}
					refreshToken={diffRefresh}
				/>
			);
		case 'context':
			return <ContextPane project={project} />;
		case 'browser':
			return <BrowserPane tab={tab} onPatch={onPatch} />;
		case 'document':
			return (
				<DocumentPane
					tab={tab}
					onPatch={onPatch}
					onEditorStatus={onEditorStatus}
					active={documentActive}
					onSave={onDocumentSave}
					bufferRef={onDocumentBuffer}
					review={review}
				/>
			);
		case 'canvas':
			return <CanvasPane />;
		case 'terminal':
			return <TerminalPane title={tab.title} />;
		case 'scheduled':
			return (
				<ScheduledJobsPane
					focusSessionId={focusSessionId}
					onOpenSession={(sessionId, projectId) => {
						if (onOpenLivingSession) onOpenLivingSession(sessionId, projectId);
						else void window.fastIde.selectTask(sessionId);
					}}
					onOpenTeams={onOpenTeams}
				/>
			);
	}
}

/** Memo boundary (perf doc P0-3): re-render only when changes/project/git/callbacks change. */
export const RightWorkbench = memo(RightWorkbenchImpl);
