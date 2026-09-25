import type {LocalePref} from '@fast-ide/i18n';
import type {EdgesList, EngineHostStatus, ModelCatalogEntry} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
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
	SidebarTrigger
} from '@fast-ide/ui/components/sidebar';
import {TooltipProvider} from '@fast-ide/ui/components/tooltip';
import {cn} from '@fast-ide/ui/lib/utils';
import {Clock, MessageSquarePlus, Puzzle, Search, Users} from 'lucide-react';
import {lazy, Suspense, type CSSProperties, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import type {CommandPaletteProps} from '../CommandPalette';
import {ErrorBoundary} from '../ErrorBoundary';
import type {ProjectSnapshot, TaskSummary} from '../env';
import {ProjectsSidebar, type ProjectTasksMap} from '../ProjectsSidebar';
import {RemoteFolderDialog} from '../RemoteFolderDialog';
import {KeepConfirm} from '../review/KeepConfirm';
import {ReviewDirtyPaths} from '../review/useKeepFlow';
import {
	Settings2,
	type LayoutPreference,
	type SettingsSectionId,
	type SettingsSuite
} from '../Settings2';
import {SidebarSystemDirectory} from '../SidebarSystemDirectory';
import {StatusBar, type EngineStatusKind, type StatusBarGit} from '../StatusBar';
import {ThemePicker} from '../ThemePicker';

const CommandPalette = lazy(() =>
	import('../CommandPalette').then(m => ({default: m.CommandPalette}))
);

/** Flip to show again. */
const SHOW_SIDEBAR_PLUGINS = false;
const SHOW_SIDEBAR_TEAMS = false;

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

export type AppSidebarProps = {
	canCreateProjectTask: boolean;
	onNewTask: () => void;
	onOpenPalette: () => void;
	scheduledOpen: boolean;
	onOpenScheduled: () => void;
	onOpenTeams: () => void;
	projects: ProjectSnapshot[];
	projectTasks: ProjectTasksMap;
	projectTasksHydrated: Record<string, boolean>;
	defaultTasks: TaskSummary[];
	defaultTasksHydrated: boolean;
	activeTaskId: string | null;
	engineReady: boolean;
	onCreateDefaultTask: () => void;
	onOpenTask: (taskId: string) => Promise<void>;
	onDropOpenTabs: (taskIds: string[]) => void;
	edges: EdgesList | null;
	localePref: LocalePref;
	onLocaleChange: (pref: LocalePref) => void;
	onOpenSettings2: () => void;
	onOpenAdmin: () => void;
	paletteId: string;
	onPaletteChange: (id: string) => void;
};

function AppSidebar({
	canCreateProjectTask,
	onNewTask,
	onOpenPalette,
	scheduledOpen,
	onOpenScheduled,
	onOpenTeams,
	projects,
	projectTasks,
	projectTasksHydrated,
	defaultTasks,
	defaultTasksHydrated,
	activeTaskId,
	engineReady,
	onCreateDefaultTask,
	onOpenTask,
	onDropOpenTabs,
	edges,
	localePref,
	onLocaleChange,
	onOpenSettings2,
	onOpenAdmin,
	paletteId,
	onPaletteChange
}: AppSidebarProps) {
	const {t} = useTranslation();
	return (
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
							onClick={onOpenPalette}
							aria-label={t('shell.sidebar.searchCommands')}
							title={t('shell.sidebar.searchCommands')}
						>
							<Search />
						</Button>
					</div>
				</div>
				<div className="px-2 pt-2 pb-1">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							disabled={!canCreateProjectTask}
							onClick={onNewTask}
							tooltip={t('shell.sidebar.newTask')}
							className="text-sidebar-foreground"
						>
							<MessageSquarePlus />
							<span>{t('shell.sidebar.newTask')}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							isActive={scheduledOpen}
							tooltip={t('shell.sidebar.scheduled')}
							className="text-sidebar-foreground"
							onClick={onOpenScheduled}
						>
							<Clock />
							<span>{t('shell.sidebar.scheduled')}</span>
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
								onClick={onOpenTeams}
							>
								<Users />
								<span>Teams</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					) : null}
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
						activeTaskId={activeTaskId}
						engineReady={engineReady}
						onCreateDefaultTask={onCreateDefaultTask}
						onOpenTask={onOpenTask}
						onDropOpenTabs={onDropOpenTabs}
					/>
				</ErrorBoundary>
			</SidebarContent>

			<SidebarFooter className="gap-0 p-2 group-data-[collapsible=icon]:hidden">
				<SidebarSystemDirectory
					displayName="Local User"
					edges={edges}
					localePref={localePref}
					onLocaleChange={onLocaleChange}
					onOpenSettings2={onOpenSettings2}
					onOpenAdmin={onOpenAdmin}
					themeContent={
						<ThemePicker
							variant="sidebar"
							paletteId={paletteId}
							onPaletteChange={onPaletteChange}
						/>
					}
				/>
			</SidebarFooter>
		</Sidebar>
	);
}

