import type {ExtRow} from '@fastllm/bridge-client';
import type {RailTab} from '../railTabs';

/** `Uninstalled` rows linger in the ledger; every other phase still belongs to a live extension. */
const DEAD_PHASES = new Set<ExtRow['phase']>(['Uninstalled']);

/**
 * Ext ids the engine still holds, whatever their phase. A menu entry needs `Active` + a pane/web
 * surface, but a tab must survive `Failed` / `Installed` / `Stopping` — install retries and engine
 * restarts walk through them, and closing the tab there is the "tab flashes then vanishes" bug.
 */
export function liveExtIds(rows: readonly ExtRow[]): Set<string> {
	const out = new Set<string>();
	for (const row of rows) {
		if (DEAD_PHASES.has(row.phase)) continue;
		out.add(row.id);
	}
	return out;
}

/**
 * Ext ids that own a surface tab but are absent from the last ListExtensions snapshot.
 * Absence is a hint, never proof: the snapshot is a menu projection that can be stale, so the
 * caller must confirm each id (`extensionStatus`) before closing anything.
 */
export function unlistedSurfaceExtIds(tabs: readonly RailTab[], live: ReadonlySet<string>): string[] {
	const out: string[] = [];
	for (const tab of tabs) {
		const extId = tab.surface?.extId;
		if (!extId || live.has(extId) || out.includes(extId)) continue;
		out.push(extId);
	}
	return out;
}
