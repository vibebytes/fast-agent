import type {ExtRow, SurfaceCapability, SurfaceState} from '@fastllm/bridge-client';
import type {RailTab} from '../railTabs';

export type SurfaceTabRef = {
	extId: string;
	surfaceId: string;
	state: SurfaceState;
	capabilities: SurfaceCapability[];
	/** Instance url, only known after `ext.surface.open`. */
	url?: string;
	roomId?: string;
	detail?: string;
};

export type SurfaceEntry = {
	extId: string;
	surfaceId: string;
	title: string;
	order: number;
	state: SurfaceState;
	capabilities: SurfaceCapability[];
};

/** Declared `pane` web surfaces of live extensions, in menu order. mcp-app lands in S2. */
export function surfaceEntries(rows: ExtRow[]): SurfaceEntry[] {
	const out: SurfaceEntry[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (row.phase !== 'Active') continue;
		for (const s of row.provides?.surfaces ?? []) {
			if (s.slot !== 'pane' || s.kind !== 'web') continue;
			const key = `${row.id}:${s.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				extId: row.id,
				surfaceId: s.id,
				title: s.title,
				order: s.order,
				state: s.state,
				capabilities: s.capabilities
			});
		}
	}
	return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.extId.localeCompare(b.extId));
}

export function surfaceTabId(extId: string, surfaceId: string): string {
	return `surface:${extId}:${surfaceId}`;
}

export function surfaceTab(meta: {
	extId: string;
	surfaceId: string;
	title: string;
	capabilities?: SurfaceCapability[];
}): RailTab {
	return {
		id: surfaceTabId(meta.extId, meta.surfaceId),
		kind: 'surface',
		title: meta.title,
		surface: {
			extId: meta.extId,
			surfaceId: meta.surfaceId,
			state: 'unknown',
			capabilities: meta.capabilities ?? []
		}
	};
}

export function surfaceRunnable(state: SurfaceState): boolean {
	return state === 'ready';
}

export function patchSurfaceState(
	tabs: RailTab[],
	ev: {extId: string; surfaceId: string; state: SurfaceState; detail?: string}
): RailTab[] {
	return tabs.map(tab => {
		const s = tab.surface;
		if (!s || s.extId !== ev.extId || s.surfaceId !== ev.surfaceId) return tab;
		return {...tab, surface: {...s, state: ev.state, detail: ev.detail}};
	});
}

export function patchSurfaceOpen(
	tabs: RailTab[],
	ev: {extId: string; surfaceId: string; url: string; roomId?: string}
): RailTab[] {
	return tabs.map(tab => {
		const s = tab.surface;
		if (!s || s.extId !== ev.extId || s.surfaceId !== ev.surfaceId) return tab;
		return {...tab, surface: {...s, url: ev.url, roomId: ev.roomId ?? s.roomId}};
	});
}

/** One tab per surface: a second open reuses the tab and swaps the instance url. */
export function upsertSurfaceTab(tabs: RailTab[], next: RailTab): RailTab[] {
	const idx = tabs.findIndex(tab => tab.id === next.id);
	if (idx < 0) return [...tabs, next];
	const prev = tabs[idx];
	const merged: RailTab = {
		...prev,
		...next,
		surface: {...prev.surface, ...next.surface} as SurfaceTabRef
	};
	return tabs.map((tab, i) => (i === idx ? merged : tab));
}

export function dropSurfaceTabs(tabs: RailTab[], extId: string): RailTab[] {
	return tabs.filter(tab => tab.surface?.extId !== extId);
}
