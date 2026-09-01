/**
 * Subscribe main → renderer workspace pushes into the store.
 * Must run from Bootstrap (above Landing) so restore Focus Change is not lost.
 */
import type {WorkspaceStore} from './workspaceStore';

const taskBodyPulls = new WeakMap<WorkspaceStore, Map<string, Promise<void>>>();

/** Deduplicate body pulls only for the same Task; A in-flight must not absorb B. */
export function pullTaskBodies(
	store: WorkspaceStore,
	taskId: string | null = store.getState().activeTaskId
): Promise<void> {
	const key = taskId ?? '__bootstrap__';
	const pulls = taskBodyPulls.get(store) ?? new Map<string, Promise<void>>();
	taskBodyPulls.set(store, pulls);
	const pending = pulls.get(key);
	if (pending) return pending;
	let request: Promise<void>;
	request = window.fastIde
		.listTasks()
		.then(payload => {
			// An optimistic B focus may request before main has processed B's
			// select. Never let the resulting A snapshot populate the wrong pull.
			if (taskId && payload.activeTaskId !== taskId) return;
			store.dispatch({type: 'tasks:pull', payload});
		})
		.finally(() => {
			if (pulls.get(key) === request) pulls.delete(key);
			if (pulls.size === 0) taskBodyPulls.delete(store);
		});
	pulls.set(key, request);
	return request;
}

export function subscribeWorkspacePush(store: WorkspaceStore): () => void {
	const offProjects = window.fastIde.onProjectsChanged(payload => {
		store.dispatch({type: 'projects:changed', payload});
	});
	const offFocus = window.fastIde.onWorkspaceFocus(payload => {
		store.dispatch({type: 'workspace:focus', payload});
	});
	const offProject = window.fastIde.onProjectChanged(payload => {
		store.dispatch({type: 'project:changed', payload});
	});
	const offTasks = window.fastIde.onTasksChanged(payload => {
		store.dispatch({type: 'tasks:changed', payload});
	});
	const offTranscript = window.fastIde.onTranscriptPatched(payload => {
		store.dispatch({type: 'transcript:patched', payload});
	});
	const offTranscriptTail = window.fastIde.onTranscriptTailPatched(payload => {
		store.dispatch({type: 'transcript:tailPatched', payload});
	});
	const offError = window.fastIde.onBridgeError(payload => {
		store.dispatch({type: 'bridge:error', payload});
	});
	return () => {
		offProjects();
		offFocus();
		offProject();
		offTasks();
		offTranscript();
		offTranscriptTail();
		offError();
	};
}

/** Cold pull fills gaps never written by a push (bodies / pre-push lists). */
export function pullWorkspaceGaps(store: WorkspaceStore): void {
	void window.fastIde.getProject().then(payload => {
		store.dispatch({type: 'projects:pull', payload});
	});
	void pullTaskBodies(store).catch(error => {
		console.error('cold Task body pull failed', error);
	});
}
