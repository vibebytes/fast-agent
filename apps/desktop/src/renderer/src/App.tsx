import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type CSSProperties
} from 'react';
import {
	selectTaskOptimistic,
	type WorkspaceStore
} from './workspaceStore';
import {codeChangesKey} from './codeChangesKey';
import {stripItems} from './openSet';
import {
	ensureOpenTask,
	inventoryTaskIds,
	inventoryTaskRows,
	resolveTaskOpenRef,
	tabGroupLabels
} from './openSetFocus';
import {useOpenSetChrome} from './useOpenSetChrome';
import {pullWorkspaceGaps} from './workspaceWire';
import {Button} from '@fast-ide/ui/components/button';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup
} from '@fast-ide/ui/components/resizable';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarSeparator,
	SidebarTrigger
} from '@fast-ide/ui/components/sidebar';
import {TooltipProvider} from '@fast-ide/ui/components/tooltip';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Clock,
	MessageSquarePlus,
	Puzzle,
	Search,
	Users
} from 'lucide-react';
import {useCommandPaletteShortcut} from './commandPaletteShortcut';
import {ErrorBoundary} from './ErrorBoundary';
import {SidebarSystemDirectory} from './SidebarSystemDirectory';
import {RemoteFolderDialog} from './RemoteFolderDialog';
import type {EdgesList} from '@fast-ide/session-view';
import {Settings2, type SettingsSectionId, type SettingsSuite} from './Settings2';
import {RightWorkbench} from './RightWorkbench';
import {ProjectsSidebar} from './ProjectsSidebar';
import {SessionPane} from './session/SessionPane';
import type {OpenTeamsRequest} from './TeamsWorkbench';

// Heavy, low-frequency surfaces load on first use (perf doc P1-9): Teams pulls
// @xyflow/react; the palette pulls sidebar chrome — neither belongs to boot.
const TeamsWorkbench = lazy(() =>
	import('./TeamsWorkbench').then(m => ({default: m.TeamsWorkbench}))
);
const CommandPalette = lazy(() =>
	import('./CommandPalette').then(m => ({default: m.CommandPalette}))
);
import {projectDisplayName} from './sidebarModel';
import {StatusBar} from './StatusBar';
import {publishEditorStatus} from './editorStatusStore';
import {useTranslation} from 'react-i18next';
import {bridgeErrorText} from './bridgeErrorText';
import {ThemePicker} from './ThemePicker';
import {KeepConfirm} from './review/KeepConfirm';
import {ReviewDirtyPaths, useKeepFlow} from './review/useKeepFlow';
import {useAgentReview} from './review/useAgentReview';
import {useGitStatus} from './useGitStatus';
import {useLocalePrefs} from './useLocalePrefs';
import {useThemePrefs} from './useThemePrefs';
import {useApprovalSound} from './useApprovalSound';
import {useCompletionSound} from './useCompletionSound';

type LayoutPreference = 'coding' | 'general';

/** Flip to show again. */
const SHOW_SIDEBAR_PLUGINS = false;
const SHOW_SIDEBAR_TEAMS = false;

/** Resolves after the next frame paints — lets a click ack reach the screen
 * before the heavy focus render blocks the main thread. */
function afterNextPaint(): Promise<void> {
	return new Promise(resolve => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

function samePathList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((p, i) => p === b[i]);
}

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
	try {
		const value = localStorage.getItem(key);
		if (value && (allowed as readonly string[]).includes(value)) return value as T;
	} catch {
		// ignore
	}
	return fallback;
}

function readStoredBool(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		if (value === 'true') return true;
		if (value === 'false') return false;
	} catch {
		// ignore
	}
	return fallback;
}

/** macOS traffic lights + control gap — keep in sync with Electron trafficLightPosition. */
const DARWIN_TRAFFIC_PAD = 'pl-[72px]';

/** Header / inset reserve for lights + SidebarTrigger when the sidebar is fully hidden. */
function toggleReserveClass(): string {
	return window.fastIde.platform === 'darwin' ? 'w-[108px]' : 'w-10';
}

