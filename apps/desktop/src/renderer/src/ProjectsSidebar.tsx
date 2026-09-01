import {shellT as t} from './i18n/t';
import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger
} from '@fast-ide/ui/components/context-menu';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem
} from '@fast-ide/ui/components/sidebar';
import {Tooltip, TooltipContent, TooltipTrigger} from '@fast-ide/ui/components/tooltip';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Archive,
	ChevronDown,
	ChevronRight,
	Folder,
	FolderOpen,
	MoreHorizontal,
	Pin,
	Plus,
	SquarePen
} from 'lucide-react';
import {NewBlankProjectDialog} from './NewBlankProjectDialog';
import {openExistingFolder} from './openExistingFolder';
import {RemoteServerPicker} from './RemoteServerPicker';
import type {EdgesList} from '@fast-ide/session-view';
import type {ProjectSnapshot, TaskSummary} from './env';
import {basename} from './session/path';
import {
	SidebarDialogs,
	SIDEBAR_DIALOG_NONE,
	type SidebarDialogState
} from './sidebar/SidebarDialogs';
import {
	ProjectMenuItems,
	TaskMenuItems,
	contextChrome,
	dropdownChrome
} from './sidebar/sidebarMenus';
import {
	archiveAllInProject,
	archiveTask,
	ensureExpanded,
	expandActiveIfEmpty,
	forgetSessionChrome,
	setGroupMode,
	setProjectsSectionOpen,
	setSortMode,
	syncPinnedTitle,
	toggleExpand,
	togglePinProject,
	togglePinTask
} from './sidebarChrome';
import {
	buildSidebarModel,
	type ProjectRow,
	type ProjectTasksMap,
	type TaskRow
} from './sidebarModel';
import {
	loadSidebarUiState,
	saveSidebarUiState,
	subscribeSidebarUiState,
	type PinnedTaskRef,
	type ProjectGroupMode,
	type ProjectSortMode,
	type SidebarUiState
} from './sidebarUiState';

export type {ProjectTasksMap};

const DEFAULT_PROJECT_PATH_SENTINEL = '__default__';

function RunStateDot({runState}: {runState: 'running' | 'completed-unseen'}) {
	return (
		<span
			aria-hidden
			className={cn(
				'inline-block mr-1 size-1.5 shrink-0 rounded-full',
				runState === 'running' && 'bg-green-500 run-state-running',
				runState === 'completed-unseen' && 'bg-amber-500'
			)}
		/>
	);
}

