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
