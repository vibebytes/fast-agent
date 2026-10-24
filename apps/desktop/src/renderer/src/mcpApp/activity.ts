/** Page-initiated `tools/call` rows (`mcp_app_call`). Transient: never part of the transcript. */

export type McpAppCallEvent = {
	type: 'mcp_app_call';
	server: string;
	tool: string;
	status: string;
	durationMs?: number;
	origin?: string;
	detail?: string;
};

export type AppActivityRow = {
	server: string;
	tool: string;
	status: string;
	durationMs: number;
	detail: string;
	/** Consecutive calls of the same tool collapse into one row. */
	count: number;
};

export function readAppCall(event: {type: string} & Record<string, unknown>): McpAppCallEvent | null {
	if (event.type !== 'mcp_app_call') return null;
	const server = typeof event.server === 'string' ? event.server : '';
	const tool = typeof event.tool === 'string' ? event.tool : '';
	if (!server || !tool) return null;
	return {
		type: 'mcp_app_call',
		server,
		tool,
		status: typeof event.status === 'string' && event.status ? event.status : 'error',
		durationMs: typeof event.durationMs === 'number' ? event.durationMs : 0,
		origin: typeof event.origin === 'string' ? event.origin : 'app',
		detail: typeof event.detail === 'string' ? event.detail : ''
	};
}

export function reduceAppActivity(rows: AppActivityRow[], call: McpAppCallEvent, cap = 50): AppActivityRow[] {
	const last = rows[rows.length - 1];
	const next =
		last && last.server === call.server && last.tool === call.tool
			? [
					...rows.slice(0, -1),
					{
						...last,
						status: call.status,
						durationMs: call.durationMs ?? 0,
						detail: call.detail ?? '',
						count: last.count + 1
					}
				]
			: [
					...rows,
					{
						server: call.server,
						tool: call.tool,
						status: call.status,
						durationMs: call.durationMs ?? 0,
						detail: call.detail ?? '',
						count: 1
					}
				];
	return next.length > cap ? next.slice(next.length - cap) : next;
}

export function activityLabel(row: AppActivityRow): string {
	const base = `${row.server} / ${row.tool}`;
	const calls = row.count > 1 ? ` ×${row.count}` : '';
	const ms = row.durationMs > 0 ? ` · ${row.durationMs}ms` : '';
	return `${base}${calls} · ${row.status}${ms}`;
}
