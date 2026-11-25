import type {
	CreateWorkspaceDirResult,
	DeleteWorkspaceFileResult,
	SaveWorkspaceFileResult
} from '@fast-ide/session-view';

export type FileTreeEntry = {
	name: string;
	kind: 'dir' | 'file';
	relativePath: string;
};

type CreateFileApi = {
	saveWorkspaceFile: (
		relativePath: string,
		content: string,
		mtime?: number,
		bytes?: number
	) => Promise<SaveWorkspaceFileResult>;
};

type CreateDirApi = {
	createWorkspaceDir: (relativePath: string) => Promise<CreateWorkspaceDirResult>;
};

export function createWorkspaceFolder(
	entry: FileTreeEntry,
	name: string,
	api: CreateDirApi
): Promise<CreateWorkspaceDirResult> {
	return api.createWorkspaceDir(newFilePath(entry, name));
}

type DeleteFileApi = {
	deleteWorkspaceFile: (
		relativePath: string,
		recursive?: boolean
	) => Promise<DeleteWorkspaceFileResult>;
};

export function newFilePath(entry: FileTreeEntry, name: string): string {
	const trimmed = name.trim();
	if (
		!trimmed ||
		trimmed === '.' ||
		trimmed === '..' ||
		trimmed.includes('/') ||
		trimmed.includes('\\') ||
		trimmed.includes('\0')
	) {
		throw new Error('File name must be a single path segment');
	}
	const normalized = entry.relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
	const parent = entry.kind === 'dir' ? normalized : normalized.split('/').slice(0, -1).join('/');
	return parent ? `${parent}/${trimmed}` : trimmed;
}

export function createWorkspaceFile(
	entry: FileTreeEntry,
	name: string,
	api: CreateFileApi
): Promise<SaveWorkspaceFileResult> {
	return api.saveWorkspaceFile(newFilePath(entry, name), '', undefined, undefined);
}

export async function deleteWorkspaceEntry(
	entry: FileTreeEntry,
	confirm: (entry: FileTreeEntry) => Promise<boolean>,
	api: DeleteFileApi
): Promise<DeleteWorkspaceFileResult | null> {
	if (!(await confirm(entry))) return null;
	try {
		return await api.deleteWorkspaceFile(entry.relativePath, entry.kind === 'dir');
	} catch (err) {
		return {ok: false, error: err instanceof Error ? err.message : String(err)};
	}
}

function normalizeTreePath(p: string): string {
	const t = p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
	return t === '.' ? '' : t;
}

export function parentDirOf(relativePath: string): string {
	const normalized = normalizeTreePath(relativePath);
	const idx = normalized.lastIndexOf('/');
	return idx <= 0 ? '.' : normalized.slice(0, idx);
}

export function withExpandedDir(expanded: Iterable<string>, dir: string): Set<string> {
	const next = new Set(expanded);
	const key = normalizeTreePath(dir);
	if (key) next.add(key);
	return next;
}

export function prunedPaths(paths: Iterable<string>, deleted: string): Set<string> {
	const key = normalizeTreePath(deleted);
	const survivors = new Set<string>();
	for (const path of paths) {
		const normalized = normalizeTreePath(path);
		if (normalized !== key && !normalized.startsWith(`${key}/`)) survivors.add(path);
	}
	return survivors;
}
