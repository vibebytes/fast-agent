export type PinnedTaskRef = {
	projectPath: string;
	sessionId: string;
	title: string;
};

export type ArchivedTaskRef = {
	projectPath: string;
	sessionId: string;
};

export type ProjectGroupMode = 'byProject' | 'flat';
export type ProjectSortMode = 'priority' | 'recent' | 'manual';

export type SidebarUiState = {
	expandedProjectPaths: string[];
	pinnedProjectPaths: string[];
	pinnedTasks: PinnedTaskRef[];
	archivedTasks: ArchivedTaskRef[];
	/** Whether the entire Projects section is expanded. */
	projectsSectionOpen: boolean;
	projectGroupMode: ProjectGroupMode;
	projectSortMode: ProjectSortMode;
};

const STORAGE_KEY = 'fast-ide.sidebar-ui';

const EMPTY: SidebarUiState = {
	expandedProjectPaths: [],
	pinnedProjectPaths: [],
	pinnedTasks: [],
	archivedTasks: [],
	projectsSectionOpen: true,
	projectGroupMode: 'byProject',
	projectSortMode: 'priority'
};

function read(): SidebarUiState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {...EMPTY};
		const parsed = JSON.parse(raw) as Partial<SidebarUiState>;
		return {
			expandedProjectPaths: Array.isArray(parsed.expandedProjectPaths)
				? parsed.expandedProjectPaths.filter(p => typeof p === 'string')
				: [],
			pinnedProjectPaths: Array.isArray(parsed.pinnedProjectPaths)
				? parsed.pinnedProjectPaths.filter(p => typeof p === 'string')
				: [],
			pinnedTasks: Array.isArray(parsed.pinnedTasks)
				? parsed.pinnedTasks.filter(
						(t): t is PinnedTaskRef =>
							Boolean(t) &&
							typeof t === 'object' &&
							typeof (t as PinnedTaskRef).projectPath === 'string' &&
							typeof (t as PinnedTaskRef).sessionId === 'string' &&
							typeof (t as PinnedTaskRef).title === 'string'
					)
				: [],
			archivedTasks: Array.isArray(parsed.archivedTasks)
				? parsed.archivedTasks.filter(
						(t): t is ArchivedTaskRef =>
							Boolean(t) &&
							typeof t === 'object' &&
							typeof (t as ArchivedTaskRef).projectPath === 'string' &&
							typeof (t as ArchivedTaskRef).sessionId === 'string'
					)
				: [],
			projectsSectionOpen: parsed.projectsSectionOpen !== false,
			projectGroupMode: parsed.projectGroupMode === 'flat' ? 'flat' : 'byProject',
			projectSortMode:
				parsed.projectSortMode === 'recent' || parsed.projectSortMode === 'manual'
					? parsed.projectSortMode
					: 'priority'
		};
	} catch {
		return {...EMPTY};
	}
}

const listeners = new Set<() => void>();

function write(state: SidebarUiState, notify: boolean): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	if (!notify) return;
	queueMicrotask(() => {
		for (const listener of listeners) listener();
	});
}

export function subscribeSidebarUiState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function loadSidebarUiState(): SidebarUiState {
	return read();
}

/** Persist chrome. Pass `notify: false` when the writer already applied state locally (avoids echo re-render). */
export function saveSidebarUiState(state: SidebarUiState, notify = true): void {
	write(state, notify);
}

export function taskKey(projectPath: string, sessionId: string): string {
	return `${projectPath}::${sessionId}`;
}

export function isArchived(
	archived: ArchivedTaskRef[],
	projectPath: string,
	sessionId: string | null | undefined
): boolean {
	if (!sessionId) return false;
	return archived.some(a => a.projectPath === projectPath && a.sessionId === sessionId);
}

export function isPinnedTask(
	pinned: PinnedTaskRef[],
	projectPath: string,
	sessionId: string | null | undefined
): boolean {
	if (!sessionId) return false;
	return pinned.some(p => p.projectPath === projectPath && p.sessionId === sessionId);
}
