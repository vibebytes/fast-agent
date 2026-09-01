/** Server path helpers — do not path.resolve (Windows would rewrite /home → C:\home). */

export function stripTrailingSep(p: string): string {
	const s = p.replace(/[/\\]+$/, '');
	return s.length > 0 ? s : p;
}

export function sameRemotePath(a: string, b: string): boolean {
	return stripTrailingSep(a) === stripTrailingSep(b);
}

export function isReservedDefaultFolder(p: string): boolean {
	const base = stripTrailingSep(p).split(/[/\\]/).pop() ?? '';
	return base === '.default_project';
}

export function parentRemotePath(p: string): string {
	const trimmed = stripTrailingSep(p);
	const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (idx <= 0) return trimmed.startsWith('/') ? '/' : trimmed;
	return trimmed.slice(0, idx) || '/';
}

/** POSIX join for a remote host. Do not `path.join` Linux paths on the IDE OS. */
export function joinRemotePath(parent: string, name: string): string {
	const base = stripTrailingSep(parent);
	if (base === '/' || base === '') return `/${name}`;
	return `${base.replace(/\\/g, '/')}/${name}`;
}

/** Single-segment folder name for remote create. Undefined = reject. */
export function hostDirName(raw: string): string | undefined {
	const name = raw.trim();
	if (!name || name === '.' || name === '..') return undefined;
	if (/[/\\]/.test(name) || name.includes('\0')) return undefined;
	if (name === '.default_project') return undefined;
	return name;
}
