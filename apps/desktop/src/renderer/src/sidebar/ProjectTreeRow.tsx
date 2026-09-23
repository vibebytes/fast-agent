import {shellT as t} from '../i18n/t';
import {memo} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger
} from '@fast-ide/ui/components/context-menu';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {SidebarMenuItem} from '@fast-ide/ui/components/sidebar';
import {Tooltip, TooltipContent, TooltipTrigger} from '@fast-ide/ui/components/tooltip';
import {cn} from '@fast-ide/ui/lib/utils';
import {ChevronRight, Folder, FolderOpen, MoreHorizontal, SquarePen} from 'lucide-react';
import {type ProjectRow} from '../sidebarModel';
import {ProjectMenuItems, contextChrome, dropdownChrome} from './sidebarMenus';
import {TreeTaskRow, type RowActions} from './TaskRows';

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
export const ProjectTreeRow = memo(
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
								'group/project-row relative flex h-8 w-full min-w-0 items-center rounded-md',
								// Avoid stacked pills with a selected child Task (Codex-adjacent clash).
								!project.active && 'hover:bg-sidebar-accent'
							)}
						>
							<button
								type="button"
								title={shortenedPath}
								className={cn(
									'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 pr-14 text-left text-sm leading-5 outline-none',
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
									'absolute right-0.5 flex h-8 shrink-0 items-center',
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
					<ul className="relative flex w-full min-w-0 flex-col gap-1 before:absolute before:top-0 before:bottom-1.5 before:left-[11px] before:w-[1px] before:bg-sidebar-border/50">
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
