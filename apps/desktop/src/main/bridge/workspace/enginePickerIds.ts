import type {EngineWireRow} from '@fast-ide/session-view';

/** Composer picker: running, or enabled+installed and about to register. */
export function switchableEngine(row: EngineWireRow): boolean {
	if (row.inRegistry) return true;
	if (row.adapter !== 'ready') return false;
	return row.program === 'installed' || row.program === 'builtin' || row.process === 'running';
}

export function pickerEngineIds(rows: EngineWireRow[]): string[] {
	const ids = new Set<string>(['fast']);
	for (const row of rows) {
		const id = row.id.trim().toLowerCase();
		if (!id || !switchableEngine(row)) continue;
		ids.add(id);
	}
	return [...ids];
}
