import {useSyncExternalStore} from 'react';
import type {SlashCatalogEntry} from '@fast-ide/session-view';

let rows: SlashCatalogEntry[] = [];
const listeners = new Set<() => void>();

function emit(next: SlashCatalogEntry[]): void {
	rows = next;
	for (const l of listeners) l();
}

export function dshSkills(): SlashCatalogEntry[] {
	return rows;
}

export function subscribeDshSkills(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function useDshSkills(): SlashCatalogEntry[] {
	return useSyncExternalStore(subscribeDshSkills, dshSkills, dshSkills);
}

export async function refreshDshSkills(sessionId?: string): Promise<boolean> {
	if (!sessionId) {
		emit([]);
		return true;
	}
	const result = await window.fastIde.listDshSkills(sessionId);
	if (!result.ok) return false;
	emit(result.value);
	return true;
}
