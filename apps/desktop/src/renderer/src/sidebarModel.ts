/**
 * Pure sidebar projection — folder Projects + Default Tasks + pinned strip.
 * Hosts render rows and call IPC; chrome mutations live in sidebarChrome.
 */
import type {ProjectSnapshot, TaskSummary} from './env';
import {basename} from './session/path.js';
import {
	isArchived,
	isPinnedTask,
	type PinnedTaskRef,
	type ProjectGroupMode,
	type ProjectSortMode,
	type SidebarUiState
} from './sidebarUiState.js';

export type ProjectTasksMap = Record<string, TaskSummary[]>;

/** Platform run sessions stay out of the chat tree. Membership is sessionType. */
export function isAutomationTreeTask(task: Pick<TaskSummary, 'sessionType'>): boolean {
	return task.sessionType === 'automation';
}

export type TaskRow = {
	task: TaskSummary;
	projectPath: string;
	projectId: string | null;
	displayProjectName: string | null;
	pinned: boolean;
	/** The individual's fixed main session. Not the user's pin. */
	main: boolean;
	isActive: boolean;
	canMutate: boolean;
};

export type ProjectRow = {
	project: ProjectSnapshot;
	displayName: string;
	shortenedPath: string;
	expanded: boolean;
	pinned: boolean;
	tasks: TaskRow[];
};

export type PinnedRow = {
	pin: PinnedTaskRef;
	/** Resolved live task when still present in an open Project. */
	taskId: string | null;
	main: boolean;
};

export type SidebarModel = {
	pinned: PinnedRow[];
	projectsSectionOpen: boolean;
	groupMode: ProjectGroupMode;
	sortMode: ProjectSortMode;
	projects: ProjectRow[];
	flatTasks: TaskRow[];
	defaultTasks: TaskRow[];
	defaultProjectPath: string;
	defaultProjectSnapshot: ProjectSnapshot;
};

export function shortenHome(path: string): string {
	const home = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
	if (home) return `~${path.slice(home[1]!.length)}`;
	return path;
}

/** Engine displayName, or directory basename when blank. */
export function projectDisplayName(project: {
	path: string;
	displayName?: string | null;
}): string {
	return project.displayName?.trim() || basename(project.path);
}

function isMainTask(task: TaskSummary, homeSessionIds?: ReadonlySet<string>): boolean {
	if (task.sessionType === 'main') return true;
	return Boolean(task.sessionId && homeSessionIds?.has(task.sessionId));
}

function taskRow(
	task: TaskSummary,
	projectPath: string,
	projectId: string | null,
	displayProjectName: string | null,
	ui: SidebarUiState,
	activeTaskId: string | null,
	homeSessionIds?: ReadonlySet<string>
): TaskRow {
	return {
		task,
		projectPath,
		projectId,
		displayProjectName,
		pinned: isPinnedTask(ui.pinnedTasks, projectPath, task.sessionId),
		main: isMainTask(task, homeSessionIds),
		isActive: task.id === activeTaskId,
		canMutate: Boolean(task.sessionId)
	};
}

function recency(task: TaskSummary): string {
	return task.lastModified ?? '';
}

/** Newest-updated first. Missing timestamps sort last. */
function sortTaskRows(rows: TaskRow[]): TaskRow[] {
	return [...rows].sort((a, b) => {
		const byTime = recency(b.task).localeCompare(recency(a.task));
		if (byTime !== 0) return byTime;
		return a.task.title.localeCompare(b.task.title, 'zh');
	});
}

/** Main session stays at the top of Tasks. User pins are a separate flag. */
function sortDefaultTaskRows(rows: TaskRow[]): TaskRow[] {
	return [...rows].sort((a, b) => {
		if (a.main !== b.main) return a.main ? -1 : 1;
		const byTime = recency(b.task).localeCompare(recency(a.task));
		if (byTime !== 0) return byTime;
		return a.task.title.localeCompare(b.task.title, 'zh');
	});
}

/**
 * Folder rows are always name-sorted. Conversation recency must not move a
 * project — that was the "tree jumps while chatting" bug. Pin still floats
 * in priority/manual.
 */
function sortProjects(projects: ProjectSnapshot[], ui: SidebarUiState): ProjectSnapshot[] {
	const pinned = new Set(ui.pinnedProjectPaths);
	const list = [...projects];
	list.sort((a, b) => {
		if (ui.projectSortMode === 'priority' || ui.projectSortMode === 'manual') {
			const ap = pinned.has(a.path) ? 0 : 1;
			const bp = pinned.has(b.path) ? 0 : 1;
			if (ap !== bp) return ap - bp;
		}
		const an = projectDisplayName(a);
		const bn = projectDisplayName(b);
		return an.localeCompare(bn, 'zh');
	});
	return list;
}

