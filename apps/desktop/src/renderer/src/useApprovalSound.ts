import {useEffect} from 'react';
import {playApprovalSound} from './completionSound';
import {settingsStore, useSettings} from './settings/useSettings';
import type {WorkspaceStore} from './workspaceStore';

export function approvalKey(taskId: string, approvalId: string): string {
	return `${taskId}\0${approvalId}`;
}

/** Record live approval ids; return keys that were not seen before. Evicted tasks keep their keys. */
export function takeNewApprovals(
	seen: Set<string>,
	byTaskId: Record<string, {approvals: Array<{id: string}>}>
): string[] {
	const added: string[] = [];
	const liveByTask = new Map<string, Set<string>>();
	for (const [taskId, slice] of Object.entries(byTaskId)) {
		const live = new Set<string>();
		for (const a of slice.approvals) {
			const key = approvalKey(taskId, a.id);
			live.add(key);
			if (!seen.has(key)) {
				seen.add(key);
				added.push(key);
			}
		}
		liveByTask.set(taskId, live);
	}
	for (const key of [...seen]) {
		const sep = key.indexOf('\0');
		if (sep < 0) continue;
		const taskId = key.slice(0, sep);
		const live = liveByTask.get(taskId);
		if (live && !live.has(key)) seen.delete(key);
	}
	return added;
}

/** Play when a new approval card lands after the first snapshot. */
export function useApprovalSound(store: WorkspaceStore, engineReady: boolean): void {
	useSettings(engineReady);
	useEffect(() => {
		const seen = new Set<string>();
		let seeded = false;
		const scan = () => {
			const added = takeNewApprovals(seen, store.getState().byTaskId);
			if (!seeded) {
				seeded = true;
				return;
			}
			if (added.length > 0 && settingsStore.getSnapshot().general.approvalSound) {
				void playApprovalSound();
			}
		};
		scan();
		return store.subscribe(scan);
	}, [store]);
}
