import {shellT as t} from '../i18n/t';
import {memo} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger
} from '@fast-ide/ui/components/context-menu';
import {SidebarMenuButton, SidebarMenuItem} from '@fast-ide/ui/components/sidebar';
import {Tooltip, TooltipContent, TooltipTrigger} from '@fast-ide/ui/components/tooltip';
import {cn} from '@fast-ide/ui/lib/utils';
import {Archive, Pin} from 'lucide-react';
import type {ProjectSnapshot, TaskSummary} from '../env';
import {type TaskRow} from '../sidebarModel';
import {TaskMenuItems, contextChrome} from './sidebarMenus';

export function RunStateDot({runState}: {runState: 'running' | 'completed-unseen'}) {
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

/** Stable row-facing action set — one object identity for every row memo (P1). */
export type RowActions = {
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

export function taskMenuPropsOf(
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

export const FlatTaskRow = memo(function FlatTaskRow({
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

export const TreeTaskRow = memo(function TreeTaskRow({
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

export const DefaultTaskRow = memo(
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
