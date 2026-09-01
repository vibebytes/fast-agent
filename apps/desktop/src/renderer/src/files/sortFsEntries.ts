export type SortableFsEntry = {name: string; kind: 'dir' | 'file'};

/** Dirs first, then name (locale-aware). Host List returns unsorted. */
export function sortFsEntries<T extends SortableFsEntry>(entries: T[]): T[] {
	return [...entries].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}
