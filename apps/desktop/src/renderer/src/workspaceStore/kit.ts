/** workspaceStore.test fixtures. */
import {
	initialWorkspaceState,
	reduceWorkspace,
	type WorkspaceEvent,
	type WorkspaceState
} from '../workspaceStore.js';

export const idleGate = {
	runState: 'idle' as const,
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};
export const runningGate = {
	...idleGate,
	runState: 'running' as const,
	canCancel: true,
	canEnqueue: true
};
export function fold(events: WorkspaceEvent[], start: WorkspaceState = initialWorkspaceState()): WorkspaceState {
	return events.reduce((s, e) => reduceWorkspace(s, e), start);
}
export function tasksMeta(partial: {
	activeTaskId: string | null;
	gate?: typeof idleGate;
	queue?: Array<{id: string; text: string}>;
}): WorkspaceEvent {
	return {
		type: 'tasks:changed',
		payload: {
			tasks: partial.activeTaskId
				? [{id: partial.activeTaskId, title: 'T', active: true}]
				: [],
			chats: [],
			defaultTasks: [],
			activeTaskId: partial.activeTaskId,
			activeKind: 'task',
			gate: partial.gate ?? idleGate,
			model: 'default',
			modelDisplay: 'Default',
			modelCatalog: [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: partial.queue ?? [],
			queuePaused: false
		}
	};
}
export function tasksPull(partial: {
	activeTaskId: string | null;
	bodyRevision?: number;
	model?: string;
	modelDisplay?: string;
	modelCatalog?: WorkspaceState['modelCatalog'];
	entries?: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>;
}): WorkspaceEvent {
	return {
		type: 'tasks:pull',
		payload: {
			tasks: [],
			chats: [],
			defaultTasks: [],
			activeTaskId: partial.activeTaskId,
			bodyRevision: partial.bodyRevision,
			activeKind: 'task',
			gate: idleGate,
			model: partial.model ?? 'default',
			modelDisplay: partial.modelDisplay ?? 'Default',
			modelCatalog: partial.modelCatalog ?? [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: [],
			queuePaused: false,
			transcript: partial.entries ?? [],
			approvals: [],
			questions: [],
			codeChanges: []
		}
	};
}
export function patch(
	taskId: string,
	entries: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>,
	gate = idleGate,
	bodyRevision?: number
): WorkspaceEvent {
	return {
		type: 'transcript:patched',
		payload: {
			taskId,
			bodyRevision,
			entries,
			approvals: [],
			questions: [],
			codeChanges: [],
			gate
		}
	};
}
export function focus(partial: {
	focusEpoch?: number;
	activeTaskId: string | null;
	bodyRevision?: number;
	slim?: boolean;
	activeProjectId?: string | null;
	gate?: typeof idleGate;
	queue?: Array<{id: string; text: string}>;
	transcript?: Array<{
		id: string;
		role: 'user' | 'assistant';
		text: string;
		status: 'streaming' | 'done' | 'error' | 'cancelled';
	}>;
	tasks?: Array<{id: string; title: string; active: boolean}>;
	defaultTasks?: Array<{id: string; title: string; sessionId?: string; active: boolean}>;
	goalCard?: import('../env').GoalCardView | null;
}): WorkspaceEvent {
	const activeTaskId = partial.activeTaskId;
	return {
		type: 'workspace:focus',
		payload: {
			focusEpoch: partial.focusEpoch ?? 1,
			projects: partial.activeProjectId
				? [{id: partial.activeProjectId, path: '/p', status: 'ready', active: true}]
				: [],
			activeProjectId: partial.activeProjectId ?? null,
			project: partial.activeProjectId
				? {id: partial.activeProjectId, path: '/p', status: 'ready'}
				: null,
			tasks:
				partial.tasks ??
				(activeTaskId ? [{id: activeTaskId, title: 'T', active: true}] : []),
			chats: [],
			defaultTasks: partial.defaultTasks ?? [],
			activeTaskId,
			bodyRevision: partial.bodyRevision,
			activeKind: activeTaskId ? 'task' : null,
			gate: partial.gate ?? idleGate,
			model: 'default',
			modelDisplay: 'Default',
			modelCatalog: [],
			slashCatalog: [],
			slashCatalogHydrated: false,
			queue: partial.queue ?? [],
			queuePaused: false,
			...(partial.slim
				? {}
				: {
						transcript: partial.transcript ?? [],
						approvals: [],
						questions: [],
						codeChanges: []
					}),
			goalCard: partial.goalCard ?? null
		}
	};
}
export function entry(
	id: string,
	text: string,
	status: 'streaming' | 'done' = 'done',
	role: 'user' | 'assistant' = 'assistant'
) {
	return {id, role, text, status};
}
export function tailPatched(
	taskId: string,
	partial: {
		from: number;
		total: number;
		entries: ReturnType<typeof entry>[];
		gate?: typeof idleGate;
		approvals?: unknown[];
		codeChanges?: unknown[];
		goalCard?: import('../env').GoalCardView | null;
	}
): WorkspaceEvent {
	return {
		type: 'transcript:tailPatched',
		payload: {
			taskId,
			from: partial.from,
			total: partial.total,
			entries: partial.entries,
			gate: partial.gate ?? idleGate,
			...(partial.approvals ? {approvals: partial.approvals} : {}),
			...(partial.codeChanges ? {codeChanges: partial.codeChanges} : {}),
			...(partial.goalCard !== undefined ? {goalCard: partial.goalCard} : {})
		}
	} as WorkspaceEvent;
}
export function slimFocus(partial: {
	focusEpoch?: number;
	activeTaskId: string | null;
	bodyRevision?: number;
	goalCard?: import('../env').GoalCardView | null;
}): WorkspaceEvent {
	const full = focus({
		focusEpoch: partial.focusEpoch,
		activeTaskId: partial.activeTaskId,
		bodyRevision: partial.bodyRevision,
		goalCard: partial.goalCard
	}) as {type: 'workspace:focus'; payload: Record<string, unknown>};
	const {transcript: _t, approvals: _a, questions: _q, codeChanges: _c, ...slim} = full.payload;
	return {type: 'workspace:focus', payload: slim} as WorkspaceEvent;
}
