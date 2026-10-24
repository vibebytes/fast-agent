import type {RailTab} from '../railTabs';
import {surfaceTab, upsertSurfaceTab} from './surfaceTabs';

const KEY = 'fast.surfaces.open';

type Stored = {
	extId: string;
	surfaceId: string;
	title: string;
	url?: string;
	roomId?: string;
};

/** Only the instance facts survive a restart; handshake state is re-derived on mount. */
export function serializeSurfaceTabs(tabs: RailTab[]): string {
	const rows: Stored[] = [];
	for (const tab of tabs) {
		const s = tab.surface;
		if (!s?.url) continue;
		rows.push({extId: s.extId, surfaceId: s.surfaceId, title: tab.title, url: s.url, roomId: s.roomId});
	}
	return JSON.stringify(rows);
}

export function readSurfaceTabs(raw: string | null): Stored[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((row): row is Stored => {
			if (!row || typeof row !== 'object') return false;
			const r = row as Record<string, unknown>;
			return (
				typeof r.extId === 'string' &&
				typeof r.surfaceId === 'string' &&
				typeof r.title === 'string' &&
				typeof r.url === 'string'
			);
		});
	} catch {
		return [];
	}
}

export function restoreSurfaceTabs(tabs: RailTab[], raw: string | null): RailTab[] {
	return readSurfaceTabs(raw).reduce((acc, row) => {
		const base = surfaceTab({extId: row.extId, surfaceId: row.surfaceId, title: row.title});
		return upsertSurfaceTab(acc, {
			...base,
			surface: {...base.surface!, url: row.url, roomId: row.roomId}
		});
	}, tabs);
}

export function saveSurfaceTabs(tabs: RailTab[]): void {
	try {
		localStorage.setItem(KEY, serializeSurfaceTabs(tabs));
	} catch {
		// Private mode / quota: losing restore is acceptable, losing the tab is not.
	}
}

export function loadSurfaceTabs(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}
