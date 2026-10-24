import {useEffect, useRef, useSyncExternalStore} from 'react';
import {mcpAppCatalog, type McpAppCatalogState} from './catalog';

/**
 * The shared app catalog. `revision` is any string that changes when the engine's server list may
 * have; a change forces a re-list even while a previous request is still in flight.
 */
export function useMcpAppCatalog(enabled = true, revision = ''): McpAppCatalogState {
	const state = useSyncExternalStore(mcpAppCatalog.subscribe, mcpAppCatalog.get, mcpAppCatalog.get);
	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (!enabled) return;
		const force = seen.current !== null && seen.current !== revision;
		seen.current = revision;
		void mcpAppCatalog.load({force});
	}, [enabled, revision]);
	return state;
}
