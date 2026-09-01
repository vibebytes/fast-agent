import {useSyncExternalStore} from 'react';
import {detectTerminalCapabilities} from '../terminal/capabilityManager.js';
import {subscribeResize} from './useTerminalSize.js';

export const SPLIT_PANE_MIN_WIDTH = 120;

export function useTerminalWidth(): number {
	// Piggybacks on the shared resize subscription (single OS listener).
	// Snapshot is a primitive, so re-reading capabilities on render is safe.
	return useSyncExternalStore(subscribeResize, () => detectTerminalCapabilities().width);
}

export function useSplitPaneEnabled(minWidth = SPLIT_PANE_MIN_WIDTH): boolean {
	const width = useTerminalWidth();
	return width >= minWidth;
}