function ProjectsSidebarImpl({
	projects,
	projectTasks,
	projectTasksHydrated,
	defaultTasks,
	defaultTasksHydrated,
	activeTaskId,
	engineReady,
	onCreateDefaultTask,
	onOpenTask,
	onDropOpenTabs
}: {
	projects: ProjectSnapshot[];
	projectTasks: ProjectTasksMap;
	projectTasksHydrated: Record<string, boolean>;
	defaultTasks: TaskSummary[];
	defaultTasksHydrated: boolean;
	activeTaskId: string | null;
	engineReady: boolean;
	onCreateDefaultTask?: () => void;
	/** Ensure Open Tab + Focus Change (host owns open set). */
	onOpenTask: (taskId: string) => Promise<void>;
	/** Archive / invalidate — remove matching Open Tabs from the open set. */
	onDropOpenTabs: (taskIds: string[]) => void;
}) {
	const [ui, setUi] = useState<SidebarUiState>(() => loadSidebarUiState());
	const [blankProjectOpen, setBlankProjectOpen] = useState(false);
	const [dialog, setDialog] = useState<SidebarDialogState>(SIDEBAR_DIALOG_NONE);
	const [edges, setEdges] = useState<EdgesList | null>(null);

	useEffect(() => subscribeSidebarUiState(() => setUi(loadSidebarUiState())), []);
	useEffect(() => {
		void window.fastIde.listEdges().then(setEdges);
		return window.fastIde.onEdgesChanged(setEdges);
	}, []);

	const uiRef = useRef(ui);
	uiRef.current = ui;
	// Stable identity (reads latest ui via ref) — row actions must not re-bind
	// per render or the row memos below never hold (perf doc P1).
	const updateUi = useCallback(
		(patch: Partial<SidebarUiState> | ((prev: SidebarUiState) => SidebarUiState)) => {
			// Compute next outside of setState updater to avoid React 18 concurrent-mode
			// deferral of render-phase side effects; ensures localStorage write always runs.
			const next =
				typeof patch === 'function' ? patch(uiRef.current) : {...uiRef.current, ...patch};
			setUi(next);
			saveSidebarUiState(next, true);
		},
		[]
	);

	// First restore: expand active project only after its Task list is known
	// (hydrated empty counts; non-empty lists from create also unlock expand).
	useEffect(() => {
		const active = projects.find(p => p.active);
		if (!active) return;
		const known =
			projectTasksHydrated[active.id] || (projectTasks[active.id]?.length ?? 0) > 0;
		if (!known) return;
		setUi(prev => {
			const next = expandActiveIfEmpty(prev, active.path);
			if (next === prev) return prev;
			saveSidebarUiState(next, false);
			return next;
		});
	}, [projects, projectTasks, projectTasksHydrated]);

	const model = useMemo(
		() =>
			buildSidebarModel({
				projects,
				projectTasks,
				defaultTasks,
				defaultProjectPath: DEFAULT_PROJECT_PATH_SENTINEL,
				ui,
				activeTaskId
			}),
		[projects, projectTasks, defaultTasks, ui, activeTaskId]
	);
	const modelRef = useRef(model);
	modelRef.current = model;

	const renameProject = useCallback((project: ProjectSnapshot) => {
		const row = modelRef.current.projects.find(r => r.project.id === project.id);
		setDialog({
			kind: 'renameProject',
			project,
			initialName: row?.displayName ?? basename(project.path)
		});
	}, []);

	async function applyRenameProject(project: ProjectSnapshot, name: string) {
		const result = await window.fastIde.renameProject(project.id, name);
		if (!result.ok && result.notice) {
			console.error('[renameProject]', result.notice);
		}
	}

	const renameTask = useCallback((project: ProjectSnapshot, task: TaskSummary) => {
		setDialog({
			kind: 'renameTask',
			task,
			initialName: task.title,
			projectPath: project.path
		});
	}, []);

	async function applyRenameTask(task: TaskSummary, name: string, projectPath: string) {
		const result = await window.fastIde.renameTask(task.id, name);
		if (!result.ok || !task.sessionId) return;
		updateUi(prev => syncPinnedTitle(prev, projectPath, task.sessionId!, name));
	}

	const pinTask = useCallback(
		(projectPath: string, task: TaskSummary) => {
			if (!task.sessionId) return;
			updateUi(prev => togglePinTask(prev, projectPath, task.sessionId!, task.title));
		},
		[updateUi]
	);

	const requestArchiveTask = useCallback((project: ProjectSnapshot, task: TaskSummary) => {
		setDialog({kind: 'confirmArchiveTask', project, task});
	}, []);

	function confirmArchiveTask(project: ProjectSnapshot, task: TaskSummary) {
		if (!task.sessionId) return;
		updateUi(prev => archiveTask(prev, project.path, task.sessionId!));
		onDropOpenTabs([task.id]);
	}

	const requestDeleteTask = useCallback((project: ProjectSnapshot, task: TaskSummary) => {
		setDialog({kind: 'confirmDeleteTask', project, task});
	}, []);

	async function confirmDeleteTask(project: ProjectSnapshot, task: TaskSummary) {
		const result = await window.fastIde.deleteTask(task.id, task.sessionId);
		if (!result.ok) {
			if (result.notice) console.error('[deleteTask]', result.notice);
			return;
		}
		if (task.sessionId) {
			updateUi(prev => forgetSessionChrome(prev, project.path, task.sessionId!));
		}
		onDropOpenTabs([task.id]);
	}

	const requestArchiveAll = useCallback((project: ProjectSnapshot) => {
		const row = modelRef.current.projects.find(r => r.project.id === project.id);
		const tasks = row?.tasks ?? [];
		setDialog({
			kind: 'confirmArchiveAll',
			project,
			count: tasks.length,
			displayName: row?.displayName ?? basename(project.path)
		});
	}, []);

	function confirmArchiveAll(project: ProjectSnapshot) {
		const row = model.projects.find(r => r.project.id === project.id);
		const taskRows = row?.tasks ?? [];
		const sessionIds = taskRows
			.map(t => t.task.sessionId)
			.filter((id): id is string => Boolean(id));
		if (sessionIds.length === 0) return;
		updateUi(prev => archiveAllInProject(prev, project.path, sessionIds));
		onDropOpenTabs(taskRows.map(t => t.task.id));
	}

	const requestRemove = useCallback((project: ProjectSnapshot) => {
		const row = modelRef.current.projects.find(r => r.project.id === project.id);
		setDialog({
			kind: 'confirmRemoveProject',
			project,
			displayName: row?.displayName ?? basename(project.path)
		});
	}, []);

	const openTask = useCallback(
		(taskId: string) => {
			void onOpenTask(taskId);
		},
		[onOpenTask]
	);

	const toggleProject = useCallback(
		(projectPath: string) => updateUi(prev => toggleExpand(prev, projectPath)),
		[updateUi]
	);
	const pinProject = useCallback(
		(projectPath: string) => updateUi(prev => togglePinProject(prev, projectPath)),
		[updateUi]
	);
	const createTaskIn = useCallback(
		(project: ProjectSnapshot) => {
			void (async () => {
				updateUi(prev => ensureExpanded(prev, project.path));
				await window.fastIde.createTask('New task', project.id);
			})();
		},
		[updateUi]
	);

	const actions = useMemo<RowActions>(
		() => ({
			openTask,
			pinTask,
			requestArchiveTask,
			requestDeleteTask,
			renameTask,
			renameProject,
			requestArchiveAll,
			requestRemove,
			toggleProject,
			pinProject,
			createTaskIn
		}),
		[
			openTask,
			pinTask,
			requestArchiveTask,
			requestDeleteTask,
			renameTask,
			renameProject,
			requestArchiveAll,
			requestRemove,
			toggleProject,
			pinProject,
			createTaskIn
		]
	);

	async function openPinned(pin: PinnedTaskRef, taskId: string | null) {
		if (taskId) {
			await onOpenTask(taskId);
			return;
		}
		const project = projects.find(p => p.path === pin.projectPath);
		if (!project) return;
		const tasks = projectTasks[project.id] ?? [];
		const match = tasks.find(t => t.sessionId === pin.sessionId);
		if (match) await onOpenTask(match.id);
	}

	function resolvePinnedTask(pin: PinnedTaskRef): {
		project: ProjectSnapshot | undefined;
		task: TaskSummary | undefined;
	} {
		if (pin.projectPath === model.defaultProjectPath) {
			return {
				project: model.defaultProjectSnapshot,
				task: defaultTasks.find(t => t.sessionId === pin.sessionId)
			};
		}
		const project = projects.find(p => p.path === pin.projectPath);
		const task = project
			? (projectTasks[project.id] ?? []).find(t => t.sessionId === pin.sessionId)
			: undefined;
		return {project, task};
	}

	function projectForFlatRow(row: TaskRow): ProjectSnapshot | undefined {
		return projects.find(p => p.id === row.projectId || p.path === row.projectPath);
	}

	return (
		<>
			<RemoteServerPicker edges={edges} />

			{model.pinned.length > 0 ? (
				<SidebarGroup className="gap-0.5 py-1">
					<SidebarGroupLabel>{t('shell.sidebar.pinned')}</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{model.pinned.map(({pin, taskId}) => {
								const {project, task} = resolvePinnedTask(pin);
								if (!project || !task) {
									return (
										<SidebarMenuItem key={`${pin.projectPath}::${pin.sessionId}`}>
											<SidebarMenuButton
												size="sm"
												onClick={() => void openPinned(pin, taskId)}
												tooltip={pin.title}
												className="text-xs gap-1.5"
											>
												<Pin className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
												<span className="truncate">{pin.title}</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								}
								const isDefault = pin.projectPath === model.defaultProjectPath;
								return (
									<ContextMenu key={`${pin.projectPath}::${pin.sessionId}`}>
										<ContextMenuTrigger asChild>
											<SidebarMenuItem>
												<SidebarMenuButton
													size="sm"
													onClick={() => void openPinned(pin, taskId)}
													tooltip={pin.title}
													className="text-xs gap-1.5"
												>
													<Pin className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
													{task.runState ? <RunStateDot runState={task.runState} /> : null}
													<span className="truncate">{pin.title}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										</ContextMenuTrigger>
										<ContextMenuContent className="w-52">
											<TaskMenuItems
												menu={contextChrome}
												{...taskMenuPropsOf(
													actions,
													project,
													task,
													true,
													isDefault
														? () => void window.fastIde.showTaskProjectInFolder(task.id)
														: undefined
												)}
											/>
										</ContextMenuContent>
									</ContextMenu>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			) : null}

			<SidebarGroup className="gap-0.5 px-2 py-1">
				<div
					className={cn(
						'group/projects-bar flex h-7 w-full items-center gap-0.5 rounded-sm pr-0.5 pl-2',
						'hover:bg-sidebar-accent'
					)}
				>
					<button
						type="button"
						className={cn(
							'flex h-full min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium',
							'text-sidebar-muted-foreground outline-none',
							'group-hover/projects-bar:text-sidebar-accent-foreground'
						)}
						onClick={() =>
							updateUi(prev => setProjectsSectionOpen(prev, !prev.projectsSectionOpen))
						}
						aria-expanded={model.projectsSectionOpen}
					>
						<span>{t('shell.sidebar.projects')}</span>
						<ChevronDown
							className={cn(
								'size-3.5 shrink-0 transition-transform',
								!model.projectsSectionOpen && '-rotate-90'
							)}
						/>
					</button>
					<div className="flex h-full shrink-0 items-center">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-6 text-sidebar-muted-foreground hover:bg-transparent hover:text-sidebar-accent-foreground"
									aria-label={t('shell.sidebar.organizeSort')}
								>
									<MoreHorizontal className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="right" align="start" className="w-48">
								<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
									{t('shell.sidebar.organize')}
								</DropdownMenuLabel>
								<DropdownMenuRadioGroup
									value={model.groupMode}
									onValueChange={value =>
										updateUi(prev => setGroupMode(prev, value as ProjectGroupMode))
									}
								>
									<DropdownMenuRadioItem value="byProject" className="gap-2">
										{t('shell.sidebar.byProject')}
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="flat" className="gap-2">
										{t('shell.sidebar.inOneList')}
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
								<DropdownMenuSeparator />
								<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
									{t('shell.sidebar.sortBy')}
								</DropdownMenuLabel>
								<DropdownMenuRadioGroup
									value={model.sortMode}
									onValueChange={value =>
										updateUi(prev => setSortMode(prev, value as ProjectSortMode))
									}
								>
									<DropdownMenuRadioItem value="priority">{t('shell.sidebar.sortPriority')}</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="recent">{t('shell.sidebar.sortRecent')}</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="manual">{t('shell.sidebar.sortManual')}</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-6 text-sidebar-muted-foreground hover:bg-transparent hover:text-sidebar-accent-foreground"
									aria-label={t('shell.sidebar.newProject')}
								>
									<Plus className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="right" align="start" className="w-52">
								{edges?.capabilities.canCreateLocalProject !== false ? (
									<DropdownMenuItem onClick={() => setBlankProjectOpen(true)}>
										<Plus className="size-4" />
										{t('shell.sidebar.newBlankProject')}
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem
									disabled={Boolean(edges?.pendingEdgeId)}
									onClick={() => void openExistingFolder()}
								>
									<Folder className="size-4" />
									{t('shell.sidebar.useExistingFolder')}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				<NewBlankProjectDialog open={blankProjectOpen} onOpenChange={setBlankProjectOpen} />

				{model.projectsSectionOpen ? (
					<SidebarGroupContent>
						{projects.length === 0 ? (
							<p className="px-2 text-xs text-sidebar-muted-foreground">Open a folder to start</p>
						) : model.groupMode === 'flat' ? (
							<SidebarMenu>
								{model.flatTasks.length === 0 ? (
									<p className="px-2 text-xs text-sidebar-muted-foreground">
										{projects.some(
											p =>
												!projectTasksHydrated[p.id] &&
												(projectTasks[p.id]?.length ?? 0) === 0
										)
											? t('shell.sidebar.loading')
											: t('shell.sidebar.noTasks')}
									</p>
								) : (
									model.flatTasks.map(row => {
										const project = projectForFlatRow(row);
										if (!project) return null;
										return (
											<FlatTaskRow
												key={`${row.projectId}:${row.task.id}`}
												project={project}
												row={row}
												actions={actions}
											/>
										);
									})
								)}
							</SidebarMenu>
						) : (
							<SidebarMenu>
								{model.projects.map(row => (
									<ProjectTreeRow
										key={row.project.id}
										row={row}
										hydrated={Boolean(projectTasksHydrated[row.project.id])}
										engineReady={engineReady}
										actions={actions}
									/>
								))}
							</SidebarMenu>
						)}
					</SidebarGroupContent>
				) : null}
			</SidebarGroup>

			<SidebarGroup className="gap-0.5 py-1">
				<SidebarGroupLabel className="flex items-center justify-between text-sidebar-muted-foreground">
					<span>Tasks</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						disabled={!engineReady}
						onClick={() => onCreateDefaultTask?.()}
						aria-label="New task"
						className="text-sidebar-muted-foreground hover:text-sidebar-accent-foreground"
					>
						+
					</Button>
				</SidebarGroupLabel>
				<SidebarGroupContent>
					<SidebarMenu>
						{model.defaultTasks.map(row => (
							<DefaultTaskRow
								key={row.task.id}
								row={row}
								defaultProject={model.defaultProjectSnapshot}
								actions={actions}
							/>
						))}
						{model.defaultTasks.length === 0 && (
							<p className="px-2 text-xs text-sidebar-muted-foreground">
								{!defaultTasksHydrated ? t('shell.sidebar.loading') : t('shell.sidebar.noTasks')}
							</p>
						)}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

			<SidebarDialogs
				dialog={dialog}
				onOpenChange={open => {
					if (!open) setDialog(SIDEBAR_DIALOG_NONE);
				}}
				onRenameProject={applyRenameProject}
				onRenameTask={applyRenameTask}
				onArchiveTask={confirmArchiveTask}
				onArchiveAll={confirmArchiveAll}
				onDeleteTask={confirmDeleteTask}
				onRemoveProject={p => void window.fastIde.closeProject(p.id)}
			/>
		</>
	);
}

/** Stable row-facing action set — one object identity for every row memo (P1). */
type RowActions = {
	openTask: (taskId: string) => void;
	pinTask: (projectPath: string, task: TaskSummary) => void;
	requestArchiveTask: (project: ProjectSnapshot, task: TaskSummary) => void;
	requestDeleteTask: (project: ProjectSnapshot, task: TaskSummary) => void;
	renameTask: (project: ProjectSnapshot, task: TaskSummary) => void;
	renameProject: (project: ProjectSnapshot) => void;
	requestArchiveAll: (project: ProjectSnapshot) => void;
	requestRemove: (project: ProjectSnapshot) => void;
	toggleProject: (projectPath: string) => void;
	pinProject: (projectPath: string) => void;
	createTaskIn: (project: ProjectSnapshot) => void;
};

function taskMenuPropsOf(
	actions: RowActions,
	project: ProjectSnapshot,
	task: TaskSummary,
	pinned: boolean,
	showInFolder?: () => void
) {
	return {
		canMutate: Boolean(task.sessionId),
		pinned,
		onOpen: () => actions.openTask(task.id),
		onRename: () => actions.renameTask(project, task),
		onShowInFolder:
			showInFolder ?? (() => void window.fastIde.showProjectInFolder(project.id)),
		onPin: () => actions.pinTask(project.path, task),
		onArchive: () => actions.requestArchiveTask(project, task),
		onDelete: () => actions.requestDeleteTask(project, task)
	};
}

function TaskHoverActions({
	project,
	projectPath,
	task,
	pinned,
	actions
}: {
	project: ProjectSnapshot;
	projectPath: string;
	task: TaskSummary;
	pinned: boolean;
	actions: RowActions;
}) {
	return (
		<div
			className={cn(
				'absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5',
				'opacity-0 transition-opacity group-hover/task:opacity-100 focus-within:opacity-100'
			)}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={!task.sessionId}
						aria-label={pinned ? t('shell.sidebar.unpinTask') : t('shell.sidebar.pinTask')}
						onClick={e => {
							e.stopPropagation();
							actions.pinTask(projectPath, task);
						}}
					>
						<Pin className={cn('size-3.5', pinned && 'fill-current')} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">{pinned ? t('shell.sidebar.unpinTask') : t('shell.sidebar.pinTask')}</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={!task.sessionId}
						aria-label={t('shell.sidebar.archiveTask')}
						onClick={e => {
							e.stopPropagation();
							actions.requestArchiveTask(project, task);
						}}
					>
						<Archive className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">{t('shell.sidebar.archiveTask')}</TooltipContent>
			</Tooltip>
		</div>
	);
}

const taskRowEqual = (
	a: {row: TaskRow; project: ProjectSnapshot; actions: RowActions},
	b: {row: TaskRow; project: ProjectSnapshot; actions: RowActions}
): boolean =>
	a.project === b.project &&
	a.actions === b.actions &&
	a.row.task === b.row.task &&
	a.row.pinned === b.row.pinned &&
	a.row.isActive === b.row.isActive;

const FlatTaskRow = memo(function FlatTaskRow({
	project,
	row,
	actions
}: {
	project: ProjectSnapshot;
	row: TaskRow;
	actions: RowActions;
}) {
	const {task, pinned, displayProjectName} = row;
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<SidebarMenuItem className="group/task relative">
					<SidebarMenuButton
						size="sm"
						isActive={row.isActive && project.active}
						onClick={() => actions.openTask(task.id)}
						tooltip={`${task.title} · ${displayProjectName ?? ''}`}
						className="text-xs gap-1.5"
					>
						{task.runState ? <RunStateDot runState={task.runState} /> : null}
						<span className="truncate">{task.title}</span>
					</SidebarMenuButton>
					<TaskHoverActions
						project={project}
						projectPath={row.projectPath}
						task={task}
						pinned={pinned}
						actions={actions}
					/>
				</SidebarMenuItem>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52">
				<TaskMenuItems menu={contextChrome} {...taskMenuPropsOf(actions, project, task, pinned)} />
			</ContextMenuContent>
		</ContextMenu>
	);
}, taskRowEqual);

const TreeTaskRow = memo(function TreeTaskRow({
	project,
	row,
	actions
}: {
	project: ProjectSnapshot;
	row: TaskRow;
	actions: RowActions;
}) {
	const {task, pinned} = row;
	const taskActive = row.isActive && project.active;
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<li className="group/task relative w-full min-w-0 list-none">
					<div
						className={cn(
							'relative flex h-7 w-full min-w-0 items-center rounded-sm',
							'hover:bg-sidebar-accent',
							taskActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
						)}
					>
						<button
							type="button"
							className="flex h-7 w-full min-w-0 items-center truncate pr-14 pl-7 text-left text-xs leading-none text-sidebar-foreground outline-none gap-1.5"
							onClick={() => actions.openTask(task.id)}
						>
							{task.runState ? <RunStateDot runState={task.runState} /> : null}
							<span className="truncate">{task.title}</span>
						</button>
						<TaskHoverActions
							project={project}
							projectPath={row.projectPath}
							task={task}
							pinned={pinned}
							actions={actions}
						/>
					</div>
				</li>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52">
				<TaskMenuItems menu={contextChrome} {...taskMenuPropsOf(actions, project, task, pinned)} />
			</ContextMenuContent>
		</ContextMenu>
	);
}, taskRowEqual);

function projectRowEqual(a: ProjectRow, b: ProjectRow): boolean {
	return (
		a.project === b.project &&
		a.displayName === b.displayName &&
		a.shortenedPath === b.shortenedPath &&
		a.expanded === b.expanded &&
		a.pinned === b.pinned &&
		a.tasks.length === b.tasks.length &&
		a.tasks.every((t, i) => {
			const o = b.tasks[i]!;
			return t.task === o.task && t.pinned === o.pinned && t.isActive === o.isActive;
		})
	);
}

/**
 * Per-project subtree memo (perf doc P1): expand/collapse or Task focus re-render
 * only the affected project row — not every ContextMenu/Tooltip tree in the list.
 */
const ProjectTreeRow = memo(
	function ProjectTreeRow({
		row,
		hydrated,
		engineReady,
		actions
	}: {
		row: ProjectRow;
		hydrated: boolean;
		engineReady: boolean;
		actions: RowActions;
	}) {
		const {project, displayName, shortenedPath, expanded, pinned, tasks} = row;
		const menuProps = {
			projectPinned: pinned,
			taskCount: tasks.length,
			onOpen: () => actions.toggleProject(project.path),
			onPin: () => actions.pinProject(project.path),
			onShowInFolder: () => void window.fastIde.showProjectInFolder(project.id),
			onRename: () => actions.renameProject(project),
			onArchiveAll: () => actions.requestArchiveAll(project),
			onRemove: () => actions.requestRemove(project)
		};

		return (
			<SidebarMenuItem className="group/project">
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<div
							className={cn(
								'group/project-row relative flex h-7 w-full min-w-0 items-center rounded-sm',
								// Avoid stacked pills with a selected child Task (Codex-adjacent clash).
								!project.active && 'hover:bg-sidebar-accent'
							)}
						>
							<button
								type="button"
								title={shortenedPath}
								className={cn(
									'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 pr-14 text-left text-xs leading-none outline-none',
									'hover:bg-transparent'
								)}
								onPointerDown={e => {
									if (e.button !== 0) return;
									e.preventDefault();
									actions.toggleProject(project.path);
								}}
								onKeyDown={e => {
									if (e.key !== 'Enter' && e.key !== ' ') return;
									e.preventDefault();
									actions.toggleProject(project.path);
								}}
							>
								<ChevronRight
									className={cn(
										'size-3 shrink-0 text-sidebar-muted-foreground/70',
										expanded && 'rotate-90'
									)}
								/>
								{expanded ? (
									<FolderOpen className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
								) : (
									<Folder className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
								)}
								<span className="min-w-0 flex-1 truncate text-sidebar-foreground">
									{displayName}
								</span>
							</button>

							<div
								className={cn(
									'absolute right-0.5 flex h-7 shrink-0 items-center',
									'opacity-0 transition-opacity',
									'group-hover/project:opacity-100 focus-within:opacity-100',
									'group-has-[[data-state=open]]/project:opacity-100'
								)}
							>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="size-6 hover:bg-transparent"
											aria-label={t('shell.sidebar.projectMenu')}
											onClick={e => e.stopPropagation()}
										>
											<MoreHorizontal className="size-3.5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent side="right" align="start" className="w-52">
										<ProjectMenuItems menu={dropdownChrome} {...menuProps} />
									</DropdownMenuContent>
								</DropdownMenu>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="size-6 hover:bg-transparent"
											disabled={project.status !== 'ready' && !engineReady}
											aria-label={t('shell.sidebar.newTask')}
											onClick={e => {
												e.stopPropagation();
												actions.createTaskIn(project);
											}}
										>
											<SquarePen className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="right">{t('shell.sidebar.newTask')}</TooltipContent>
								</Tooltip>
							</div>
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent className="w-52">
						<ProjectMenuItems menu={contextChrome} {...menuProps} />
					</ContextMenuContent>
				</ContextMenu>

				{expanded ? (
					<ul className="relative flex w-full min-w-0 flex-col gap-0 before:absolute before:top-0 before:bottom-1.5 before:left-[11px] before:w-[1px] before:bg-sidebar-border/50">
						{!hydrated && tasks.length === 0 ? (
							<li className="px-2 py-0.5 text-xs text-sidebar-muted-foreground">{t('shell.sidebar.loading')}</li>
						) : tasks.length === 0 ? (
							<li className="px-2 py-0.5 text-xs text-sidebar-muted-foreground">{t('shell.sidebar.noTasks')}</li>
						) : (
							tasks.map(taskRow => (
								<TreeTaskRow
									key={taskRow.task.id}
									project={project}
									row={taskRow}
									actions={actions}
								/>
							))
						)}
					</ul>
				) : null}
			</SidebarMenuItem>
		);
	},
	(a, b) =>
		a.hydrated === b.hydrated &&
		a.engineReady === b.engineReady &&
		a.actions === b.actions &&
		projectRowEqual(a.row, b.row)
);

const DefaultTaskRow = memo(
	function DefaultTaskRow({
		row,
		defaultProject,
		actions
	}: {
		row: TaskRow;
		defaultProject: ProjectSnapshot;
		actions: RowActions;
	}) {
		const {task, pinned, canMutate, isActive} = row;
		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="sm"
							isActive={isActive}
							onClick={() => actions.openTask(task.id)}
							className="text-xs gap-1.5"
						>
							{task.runState ? <RunStateDot runState={task.runState} /> : null}
							<span>{task.title}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-52">
					<TaskMenuItems
						menu={contextChrome}
						canMutate={canMutate}
						pinned={pinned}
						onOpen={() => actions.openTask(task.id)}
						onRename={() => actions.renameTask(defaultProject, task)}
						onShowInFolder={() => void window.fastIde.showTaskProjectInFolder(task.id)}
						onPin={() => actions.pinTask(defaultProject.path, task)}
						onArchive={() => actions.requestArchiveTask(defaultProject, task)}
						onDelete={() => actions.requestDeleteTask(defaultProject, task)}
					/>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
	(a, b) =>
		// defaultProject is rebuilt per model — compare by path (content-constant).
		a.defaultProject.path === b.defaultProject.path &&
		a.actions === b.actions &&
		a.row.task === b.row.task &&
		a.row.pinned === b.row.pinned &&
		a.row.canMutate === b.row.canMutate &&
		a.row.isActive === b.row.isActive
);

/**
 * Memo boundary (perf doc P0-3): the sidebar must not re-render on streaming
 * transcript patches — its props (lists + stable callbacks) only change identity
 * on structural / focus publishes.
 */
export const ProjectsSidebar = memo(ProjectsSidebarImpl);
