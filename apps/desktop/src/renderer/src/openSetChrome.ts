/**
 * Client-local Open Tab open-set prefs (ADR-0017).
 * Distinct from Engine Meta and from Engine open-Project / Workspace Restore.
 */
import {
	emptyOpenSet,
	parseOpenSetChrome,
	serializeOpenSet,
	type OpenSet,
	type OpenSetChrome,
	type OpenSetInventory
} from './openSet.js';

/** Prefs key — open-set chrome only; never Engine Meta. */
const STORAGE_KEY = 'fast-ide.open-tab-set';

export function loadOpenSetChrome(inventory: OpenSetInventory): OpenSet {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyOpenSet();
		const parsed = JSON.parse(raw) as OpenSetChrome;
		return parseOpenSetChrome(parsed, inventory);
	} catch {
		return emptyOpenSet();
	}
}

export function saveOpenSetChrome(set: OpenSet): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeOpenSet(set)));
}