export type AppChromeSettings = {
	paletteId: string;
	onPaletteChange: (id: string) => void;
	localePref: LocalePref;
	onLocaleChange: (pref: LocalePref) => void;
	layout: LayoutPreference;
	onLayoutChange: (layout: LayoutPreference) => void;
	onBack: () => void;
	engineReady: boolean;
	engineStatus?: EngineHostStatus | null;
	modelCatalog: ModelCatalogEntry[];
	initialSection: SettingsSectionId;
	initialSuite: SettingsSuite;
	sessionId?: string;
};

export type AppChromeStatus = {
	projectName: string | null;
	engineStatus: EngineStatusKind;
	engineError: string | null;
	git: StatusBarGit;
	modelDisplay: string | null;
	edges: EdgesList | null;
	runState: 'idle' | 'running' | 'stopping';
	editorVisible: boolean;
	onRetryEngine: () => void;
};

export type AppChromeKeep = {
	paths: readonly string[];
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
};

export function AppChrome({
	dirtyPaths,
	settingsOpen,
	settings,
	sidebar,
	overlay,
	children,
	remoteFolderOpen,
	onRemoteFolderOpenChange,
	palette,
	status,
	keep
}: {
	dirtyPaths: readonly string[];
	settingsOpen: boolean;
	settings: AppChromeSettings;
	sidebar: AppSidebarProps;
	overlay: {
		visible: boolean;
		showRetry: boolean;
		engineStatus: EngineHostStatus | null | undefined;
		engineError: string | null | undefined;
		onRetry: () => void;
	};
	children: ReactNode;
	remoteFolderOpen: boolean;
	onRemoteFolderOpenChange: (open: boolean) => void;
	palette: CommandPaletteProps | null;
	status: AppChromeStatus;
	keep: AppChromeKeep | null;
}) {
	return (
		<ReviewDirtyPaths.Provider value={dirtyPaths}>
		<TooltipProvider>
			{settingsOpen ? (
				<Settings2
					paletteId={settings.paletteId}
					onPaletteChange={settings.onPaletteChange}
					localePref={settings.localePref}
					onLocaleChange={settings.onLocaleChange}
					layout={settings.layout}
					onLayoutChange={settings.onLayoutChange}
					onBack={settings.onBack}
					engineReady={settings.engineReady}
					engineStatus={settings.engineStatus}
					modelCatalog={settings.modelCatalog}
					initialSection={settings.initialSection}
					initialSuite={settings.initialSuite}
					sessionId={settings.sessionId}
				/>
			) : null}
			<div className={cn('relative flex h-svh min-h-0 w-full flex-col overflow-hidden', settingsOpen && 'hidden')}>
			<SidebarProvider className="relative flex min-h-0 w-full flex-1 overflow-hidden">
				<WindowSidebarToggle />
				<AppSidebar {...sidebar} />

				<SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					{overlay.visible ? (
						<div
							data-slot="engine-overlay"
							className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
							role="status"
							aria-live="polite"
							aria-label={
								overlay.engineStatus === 'reconnecting'
									? 'Engine reconnecting'
									: 'Engine Error'
							}
						>
							<div className="app-region-no-drag flex flex-col items-center gap-3 px-6 text-center">
								<p className="text-sm font-medium text-foreground">
									{overlay.engineStatus === 'reconnecting'
										? 'Reconnecting to engine…'
										: 'Engine Error'}
								</p>
								{overlay.engineError ? (
									<p className="max-w-sm text-xs text-muted-foreground">{overlay.engineError}</p>
								) : null}
								{overlay.showRetry ? (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										onClick={overlay.onRetry}
									>
										Retry
									</Button>
								) : null}
							</div>
						</div>
					) : null}
					{children}
				</SidebarInset>
			</SidebarProvider>
			<RemoteFolderDialog open={remoteFolderOpen} onOpenChange={onRemoteFolderOpenChange} />
			{palette ? (
				<Suspense fallback={null}>
					<CommandPalette
						open={palette.open}
						onOpenChange={palette.onOpenChange}
						projects={palette.projects}
						projectTasks={palette.projectTasks}
						chats={palette.chats}
						activeTaskId={palette.activeTaskId}
						onOpenTask={palette.onOpenTask}
						onDropOpenTabs={palette.onDropOpenTabs}
						onOpenTeams={palette.onOpenTeams}
					/>
				</Suspense>
			) : null}
			<StatusBar
				projectName={status.projectName}
				engineStatus={status.engineStatus}
				engineError={status.engineError}
				git={status.git}
				modelDisplay={status.modelDisplay}
				edges={status.edges}
				runState={status.runState}
				editorVisible={status.editorVisible}
				onRetryEngine={status.onRetryEngine}
			/>
			{keep ? (
				<KeepConfirm
					paths={keep.paths}
					busy={keep.busy}
					onCancel={keep.onCancel}
					onConfirm={keep.onConfirm}
				/>
			) : null}
			</div>
		</TooltipProvider>
		</ReviewDirtyPaths.Provider>
	);
}
