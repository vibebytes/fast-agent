/**
 * Catalog / chrome identity for a model pick.
 * Must never treat "this row's display equals this row's own id suffix" as a hit —
 * that made `find()` return the first catalog row (e.g. glm-5.2) for every later
 * pick (manually added glm-5.3), which is the Composer flashback.
 */
export function sameModelRef(a: string | undefined, b: string | undefined): boolean {
	const x = (a ?? '').trim().toLowerCase();
	const y = (b ?? '').trim().toLowerCase();
	if (!x || !y || x === 'default' || y === 'default') return false;
	if (x === y) return true;
	if (!x.includes('/') && y.endsWith(`/${x}`)) return true;
	if (!y.includes('/') && x.endsWith(`/${y}`)) return true;
	return false;
}

export function matchCatalogEntry(
	entry: {id: string; display: string; aliases?: string[]},
	target: string | undefined
): boolean {
	if (!target) return false;
	if (sameModelRef(entry.id, target) || sameModelRef(entry.display, target)) return true;
	return (entry.aliases ?? []).some(a => sameModelRef(a, target));
}
