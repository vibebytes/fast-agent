import {useCallback, useEffect, useState} from 'react';
import {surfaceEntries, type SurfaceEntry} from './surfaceTabs';

/**
 * Declared extension panes, refreshed on mount and whenever a surface event lands.
 * The list is a menu/hint source only — a tab opens from `ext.surface.open`.
 */
export function useSurfaces(): {entries: SurfaceEntry[]; loaded: boolean} {
	const [entries, setEntries] = useState<SurfaceEntry[]>([]);
	const [loaded, setLoaded] = useState(false);

	const reload = useCallback(() => {
		void window.fastIde.listExtensions().then(res => {
			if (!res.ok) return;
			setEntries(surfaceEntries(res.extensions));
			setLoaded(true);
		});
	}, []);

	useEffect(() => {
		reload();
		const unsub = window.fastIde.onBridgeEvent(payload => {
			const type = (payload.event as {type?: string}).type;
			if (type === 'surface_open' || type === 'surface_state' || type === 'extensions_changed') reload();
		});
		return unsub;
	}, [reload]);

	return {entries, loaded};
}