/**
 * Window-fixed sidebar toggle (Claude / Cursor style).
 * Must sit above a no-drag hole — Electron drag regions steal clicks regardless of z-index.
 */
function WindowSidebarToggle() {
	const isDarwin = window.fastIde.platform === 'darwin';
	return (
		<div
			className={cn(
				'fixed top-0 left-0 z-[100] flex h-10 items-center',
				isDarwin ? DARWIN_TRAFFIC_PAD : 'pl-2'
			)}
			style={{WebkitAppRegion: 'no-drag'} as CSSProperties}
		>
			<SidebarTrigger className="app-region-no-drag size-7 shrink-0" />
		</div>
	);
}

function useTaskCodeChanges(store: WorkspaceStore, taskId: string | null) {
	const subscribe = useCallback(
		(listener: () => void) => store.subscribeTranscript(taskId, listener),
		[store, taskId]
	);
	const getSnapshot = useCallback(() => store.getTranscript(taskId).codeChanges, [store, taskId]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function App({store}: {store: WorkspaceStore}) {
	// 刀 8: content-only transcript frames do not invalidate the application
	// chrome tree (sidebar, right workbench, status bar).
	const workspace = useSyncExternalStore(
		store.subscribeChrome,
		store.getChromeSnapshot,
		store.getChromeSnapshot
	);

	const projects = workspace.projects;
	const projectTasks = workspace.projectTasks;
	const projectTasksHydrated = workspace.projectTasksHydrated;
	const project = workspace.project;
	const tasks = workspace.tasks;
	const chats = workspace.chats;
	const defaultTasks = workspace.defaultTasks;
	const defaultTasksHydrated = workspace.defaultTasksHydrated;
	const activeTaskId = workspace.activeTaskId;
	const activeCodeChanges = useTaskCodeChanges(store, activeTaskId);
	const gate = workspace.gate;
	const queue = workspace.queue;
	const queuePaused = workspace.queuePaused;
	const dshCaps = workspace.dshCaps;
	const dshQueue = workspace.dshQueue;
	const dshGoal = workspace.dshGoal;
	const model = workspace.model;
	const modelDisplay = workspace.modelDisplay;
	const modelCatalog = workspace.modelCatalog;
	const runMode = workspace.runMode;
	const engineKind = workspace.engineKind;
	const availableEngineIds = workspace.availableEngineIds;
	const effort = workspace.effort;
	const thinking = workspace.thinking;
	const slashCatalog = workspace.slashCatalog;
	const slashCatalogHydrated = workspace.slashCatalogHydrated;
	const engineStatus = workspace.engineStatus;
	const engineError = workspace.engineError;
	const bridgeError = workspace.bridgeError;

	const [layout, setLayout] = useState<LayoutPreference>(() =>
		readStored('fast-ide.layout', 'coding', ['coding', 'general'] as const)
	);
	const [rightRailOpen, setRightRailOpen] = useState(() =>
		readStoredBool('fast-ide.right-rail', true)
	);
	const {paletteId, setPaletteId} = useThemePrefs();
	const {localePref, setLocalePref} = useLocalePrefs();
	const {t} = useTranslation();
	const [openFileRequest, setOpenFileRequest] = useState<{
		path: string;
		line?: number;
		endLine?: number;
		nonce: number;
	} | null>(null);
	const [openDiffRequest, setOpenDiffRequest] = useState<{
		changeId: string;
		path: string;
		nonce: number;
	} | null>(null);
	const [openScheduledRequest, setOpenScheduledRequest] = useState<{nonce: number} | null>(null);
	const [centerMode, setCenterMode] = useState<'task' | 'teams'>('task');
	const [settings2Open, setSettings2Open] = useState(false);
	const [settings2Section, setSettings2Section] = useState<SettingsSectionId>('general');
	const [settings2Suite, setSettings2Suite] = useState<SettingsSuite>('fast');

	useEffect(() => {
		const onOpenSettings = (e: Event) => {
			const customEvent = e as CustomEvent<{section?: SettingsSectionId; suite?: SettingsSuite}>;
			if (customEvent.detail?.section) {
				setSettings2Section(customEvent.detail.section);
			}
			setSettings2Suite(customEvent.detail?.suite ?? engineKind);
			setSettings2Open(true);
		};
		window.addEventListener('fast-ide:open-settings', onOpenSettings);
		return () => window.removeEventListener('fast-ide:open-settings', onOpenSettings);
	}, [engineKind]);
	const [openTeamsRequest, setOpenTeamsRequest] = useState<OpenTeamsRequest | null>(null);
	const [pendingMentionInsert, setPendingMentionInsert] = useState<{
		ref: string;
		label: string;
		description: string;
		kind: string;
		locator: string;
		entity?: string;
	} | null>(null);
	const [pendingSlashInsert, setPendingSlashInsert] = useState<{
		name: string;
		label: string;
		description: string;
		kind: 'command' | 'skill';
	} | null>(null);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [edges, setEdges] = useState<EdgesList | null>(null);
	const [remoteFolderOpen, setRemoteFolderOpen] = useState(false);
	useCommandPaletteShortcut(
		useCallback(() => setCommandPaletteOpen(true), [])
	);
	useEffect(() => {
		void window.fastIde.listEdges().then(setEdges);
		const off = window.fastIde.onEdgesChanged(setEdges);
		const onRemote = () => setRemoteFolderOpen(true);
		window.addEventListener('fast-ide:open-remote-folder', onRemote);
		return () => {
			off();
			window.removeEventListener('fast-ide:open-remote-folder', onRemote);
		};
	}, []);

	// Keyed on the list slices (stable across transcript tail patches) — not on
	// the whole workspace object, which changes identity every dispatch (P0-3).
	const inventoryRows = useMemo(
		() => inventoryTaskRows({projectTasks, defaultTasks, chats, tasks}),
		[projectTasks, defaultTasks, chats, tasks]
	);
	const inventoryIds = useMemo(
		() => inventoryTaskIds({projectTasks, defaultTasks, chats, tasks}),
		[projectTasks, defaultTasks, chats, tasks]
	);
	const openRefSource = useMemo(
		() => ({projectTasks, defaultTasks, chats, tasks, activeProjectId: workspace.activeProjectId}),
		[projectTasks, defaultTasks, chats, tasks, workspace.activeProjectId]
	);
	/** Register accepted → workspaceId appears → Open Tab Bind reconcile must re-run. */
	const slotReadyKey = useMemo(
		() =>
			projects
				.map(p => (p.workspaceId ? `${p.id}:${p.workspaceId}` : ''))
				.filter(Boolean)
				.sort()
				.join('|'),
		[projects]
	);

	// Open Tab chrome lifecycle lives in its own hook (P2-14).
	const {
		openSet,
		openSetRef,
		commitOpenSet,
		dropOpenTabs,
		closeOpenTabChrome,
		toggleTabGroup
	} = useOpenSetChrome({
		store,
		inventoryIds,
		inventoryRows,
		openRefSource,
		activeTaskId,
		projectsFromPush: workspace.projectsFromPush,
		defaultTasksHydrated,
		engineStatus,
		slotReadyKey
	});

	// 点击即亮: optimistic selection highlight (sidebar rows + tab strip). Only
	// this cheap state commits in the click frame; the heavy pane switch
	// (openSet.activeTabId drives SessionPane) and focus follow one frame later.
	const [pressedTaskId, setPressedTaskId] = useState<string | null>(null);
	if (pressedTaskId !== null && pressedTaskId === activeTaskId) {
		// Store focus caught up — render-phase clear, no extra commit.
		setPressedTaskId(null);
	}
	useEffect(() => {
		if (pressedTaskId === null) return;
		// Failed/rolled-back select never catches up — drop the highlight.
		const timer = window.setTimeout(() => setPressedTaskId(null), 2000);
		return () => window.clearTimeout(timer);
	}, [pressedTaskId]);

	const openTaskWithTab = useCallback(
		async (taskId: string) => {
			// Leaving Teams center must happen before focus — otherwise sidebar
			// selection updates while the middle pane stays on TeamsWorkbench.
			setCenterMode('task');
			setOpenTeamsRequest(null);
			const prev = openSetRef.current;
			const ref = resolveTaskOpenRef(store.getState(), taskId);
			const localId = ref?.id ?? taskId;
			setPressedTaskId(localId);
			// Click-ack decoupling: the pressed highlight paints this frame; the
			// openSet flip (= SessionPane pane switch) and select start next frame.
			await afterNextPaint();
			if (ref) commitOpenSet(ensureOpenTask(prev, ref));
			const ok = await selectTaskOptimistic(store, localId);
			if (!ok) {
				commitOpenSet(prev);
				setPressedTaskId(null);
			}
		},
		[store, commitOpenSet, openSetRef]
	);

	const activateOpenTab = useCallback(
		(tabId: string) => {
			void openTaskWithTab(tabId);
		},
		[openTaskWithTab]
	);

	const openTabItems = useMemo(() => stripItems(openSet), [openSet]);
	const groupLabels = useMemo(() => {
		const keys = new Set(openSet.tabs.map(t => t.groupKey));
		return tabGroupLabels(keys, projects);
	}, [openSet.tabs, projects]);

	const taskRunStates = useMemo(() => {
		const map: Record<string, 'running' | 'completed-unseen'> = {};
		for (const t of tasks) if (t.runState) map[t.id] = t.runState;
		for (const t of defaultTasks) if (t.runState) map[t.id] = t.runState;
		for (const [, list] of Object.entries(projectTasks)) {
			for (const t of list) if (t.runState) map[t.id] = t.runState;
		}
		return map;
	}, [tasks, defaultTasks, projectTasks]);

	useEffect(() => {
		pullWorkspaceGaps(store);
	}, [store]);

	// Git chrome (P2-14 hook; trigger fingerprint per P0-5).
	const codeChangesRefreshKey = codeChangesKey(activeCodeChanges);
	const {gitStatus, refreshGitForce} = useGitStatus(
		project?.path ?? null,
		codeChangesRefreshKey
	);
	// Agent change review is per checkout, not per Task: two conversations in one folder decide on the
	// same list, and the daemon addresses it by checkout too. The list is scoped to the focused session
	// so the drawer only shows the edits this conversation made.
	const focusSessionId = useMemo(
		() =>
			(
				tasks.find(t => t.id === activeTaskId) ??
				chats.find(t => t.id === activeTaskId) ??
				defaultTasks.find(t => t.id === activeTaskId) ??
				Object.values(projectTasks)
					.flat()
					.find(t => t.id === activeTaskId)
			)?.sessionId ?? null,
		[tasks, chats, defaultTasks, projectTasks, activeTaskId]
	);
	const review = useAgentReview(project?.id ?? null, focusSessionId);
	const [dirtyPaths, setDirtyPaths] = useState<readonly string[]>([]);
	const onReviewDirtyPaths = useCallback((paths: readonly string[]) => {
		setDirtyPaths(prev => (samePathList(prev, paths) ? prev : [...paths]));
	}, []);
	const keepFlow = useKeepFlow(review, dirtyPaths);
	const reviewUi = useMemo(() => ({...review, keep: keepFlow.keep}), [review, keepFlow.keep]);

	useEffect(() => {
		localStorage.setItem('fast-ide.layout', layout);
	}, [layout]);

	useEffect(() => {
		localStorage.setItem('fast-ide.right-rail', String(rightRailOpen));
	}, [rightRailOpen]);

	const paneTaskId = openSet.activeTabId;
	const activeEntry =
		(paneTaskId
			? tasks.find(t => t.id === paneTaskId) ??
				chats.find(t => t.id === paneTaskId) ??
				defaultTasks.find(t => t.id === paneTaskId) ??
				null
			: null) ??
		null;
	const canChat = project?.status === 'ready' && Boolean(activeEntry) && Boolean(paneTaskId);
	const engineReady = engineStatus === 'ready' || project?.status === 'ready';
	useCompletionSound(engineReady);
	useApprovalSound(store, engineReady);
	const readyProject =
		projects.find(p => p.active && p.status === 'ready') ??
		projects.find(p => p.status === 'ready') ??
		null;
	const canCreateProjectTask = engineReady || Boolean(readyProject);

	const createNewTask = useCallback(async () => {
		// Top New task always targets the hidden Default Project.
		setCenterMode('task');
		setOpenTeamsRequest(null);
		await window.fastIde.createTask('New task');
	}, []);
	const createNewTaskVoid = useCallback(() => {
		void createNewTask();
	}, [createNewTask]);

	const onOpenFile = useCallback((path: string, line?: number, endLine?: number) => {
		const trimmed = path.trim();
		if (!trimmed) return;
		setRightRailOpen(true);
		setOpenFileRequest({path: trimmed, line, endLine, nonce: Date.now()});
	}, []);

	// Stable identities for memo'd shell children (P0-3) — inline closures would
	// break their React.memo on every streaming frame.
	const openTeams = useCallback(
		(req: {tab?: 'teams' | 'agents' | 'goals'; goalId?: string; teamId?: string; agentId?: string}) => {
			setCenterMode('teams');
			setOpenTeamsRequest({nonce: Date.now(), ...req});
		},
		[]
	);
	const collapseRightRail = useCallback(() => setRightRailOpen(false), []);
	const expandRightRail = useCallback(() => setRightRailOpen(true), []);
	const onOpenReviewDiff = useCallback((changeId: string, path: string) => {
		setRightRailOpen(true);
		setOpenDiffRequest({changeId, path, nonce: Date.now()});
	}, []);
	const clearOpenFileRequest = useCallback(() => setOpenFileRequest(null), []);
	const clearOpenDiffRequest = useCallback(() => setOpenDiffRequest(null), []);
	const clearOpenScheduledRequest = useCallback(() => setOpenScheduledRequest(null), []);
	const clearPendingMention = useCallback(() => setPendingMentionInsert(null), []);
	const clearPendingSlash = useCallback(() => setPendingSlashInsert(null), []);
	const retryEngine = useCallback(() => void window.fastIde.retryEngine(), []);
	const openLivingSession = useCallback(
		(sessionId: string, metaProjectId?: string) => {
			void (async () => {
				const r = await window.fastIde.openLivingSession(sessionId, metaProjectId);
				if (!r.ok) {
					console.error('openLivingSession failed', r.notice);
					store.dispatch({
						type: 'bridge:error',
						payload: {
							projectId: store.getState().project?.id ?? '',
							message: r.notice || t('shell.app.openLivingFailed')
						}
					});
					return;
				}
				await openTaskWithTab(r.taskId);
			})();
		},
		[store, openTaskWithTab]
	);
	const statusGit = useMemo(
		() => (gitStatus ? {branch: gitStatus.branch, dirty: gitStatus.dirty} : null),
		[gitStatus]
	);

	const engineBlocked =
		engineStatus === 'reconnecting' ||
		engineStatus === 'exited' ||
		engineStatus === 'error';

	return (
		<ReviewDirtyPaths.Provider value={dirtyPaths}>
		<TooltipProvider>
			{settings2Open ? (
				<Settings2
					paletteId={paletteId}
					onPaletteChange={setPaletteId}
					localePref={localePref}
					onLocaleChange={setLocalePref}
					layout={layout}
					onLayoutChange={setLayout}
					onBack={() => setSettings2Open(false)}
					engineReady={engineReady}
					engineStatus={engineStatus}
					modelCatalog={modelCatalog}
					initialSection={settings2Section}
					initialSuite={settings2Suite}
					sessionId={focusSessionId ?? undefined}
				/>
			) : null}
			<div className={cn('relative flex h-svh min-h-0 w-full flex-col overflow-hidden', settings2Open && 'hidden')}>
			{engineBlocked ? (
				<div
					className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
					role="alertdialog"
					aria-modal="true"
					aria-label={
						engineStatus === 'reconnecting'
							? 'Engine reconnecting'
							: 'Engine Error'
					}
				>
					<div className="app-region-no-drag flex flex-col items-center gap-3 px-6 text-center">
						<p className="text-sm font-medium text-foreground">
							{engineStatus === 'reconnecting'
								? 'Reconnecting to engine…'
								: 'Engine Error'}
						</p>
						{engineError ? (
							<p className="max-w-sm text-xs text-muted-foreground">{engineError}</p>
						) : null}
						{engineStatus === 'error' || engineStatus === 'exited' ? (
							<Button
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => void window.fastIde.retryEngine()}
							>
								Retry
							</Button>
						) : null}
					</div>
				</div>
			) : null}
			<SidebarProvider className="relative flex min-h-0 w-full flex-1 overflow-hidden">
				<WindowSidebarToggle />
				<Sidebar collapsible="offcanvas">
					<SidebarHeader className="gap-2 p-0">
						<div className="flex h-10 items-stretch border-b">
							{/* No-drag hole under the fixed toggle — drag regions steal Electron clicks. */}
							<div className={cn('app-region-no-drag shrink-0', toggleReserveClass())} aria-hidden />
							<div className="app-region-drag flex min-w-0 flex-1 items-center gap-1 pr-1">
								<span className="app-region-no-drag min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
									Fast
								</span>
								<Button
						type="button"
									variant="ghost"
									size="icon-sm"
									className="app-region-no-drag shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden"
									onClick={() => setCommandPaletteOpen(true)}
									aria-label={t('shell.sidebar.searchCommands')}
									title={t('shell.sidebar.searchCommands')}
								>
									<Search />
								</Button>
							</div>
						</div>
						<div className="px-2 pt-1">
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									disabled={!canCreateProjectTask}
									onClick={() => void createNewTask()}
									tooltip={t('shell.sidebar.newTask')}
									className="text-sidebar-foreground"
								>
									<MessageSquarePlus />
									<span>{t('shell.sidebar.newTask')}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							{SHOW_SIDEBAR_PLUGINS ? (
								<SidebarMenuItem>
									<SidebarMenuButton
										disabled
										tooltip={t('settings.navigation.plugins')}
										className="text-sidebar-foreground disabled:opacity-100"
									>
										<Puzzle />
										<span>{t('settings.navigation.plugins')}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							) : null}
							{SHOW_SIDEBAR_TEAMS ? (
								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip="Teams"
										className="text-sidebar-foreground"
										onClick={() => {
											setCenterMode('teams');
											setOpenTeamsRequest({nonce: Date.now(), tab: 'teams'});
										}}
									>
										<Users />
										<span>Teams</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							) : null}
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip={t('shell.sidebar.scheduled')}
									className="text-sidebar-foreground"
									onClick={() => {
										setRightRailOpen(true);
										setOpenScheduledRequest({nonce: Date.now()});
									}}
								>
									<Clock />
									<span>{t('shell.sidebar.scheduled')}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
				</div>
					</SidebarHeader>

					<SidebarContent>
						<ErrorBoundary label={t('shell.boundary.projects')}>
							<ProjectsSidebar
								projects={projects}
								projectTasks={projectTasks}
								projectTasksHydrated={projectTasksHydrated}
								defaultTasks={defaultTasks}
								defaultTasksHydrated={defaultTasksHydrated}
								activeTaskId={pressedTaskId ?? activeTaskId}
								engineReady={engineReady}
								onCreateDefaultTask={createNewTaskVoid}
								onOpenTask={openTaskWithTab}
								onDropOpenTabs={dropOpenTabs}
							/>
						</ErrorBoundary>
					</SidebarContent>

					<SidebarFooter className="gap-0 p-0 group-data-[collapsible=icon]:hidden">
						<SidebarSeparator className="mx-0" />
						<SidebarSystemDirectory
							displayName="Local User"
							edges={edges}
							localePref={localePref}
							onLocaleChange={setLocalePref}
							onOpenSettings2={() => setSettings2Open(true)}
							themeContent={
								<ThemePicker
									variant="sidebar"
									paletteId={paletteId}
									onPaletteChange={setPaletteId}
								/>
							}
						/>
					</SidebarFooter>
				</Sidebar>

				<SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<ResizablePanelGroup
						orientation="horizontal"
						className="min-h-0 flex-1"
					>
						<ResizablePanel
							id="chat"
							defaultSize={rightRailOpen ? '70' : '100'}
							minSize="35"
							className="min-w-0 overflow-hidden"
						>
						{centerMode === 'teams' ? (
							<ErrorBoundary label={t('shell.boundary.teams')}>
							<Suspense
								fallback={
									<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
										{t('shell.app.loadingTeams')}
									</div>
								}
							>
							<TeamsWorkbench
								openRequest={openTeamsRequest}
								focusProjectId={project?.id ?? null}
								onOpenLivingSession={(sessionId, metaProjectId) => {
									setCenterMode('task');
									setOpenTeamsRequest(null);
									void (async () => {
										const r = await window.fastIde.openLivingSession(
											sessionId,
											metaProjectId
										);
										if (!r.ok) {
											console.error('openLivingSession failed', r.notice);
											store.dispatch({
												type: 'bridge:error',
												payload: {
													projectId: project?.id ?? '',
													message: r.notice || t('shell.app.openLivingFailed')
												}
											});
											return;
										}
										await openTaskWithTab(r.taskId);
									})();
								}}
								onInsertMention={async (kind, locator, displayName, metaProjectId) => {
									const label = displayName?.trim() || locator;
									const ref = `@${kind}/${locator}`;
									setCenterMode('task');
									setOpenTeamsRequest(null);
									const title =
										kind === 'team'
											? t('shell.app.scheduleTitle', {label})
											: kind === 'agent'
												? t('shell.app.scheduleTitle', {label})
												: kind === 'goal'
													? t('shell.app.scheduleTitle', {label})
													: t('shell.app.newTask');
									// Prefer Team/Goal/Agent owning Meta project so Mentions ListTeams hits the same workspace.
									const task = await window.fastIde.createTask(
										title,
										metaProjectId?.trim() || undefined
									);
									if (!task?.id) {
										store.dispatch({
											type: 'bridge:error',
											payload: {
												projectId: project?.id ?? '',
												message:
													metaProjectId?.trim()
														? t('shell.app.cannotCreateInTeamProject')
														: t('shell.app.cannotCreateChat')
											}
										});
										return;
									}
									await openTaskWithTab(task.id);
									// Defer until SessionPane/Composer mount for the new task.
									requestAnimationFrame(() => {
										setPendingMentionInsert({
											ref,
											label,
											description: ref,
											kind,
											locator,
											...(kind === 'team' ? {entity: 'team'} : {})
										});
									});
								}}
								onCreateWithSlash={async name => {
									const n = name === 'agent' ? 'agent' : 'team';
									setCenterMode('task');
									setOpenTeamsRequest(null);
									const title = n === 'team' ? t('shell.app.newTeam') : t('shell.app.newAgent');
									const task = await window.fastIde.createTask(title);
									if (task?.id) await openTaskWithTab(task.id);
									// Defer until SessionPane/Composer mount for the new task.
									requestAnimationFrame(() => {
										setPendingSlashInsert({
											name: n,
											label: n,
											description:
												n === 'team' ? 'Create a Team' : 'Create an Agent',
											kind: 'skill'
										});
									});
								}}
								onOpenScheduled={() => {
									setRightRailOpen(true);
									setOpenScheduledRequest({nonce: Date.now()});
								}}
							/>
							</Suspense>
							</ErrorBoundary>
						) : (
						<ErrorBoundary label={t('shell.boundary.session')}>
						<SessionPane
							store={store}
							gate={paneTaskId ? gate : {
								runState: 'idle',
								canSubmitNow: false,
								canEnqueue: false,
								canCancel: false,
								composerLocked: false,
								lockReason: null
							}}
							queue={paneTaskId ? queue : []}
							queuePaused={paneTaskId ? queuePaused : false}
							dshCaps={paneTaskId ? dshCaps : undefined}
							dshQueue={paneTaskId ? dshQueue : []}
							dshGoal={paneTaskId ? dshGoal : null}
							model={model}
							modelDisplay={modelDisplay}
							modelCatalog={modelCatalog}
							runMode={runMode}
							engineKind={engineKind}
							availableEngineIds={availableEngineIds}
							effort={effort}
							thinking={thinking}
							slashCatalog={slashCatalog}
							slashCatalogHydrated={slashCatalogHydrated}
							activeTaskId={paneTaskId}
							pressedTabId={pressedTaskId}
							canChat={canChat}
							hasProject={Boolean(project)}
							projectReady={project?.status === 'ready'}
							hasActiveTask={Boolean(paneTaskId)}
							projectError={
								project?.error ??
								// Rerun rejections are conversation-scoped: SessionPane's sticky
								// regen banner owns them; the global chrome must not repeat them.
								(bridgeError && !bridgeError.code?.startsWith('rerun.')
									? bridgeErrorText(bridgeError, t) || null
									: null)
							}
							openTabItems={openTabItems}
							taskRunStates={taskRunStates}
							groupLabels={groupLabels}
							rightRailOpen={rightRailOpen}
							onActivateOpenTab={activateOpenTab}
							onCloseOpenTab={closeOpenTabChrome}
							onToggleTabGroup={toggleTabGroup}
							onExpandRightRail={expandRightRail}
							onOpenFile={onOpenFile}
							pendingMentionInsert={pendingMentionInsert}
							onPendingMentionConsumed={clearPendingMention}
							pendingSlashInsert={pendingSlashInsert}
							onPendingSlashConsumed={clearPendingSlash}
							onOpenTeams={openTeams}
							review={reviewUi}
							onOpenReviewDiff={onOpenReviewDiff}
						/>
						</ErrorBoundary>
						)}
						</ResizablePanel>

						{rightRailOpen ? (
							<>
								<ResizableHandle className="w-px bg-border" />
								<ResizablePanel
									id="right-rail"
									defaultSize="30"
									minSize="18"
									maxSize="55"
									className="min-w-[240px]"
								>
									<ErrorBoundary label={t('shell.boundary.rightPanel')}>
										<RightWorkbench
											changes={activeCodeChanges}
											project={project}
											layout={layout}
											onCollapse={collapseRightRail}
											openFileRequest={openFileRequest}
											onOpenFileRequestHandled={clearOpenFileRequest}
											openDiffRequest={openDiffRequest}
											onOpenDiffRequestHandled={clearOpenDiffRequest}
											openScheduledRequest={openScheduledRequest}
											onOpenScheduledRequestHandled={clearOpenScheduledRequest}
											focusSessionId={focusSessionId}
											onOpenLivingSession={openLivingSession}
											onOpenTeams={openTeams}
											onEditorStatus={publishEditorStatus}
											gitFiles={gitStatus?.files}
											review={reviewUi}
											onReviewDirtyPaths={onReviewDirtyPaths}
											onRefreshGit={refreshGitForce}
										/>
									</ErrorBoundary>
								</ResizablePanel>
							</>
						) : null}
					</ResizablePanelGroup>
				</SidebarInset>
			</SidebarProvider>
			<RemoteFolderDialog open={remoteFolderOpen} onOpenChange={setRemoteFolderOpen} />
			{commandPaletteOpen ? (
				<Suspense fallback={null}>
					<CommandPalette
						open={commandPaletteOpen}
						onOpenChange={setCommandPaletteOpen}
						projects={projects}
						projectTasks={projectTasks}
						chats={chats}
						activeTaskId={activeTaskId}
						onOpenTask={openTaskWithTab}
						onDropOpenTabs={dropOpenTabs}
						onOpenTeams={openTeams}
					/>
				</Suspense>
			) : null}
			<StatusBar
				projectName={project ? projectDisplayName(project) : null}
				engineStatus={engineStatus ?? project?.status ?? null}
				engineError={engineError ?? project?.error ?? null}
				git={statusGit}
				modelDisplay={modelDisplay || null}
				edges={edges}
				runState={gate.runState}
				editorVisible={rightRailOpen}
				onRetryEngine={retryEngine}
			/>
			{keepFlow.pending ? (
				<KeepConfirm
					paths={keepFlow.pending}
					busy={review.busy}
					onCancel={keepFlow.cancel}
					onConfirm={keepFlow.confirm}
				/>
			) : null}
			</div>
		</TooltipProvider>
		</ReviewDirtyPaths.Provider>
	);
}
