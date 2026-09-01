/**
 * Global registry of truncated content (gemini-cli's OverflowContext,
 * hardened). Components that hide lines report here; the layout shows one
 * aggregate "N 行被折叠 · Ctrl+O 展开" hint above the composer.
 *
 * Updates are batched through a microtask-debounced ref so a report during
 * render can never trigger the classic oscillation loop ("hint appears →
 * layout shifts → content fits → hint disappears → layout shifts back…"):
 * state only changes between commits, and equal totals are dropped.
 */
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';

type OverflowState = {
	/** Total hidden lines across all currently mounted truncating components. */
	totalHiddenLines: number;
	/** Number of components currently truncating. */
	sources: number;
};

type OverflowActions = {
	report: (id: string, hiddenLines: number) => void;
	clear: (id: string) => void;
};

const OverflowStateContext = createContext<OverflowState>({totalHiddenLines: 0, sources: 0});
const OverflowActionsContext = createContext<OverflowActions>({
	report: () => undefined,
	clear: () => undefined
});

export function OverflowProvider({children}: {children: React.ReactNode}) {
	const [state, setState] = useState<OverflowState>({totalHiddenLines: 0, sources: 0});
	const registryRef = useRef(new Map<string, number>());
	const flushScheduledRef = useRef(false);

	const scheduleFlush = useCallback(() => {
		if (flushScheduledRef.current) return;
		flushScheduledRef.current = true;
		setTimeout(() => {
			flushScheduledRef.current = false;
			let total = 0;
			let sources = 0;
			for (const hidden of registryRef.current.values()) {
				if (hidden > 0) {
					total += hidden;
					sources += 1;
				}
			}
			setState(previous =>
				previous.totalHiddenLines === total && previous.sources === sources
					? previous
					: {totalHiddenLines: total, sources}
			);
		}, 0);
	}, []);

	const actions = useMemo<OverflowActions>(() => ({
		report: (id, hiddenLines) => {
			if (registryRef.current.get(id) === hiddenLines) return;
			registryRef.current.set(id, hiddenLines);
			scheduleFlush();
		},
		clear: id => {
			if (!registryRef.current.has(id)) return;
			registryRef.current.delete(id);
			scheduleFlush();
		}
	}), [scheduleFlush]);

	return (
		<OverflowActionsContext.Provider value={actions}>
			<OverflowStateContext.Provider value={state}>
				{children}
			</OverflowStateContext.Provider>
		</OverflowActionsContext.Provider>
	);
}

export function useOverflowState(): OverflowState {
	return useContext(OverflowStateContext);
}

/** Report this component's currently hidden line count (0 = nothing hidden). */
export function useOverflowReport(id: string, hiddenLines: number): void {
	const {report, clear} = useContext(OverflowActionsContext);

	useEffect(() => {
		report(id, hiddenLines);
	}, [id, hiddenLines, report]);

	useEffect(() => () => clear(id), [id, clear]);
}
