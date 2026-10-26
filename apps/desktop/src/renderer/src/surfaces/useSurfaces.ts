import {useCallback, useEffect, useMemo, useState} from 'react';
import type {ExtRow} from '@fastllm/bridge-client';
import {surfacesReloadOn} from './surfaceEvents';
import {liveExtIds} from './surfaceSweep';
import {surfaceEntries, type SurfaceEntry} from './surfaceTabs';

/**
 * Declared extension panes, refreshed on mount and on extension set changes.
 * The list is a menu/hint source only — a tab opens from `ext.surface.open`.
 */
export function useSurfaces(): {
	entries: SurfaceEntry[];
	rows: ExtRow[];
	live: Set<string>;
	loaded: boolean;
	reload: () => void;
} {
	const [rows, setRows] = useState<ExtRow[]>([]);
	const [loaded, setLoaded] = useState(false);

	const reload = useCallback(() => {
		void window.fastIde.listExtensions().then(res => {
			if (!res.ok) return;
			setRows(res.extensions);
			setLoaded(true);
		});
	}, []);

	useEffect(() => {
		reload();
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const type = (payload.event as {type?: string}).type;
			// open/state are replay outputs of ListExtensions itself — echoing them back loops forever.
			if (surfacesReloadOn(type)) reload();
		});
		return unsub;
	}, [reload]);

	const entries = useMemo(() => surfaceEntries(rows), [rows]);
	const live = useMemo(() => liveExtIds(rows), [rows]);
	return {entries, rows, live, loaded, reload};
}
