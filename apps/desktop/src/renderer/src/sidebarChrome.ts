/**
 * Pure sidebar chrome patches — pin / archive / expand / sort.
 * IPC (selectTask, renameTask, closeProject) stays in the host component.
 */
import {
	isPinnedTask,
	type ProjectGroupMode,
	type ProjectSortMode,
	type PinnedTaskRef,
	type SidebarUiState
} from './sidebarUiState.js';

export function toggleExpand(ui: SidebarUiState, path: string): SidebarUiState {
	const set = new Set(ui.expandedProjectPaths);
	if (set.has(path)) set.delete(path);
	else set.add(path);
	return {...ui, expandedProjectPaths: [...set]};
}

export function ensureExpanded(ui: SidebarUiState, path: string): SidebarUiState {
	if (ui.expandedProjectPaths.includes(path)) return ui;
	return {...ui, expandedProjectPaths: [...ui.expandedProjectPaths, path]};
}

/** First cold restore: expand active project only when nothing is expanded yet. */
export function expandActiveIfEmpty(ui: SidebarUiState, activePath: string | undefined): SidebarUiState {
	if (!activePath) return ui;
	if (ui.expandedProjectPaths.length > 0) return ui;
	if (ui.expandedProjectPaths.includes(activePath)) return ui;
	return {...ui, expandedProjectPaths: [activePath]};
}

export function togglePinProject(ui: SidebarUiState, path: string): SidebarUiState {
	const set = new Set(ui.pinnedProjectPaths);
	if (set.has(path)) set.delete(path);
	else set.add(path);
	return {...ui, pinnedProjectPaths: [...set]};
}

export function togglePinTask(
	ui: SidebarUiState,
	projectPath: string,
	sessionId: string,
	title: string
): SidebarUiState {
	if (isPinnedTask(ui.pinnedTasks, projectPath, sessionId)) {
		return {
			...ui,
			pinnedTasks: ui.pinnedTasks.filter(
				p => !(p.projectPath === projectPath && p.sessionId === sessionId)
			)
		};
	}
	const ref: PinnedTaskRef = {projectPath, sessionId, title};
	return {...ui, pinnedTasks: [ref, ...ui.pinnedTasks]};
}

export function archiveTask(
	ui: SidebarUiState,
	projectPath: string,
	sessionId: string
): SidebarUiState {
	return {
		...ui,
		archivedTasks: [
			...ui.archivedTasks.filter(
				a => !(a.projectPath === projectPath && a.sessionId === sessionId)
			),
			{projectPath, sessionId}
		],
		pinnedTasks: ui.pinnedTasks.filter(
			p => !(p.projectPath === projectPath && p.sessionId === sessionId)
		)
	};
}

/** Drop pin + archive chrome for a Session after Engine soft-delete. */
export function forgetSessionChrome(
	ui: SidebarUiState,
	projectPath: string,
	sessionId: string
): SidebarUiState {
	return {
		...ui,
		archivedTasks: ui.archivedTasks.filter(
			a => !(a.projectPath === projectPath && a.sessionId === sessionId)
		),
		pinnedTasks: ui.pinnedTasks.filter(
			p => !(p.projectPath === projectPath && p.sessionId === sessionId)
		)
	};
}

export function archiveAllInProject(
	ui: SidebarUiState,
	projectPath: string,
	sessionIds: string[]
): SidebarUiState {
	const idSet = new Set(sessionIds);
	return {
		...ui,
		archivedTasks: [
			...ui.archivedTasks.filter(a => a.projectPath !== projectPath),
			...sessionIds.map(sessionId => ({projectPath, sessionId}))
		],
		pinnedTasks: ui.pinnedTasks.filter(
			p => !(p.projectPath === projectPath && idSet.has(p.sessionId))
		)
	};
}

export function syncPinnedTitle(
	ui: SidebarUiState,
	projectPath: string,
	sessionId: string,
	title: string
): SidebarUiState {
	return {
		...ui,
		pinnedTasks: ui.pinnedTasks.map(p =>
			p.projectPath === projectPath && p.sessionId === sessionId ? {...p, title} : p
		)
	};
}

export function setProjectsSectionOpen(ui: SidebarUiState, open: boolean): SidebarUiState {
	return {...ui, projectsSectionOpen: open};
}

export function setGroupMode(ui: SidebarUiState, mode: ProjectGroupMode): SidebarUiState {
	return {...ui, projectGroupMode: mode};
}

export function setSortMode(ui: SidebarUiState, mode: ProjectSortMode): SidebarUiState {
	return {...ui, projectSortMode: mode};
}
