import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type DirEntryKind = 'dir' | 'file';

export type DirEntry = {
	name: string;
	kind: DirEntryKind;
	/** Path relative to project root, POSIX separators. */
	relativePath: string;
};

export type ListDirResult =
	| {
			ok: true;
			root: string;
			relativePath: string;
			entries: DirEntry[];
	  }
	| {
			ok: false;
			error: string;
			entries: [];
	  };

export type ReadFileResult =
	| {
			ok: true;
			relativePath: string;
			content: string;
	  }
	| {
			ok: false;
			error: string;
	  };

export type ReadMediaResult =
	| {
			ok: true;
			relativePath: string;
			mimeType: string;
			/** `data:<mime>;base64,…` for <img src>. */
			dataUrl: string;
	  }
	| {
			ok: false;
			error: string;
	  };

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon'
};

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

/** Ensure `target` stays inside `root` (after resolve). */
export function isPathInsideRoot(root: string, target: string): boolean {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(target);
	const rel = path.relative(resolvedRoot, resolvedTarget);
	return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Resolve a project-relative path, absolute path, or `file://` URL to a file
 * that must stay inside `projectRoot`.
 */
export function resolveInsideProject(
	projectRoot: string,
	requestedPath: string
):
	| {ok: true; root: string; target: string; relativePath: string}
	| {ok: false; error: string} {
	const root = path.resolve(projectRoot);
	let raw = requestedPath.trim();
	if (!raw) {
		return {ok: false, error: 'Missing path'};
	}

	if (/^file:/i.test(raw)) {
		try {
			raw = fileURLToPath(raw);
		} catch {
			return {ok: false, error: 'Invalid file URL'};
		}
	}

	if (path.isAbsolute(raw)) {
		const target = path.resolve(raw);
		if (!isPathInsideRoot(root, target)) {
			return {ok: false, error: 'Path outside project'};
		}
		return {
			ok: true,
			root,
			target,
			relativePath: toPosix(path.relative(root, target))
		};
	}

	const cleaned = raw.replace(/^\.\//, '').replace(/^[/\\]+/, '');
	if (!cleaned) {
		return {ok: false, error: 'Missing path'};
	}
	const target = path.resolve(root, cleaned);
	if (!isPathInsideRoot(root, target)) {
		return {ok: false, error: 'Path outside project'};
	}
	return {ok: true, root, target, relativePath: toPosix(cleaned)};
}

export async function listProjectDir(
	projectRoot: string,
	relativePath = ''
): Promise<ListDirResult> {
	const root = path.resolve(projectRoot);
	const cleaned = relativePath.replace(/^[/\\]+/, '');
	const target = cleaned ? path.resolve(root, cleaned) : root;

	if (!isPathInsideRoot(root, target)) {
		return {ok: false, error: 'Path outside project', entries: []};
	}

	try {
		const dirents = await readdir(target, {withFileTypes: true});
		const baseRel = cleaned ? toPosix(cleaned) : '';
		const entries: DirEntry[] = dirents
			.map(d => {
				const kind: DirEntryKind = d.isDirectory() ? 'dir' : 'file';
				const relative = baseRel ? `${baseRel}/${d.name}` : d.name;
				return {name: d.name, kind, relativePath: relative};
			})
			.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
				return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
			});

		return {
			ok: true,
			root,
			relativePath: baseRel,
			entries
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {ok: false, error: message, entries: []};
	}
}

export async function readProjectFile(
	projectRoot: string,
	relativePath: string
): Promise<ReadFileResult> {
	const resolved = resolveInsideProject(projectRoot, relativePath);
	if (!resolved.ok) return resolved;

	try {
		const info = await stat(resolved.target);
		if (!info.isFile()) {
			return {ok: false, error: 'Not a file'};
		}
		if (info.size > MAX_TEXT_BYTES) {
			return {ok: false, error: `File too large (>${MAX_TEXT_BYTES / 1024 / 1024}MB)`};
		}
		const buf = await readFile(resolved.target);
		if (buf.includes(0)) {
			return {ok: false, error: 'Binary file cannot be opened as text'};
		}
		return {
			ok: true,
			relativePath: resolved.relativePath,
			content: buf.toString('utf8')
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {ok: false, error: message};
	}
}

export function mimeTypeForImagePath(filePath: string): string | undefined {
	const ext = path.extname(filePath).toLowerCase();
	return IMAGE_MIME[ext];
}

/** Read an image under the project root as a data URL for the renderer. */
export async function readProjectMedia(
	projectRoot: string,
	relativePath: string
): Promise<ReadMediaResult> {
	const resolved = resolveInsideProject(projectRoot, relativePath);
	if (!resolved.ok) return resolved;

	const mimeType = mimeTypeForImagePath(resolved.target);
	if (!mimeType) {
		return {ok: false, error: 'Unsupported image type'};
	}

	try {
		const info = await stat(resolved.target);
		if (!info.isFile()) {
			return {ok: false, error: 'Not a file'};
		}
		if (info.size > MAX_MEDIA_BYTES) {
			return {ok: false, error: `Image too large (>${MAX_MEDIA_BYTES / 1024 / 1024}MB)`};
		}
		const buf = await readFile(resolved.target);
		return {
			ok: true,
			relativePath: resolved.relativePath,
			mimeType,
			dataUrl: `data:${mimeType};base64,${buf.toString('base64')}`
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {ok: false, error: message};
	}
}
