/**
 * Reactive terminal dimensions. Components must use this hook instead of
 * reading `process.stdout.columns/rows` at render time, so a terminal resize
 * triggers a coherent re-render of the whole tree in one pass.
 *
 * All subscribers share ONE process.stdout 'resize' listener (attached
 * lazily, detached when the last subscriber unmounts). Per-component
 * listeners would scale with message count and trip Node's
 * MaxListenersExceededWarning at 10.
 */
import {useSyncExternalStore} from 'react';

export type TerminalSize = {
	columns: number;
	rows: number;
};

export function currentTerminalSize(): TerminalSize {
	return {
		columns: process.stdout.columns ?? 80,
		rows: process.stdout.rows ?? 24
	};
}

let cachedSize: TerminalSize = currentTerminalSize();
const subscribers = new Set<() => void>();
let attached = false;

function handleResize(): void {
	cachedSize = currentTerminalSize();
	for (const notify of subscribers) notify();
}

/** Shared resize subscription — one OS-level listener for the whole app. */
export function subscribeResize(notify: () => void): () => void {
	subscribers.add(notify);
	if (!attached) {
		attached = true;
		// Catch up on resizes that happened while nobody was subscribed.
		cachedSize = currentTerminalSize();
		process.stdout.on('resize', handleResize);
	}
	return () => {
		subscribers.delete(notify);
		if (subscribers.size === 0 && attached) {
			attached = false;
			process.stdout.off('resize', handleResize);
		}
	};
}

/** Stable snapshot object — only replaced on actual resize events. */
function getSnapshot(): TerminalSize {
	return cachedSize;
}

export function useTerminalSize(): TerminalSize {
	return useSyncExternalStore(subscribeResize, getSnapshot);
}
