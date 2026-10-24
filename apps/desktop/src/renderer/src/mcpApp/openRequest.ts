/** Settings → workbench hand-off: `RightWorkbench` owns the tab list, settings only asks. */
export type McpAppOpenRequest = {
	server: string;
	resourceUri: string;
	title: string;
};

const listeners = new Set<(request: McpAppOpenRequest) => void>();

export function requestOpenMcpApp(request: McpAppOpenRequest): void {
	for (const fn of listeners) fn(request);
}

export function onOpenMcpApp(fn: (request: McpAppOpenRequest) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
