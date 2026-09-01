import type {
	GitFileChange,
	GitFileChangeKind,
	ReviewKind,
	ReviewList
} from '@fast-ide/session-view';

/**
 * How the file tree marks a path.
 *
 * Two independent sources, deliberately not merged into one badge: git says how the file differs from
 * the last commit, while the agent overlay says the change is still awaiting a keep-or-undo decision.
 * A file can be both, and collapsing them would lose the only one the user can act on here.
 */

const gitRank: Record<GitFileChangeKind, number> = {
	modified: 1,
	added: 2,
	deleted: 3
};

/** Renames outrank the rest: they are the one kind whose two rows must be read together. */
const agentRank: Record<ReviewKind, number> = {
	modified: 1,
	added: 2,
	deleted: 3,
	renamed: 4
};

function normalizeTreePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function gitFilesMap(files: GitFileChange[] | undefined): Map<string, GitFileChangeKind> {
	const map = new Map<string, GitFileChangeKind>();
	if (!files) return map;
	for (const f of files) {
		const path = normalizeTreePath(f.path);
		if (!path) continue;
		const prev = map.get(path);
		if (!prev || gitRank[f.kind] > gitRank[prev]) map.set(path, f.kind);
	}
	return map;
}

/**
 * Kind for a tree row. Files under an untracked dir (`?? dir/` only) inherit `added`.
 */
export function gitKindAt(
	path: string,
	files: ReadonlyMap<string, GitFileChangeKind>
): GitFileChangeKind | null {
	const p = normalizeTreePath(path);
	const direct = files.get(p);
	if (direct) return direct;
	let best: GitFileChangeKind | null = null;
	for (const [key, kind] of files) {
		if (kind !== 'added') continue;
		if (!p.startsWith(`${key}/`)) continue;
		if (!best || gitRank[kind] > gitRank[best]) best = kind;
	}
	return best;
}

/**
 * Paths the agent changed and nobody has decided on yet.
 *
 * Kept and reverted rows are left out on purpose: a kept change is the user's own file now, and a
 * reverted one is not in the tree at all, so marking either would be noise that never clears.
 */
export function agentFilesMap(list: ReviewList | undefined): Map<string, ReviewKind> {
	const map = new Map<string, ReviewKind>();
	if (!list) return map;
	for (const change of list.changes) {
		if (change.state.kind !== 'pending' && change.state.kind !== 'conflict') continue;
		map.set(change.path.replace(/\\/g, '/'), change.kind);
	}
	return map;
}

/** Worst kind among files under `dirPath` (prefix match). */
function worstUnder<K extends string>(
	dirPath: string,
	files: ReadonlyMap<string, K>,
	rank: Record<K, number>
): K | null {
	const normalizedDir = normalizeTreePath(dirPath);
	const prefix = normalizedDir ? `${normalizedDir}/` : '';
	let best: K | null = null;
	for (const [path, kind] of files) {
		const normalized = normalizeTreePath(path);
		const under =
			normalizedDir === '' ? true : normalized === normalizedDir || normalized.startsWith(prefix);
		if (!under) continue;
		if (!best || rank[kind] > rank[best]) best = kind;
	}
	return best;
}

export function aggregateDirKind(
	dirPath: string,
	files: ReadonlyMap<string, GitFileChangeKind>
): GitFileChangeKind | null {
	return worstUnder(dirPath, files, gitRank);
}

export function aggregateAgentKind(
	dirPath: string,
	files: ReadonlyMap<string, ReviewKind>
): ReviewKind | null {
	return worstUnder(dirPath, files, agentRank);
}

export function gitDotClass(kind: GitFileChangeKind): string {
	switch (kind) {
		case 'added':
			return 'bg-emerald-500';
		case 'deleted':
			return 'bg-red-500';
		case 'modified':
			return 'bg-amber-500';
	}
}

/** Filename tint — dots alone are easy to miss at 6px. */
export function gitNameClass(kind: GitFileChangeKind): string {
	switch (kind) {
		case 'added':
			return 'text-emerald-600 dark:text-emerald-400';
		case 'deleted':
			return 'text-red-600 dark:text-red-400 line-through';
		case 'modified':
			return 'text-amber-700 dark:text-amber-400';
	}
}

/** A hollow marker, so the agent overlay reads as a different axis from the solid git dot. */
export function agentDotClass(): string {
	return 'border border-violet-500 bg-violet-500/25';
}

export function agentDotLabel(kind: ReviewKind): string {
	return `Agent ${kind} — awaiting review`;
}
