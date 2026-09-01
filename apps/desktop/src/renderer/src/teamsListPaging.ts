/** Sidebar list page size for Goals / Teams / Agents. */
export const TEAMS_LIST_PAGE_SIZE = 20;

export function pageIndexForId<T extends {id: string}>(
	list: T[],
	id: string | null,
	pageSize: number = TEAMS_LIST_PAGE_SIZE
): number {
	if (!id || pageSize <= 0) return 0;
	const idx = list.findIndex(x => x.id === id);
	if (idx < 0) return 0;
	return Math.floor(idx / pageSize);
}

export function clampPage(
	page: number,
	total: number,
	pageSize: number = TEAMS_LIST_PAGE_SIZE
): number {
	const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
	return Math.min(Math.max(0, page), pages - 1);
}
