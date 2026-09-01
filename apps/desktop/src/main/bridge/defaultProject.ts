import {realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

/**
 * Hidden Default Project root — Tasks mount point only; never a folder Project
 * in the 项目 sidebar. Canonical name is `.default_project` (underscore).
 */
export function defaultProjectPath(home = homedir()): string {
	return path.join(home, 'fast_workspace', '.default_project');
}

/** POSIX Tasks root on a remote host. Do not `path.resolve` Linux paths on the IDE OS. */
export function defaultProjectPathOnHost(home: string): string {
	const h = home.replace(/[/\\]+$/, '').replace(/\\/g, '/');
	return `${h}/fast_workspace/.default_project`;
}

function samePath(a: string, b: string): boolean {
	if (process.platform === 'darwin' || process.platform === 'win32') {
		return a.toLowerCase() === b.toLowerCase();
	}
	return a === b;
}

function resolveExisting(raw: string): string {
	const abs = path.resolve(raw);
	try {
		return path.resolve(realpathSync(abs));
	} catch {
		return abs;
	}
}

/** True when `candidate` is the hidden Default Project (Tasks host), not a folder Project. */
export function isDefaultProjectPath(candidate: string, home = homedir()): boolean {
	const resolved = resolveExisting(candidate);
	const canonical = resolveExisting(defaultProjectPath(home));
	return samePath(resolved, canonical);
}