export function buildSidebarModel(input: {
	projects: ProjectSnapshot[];
	projectTasks: ProjectTasksMap;
	defaultTasks: TaskSummary[];
	defaultProjectPath: string;
	ui: SidebarUiState;
	activeTaskId: string | null;
	/** Pinned cluster homes, used when sessionType has not arrived yet. */
	homeSessionIds?: readonly string[];
}): SidebarModel {
	const {projects, projectTasks, defaultTasks, defaultProjectPath, ui, activeTaskId} = input;
	const homeIds = new Set(input.homeSessionIds ?? []);
	const sorted = sortProjects(projects, ui);

	const projectRows: ProjectRow[] = sorted.map(project => {
		const displayName = projectDisplayName(project);
		const tasks = sortTaskRows(
			(projectTasks[project.id] ?? [])
				.filter(t => !isArchived(ui.archivedTasks, project.path, t.sessionId))
				.filter(t => !isAutomationTreeTask(t))
				.map(t => taskRow(t, project.path, project.id, displayName, ui, activeTaskId))
		);
		return {
			project,
			displayName,
			shortenedPath: shortenHome(project.path),
			expanded: ui.expandedProjectPaths.includes(project.path),
			pinned: ui.pinnedProjectPaths.includes(project.path),
			tasks
		};
	});

	const flatTasks: TaskRow[] = [];
	for (const row of projectRows) {
		flatTasks.push(...row.tasks);
	}
	if (ui.projectSortMode === 'priority') {
		flatTasks.sort((a, b) => {
			const ap = a.pinned ? 0 : 1;
			const bp = b.pinned ? 0 : 1;
			if (ap !== bp) return ap - bp;
			return a.task.title.localeCompare(b.task.title, 'zh');
		});
	} else if (ui.projectSortMode === 'recent') {
		flatTasks.sort((a, b) => recency(b.task).localeCompare(recency(a.task)));
	}

	const defaultProjectSnapshot: ProjectSnapshot = {
		id: 'default',
		path: defaultProjectPath,
		status: 'ready',
		active: false
	};

	const visibleDefault = sortDefaultTaskRows(
		defaultTasks
			.filter(t => !isArchived(ui.archivedTasks, defaultProjectPath, t.sessionId))
			.filter(t => !isAutomationTreeTask(t))
			.map(t => taskRow(t, defaultProjectPath, null, null, ui, activeTaskId, homeIds))
	);

	const pinned: PinnedRow[] = ui.pinnedTasks
		.filter(pin => {
			if (isArchived(ui.archivedTasks, pin.projectPath, pin.sessionId)) return false;
			const fromFolder = projects
				.flatMap(p => (projectTasks[p.id] ?? []).map(t => ({path: p.path, task: t})))
				.find(row => row.path === pin.projectPath && row.task.sessionId === pin.sessionId)?.task;
			const fromDefault =
				pin.projectPath === defaultProjectPath
					? defaultTasks.find(t => t.sessionId === pin.sessionId)
					: undefined;
			const task = fromFolder ?? fromDefault;
			if (task && isAutomationTreeTask(task)) return false;
			return (
				projects.some(p => p.path === pin.projectPath) ||
				pin.projectPath === defaultProjectPath
			);
		})
		.map(pin => {
			const fromFolder = projects
				.flatMap(p => (projectTasks[p.id] ?? []).map(t => ({p, t})))
				.find(
					({p, t}) => p.path === pin.projectPath && t.sessionId === pin.sessionId
				);
			const fromDefault = defaultTasks.find(
				t => t.sessionId === pin.sessionId && pin.projectPath === defaultProjectPath
			);
			const task = fromFolder?.t ?? fromDefault;
			return {
				pin,
				taskId: task?.id ?? null,
				main: task ? isMainTask(task, homeIds) : false
			};
		});

	return {
		pinned,
		projectsSectionOpen: ui.projectsSectionOpen,
		groupMode: ui.projectGroupMode,
		sortMode: ui.projectSortMode,
		projects: projectRows,
		flatTasks,
		defaultTasks: visibleDefault,
		defaultProjectPath,
		defaultProjectSnapshot
	};
}
