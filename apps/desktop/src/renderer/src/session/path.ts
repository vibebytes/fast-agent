export function basename(path: string): string {
	const parts = path.split(/[/\\]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/** Join a workspace-relative path onto an absolute root, keeping the root's separator style. */
export function joinWorkspacePath(root: string, relativePath: string): string {
	const sep = root.includes('\\') ? '\\' : '/';
	const parts = relativePath.split(/[/\\]/).filter(Boolean);
	return parts.length > 0 ? `${root.replace(/[\\/]+$/, '')}${sep}${parts.join(sep)}` : root;
}

export function dayGreeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return 'Morning';
	if (hour < 18) return 'Afternoon';
	return 'Evening';
}

/** Split a workspace-relative path into a readable file name and a shortened directory. */
export function pathLabel(path: string): {name: string; dir: string} {
	const parts = path.split(/[/\\]/).filter(Boolean);
	const name = parts[parts.length - 1] ?? path;
	const dir = parts.slice(0, -1);
	if (dir.length <= 2) return {name, dir: dir.join('/')};
	return {name, dir: `${dir[0]}/…/${dir[dir.length - 1]}`};
}
