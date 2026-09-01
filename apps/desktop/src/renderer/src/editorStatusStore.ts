import {useSyncExternalStore} from 'react';
import type {EditorCursorStatus} from './MonacoEditor';

/**
 * Editor cursor status sinks straight to StatusBar (perf doc P2-14): routing it
 * through App state re-rendered the whole shell on every Monaco cursor move.
 * Type-only MonacoEditor import — erased, does not pull monaco into this chunk.
 */
let status: EditorCursorStatus | null = null;
const listeners = new Set<() => void>();

export function publishEditorStatus(next: EditorCursorStatus | null): void {
	status = next;
	for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const snapshot = (): EditorCursorStatus | null => status;

export function useEditorStatus(): EditorCursorStatus | null {
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}
