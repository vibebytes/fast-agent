import {useCallback, useEffect, useState} from 'react';
import {surfacesReloadOn} from './surfaceEvents';
import {surfaceEntries, type SurfaceEntry} from './surfaceTabs';

/**
 * Declared extension panes, refreshed on mount and on extension set changes.
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
			// open/state are replay outputs of ListExtensions itself — echoing them back loops forever.
			if (surfacesReloadOn(type)) reload();
		});
		return unsub;
	}, [reload]);

	return {entries, loaded};
}
