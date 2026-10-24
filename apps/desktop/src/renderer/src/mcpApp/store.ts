/** Renderer-side fan-out for `mcp_app_result` / `mcp_app_cancelled` / `mcp_app_call`.
 *
 * The events are transient (no transcript entry), so they are not in the workspace store: each
 * open tab subscribes by key and keeps its own delivery state.
 */
import {readAppCall, reduceAppActivity, type AppActivityRow} from './activity';

export type McpAppResultEvent = {
	sessionId?: string;
	server: string;
	resourceUri: string;
	toolCallId: string;
	tool: string;
	arguments: unknown;
	content: unknown[];
	structuredContent?: unknown;
	meta?: Record<string, unknown>;
	isError: boolean;
};

export type McpAppCancelEvent = {
	sessionId?: string;
	server: string;
	resourceUri: string;
	toolCallId: string;
};

export type McpAppEvent =
	| {kind: 'result'; result: McpAppResultEvent}
	| {kind: 'cancelled'; cancel: McpAppCancelEvent};

export function appKey(server: string, resourceUri: string): string {
	return `${server}\u0000${resourceUri}`;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Untrusted wire → typed event, or null. Nothing here is trusted enough to throw. */
export function parseAppEvent(raw: unknown): {key: string; event: McpAppEvent} | null {
	if (!raw || typeof raw !== 'object') return null;
	const e = raw as Record<string, unknown>;
	const server = text(e.server);
	const resourceUri = text(e.resourceUri);
	const toolCallId = text(e.toolCallId);
	if (!server || !resourceUri || !toolCallId) return null;
	const sessionId = text(e.sessionId) || undefined;
	if (e.type === 'mcp_app_cancelled') {
		return {key: appKey(server, resourceUri), event: {kind: 'cancelled', cancel: {sessionId, server, resourceUri, toolCallId}}};
	}
	if (e.type !== 'mcp_app_result') return null;
	return {
		key: appKey(server, resourceUri),
		event: {
			kind: 'result',
			result: {
				sessionId,
				server,
				resourceUri,
				toolCallId,
				tool: text(e.tool),
				arguments: e.arguments ?? {},
				content: Array.isArray(e.content) ? e.content : [],
				...(e.structuredContent === undefined || e.structuredContent === null
					? {}
					: {structuredContent: e.structuredContent}),
				...(e.meta && typeof e.meta === 'object' ? {meta: e.meta as Record<string, unknown>} : {}),
				isError: e.isError === true
			}
		}
	};
}

/** One bus for every tab; a tab filters on its own key. Latest result is kept for late mounts. */
export class McpAppBus {
	private listeners = new Set<(key: string, event: McpAppEvent) => void>();
	private latest = new Map<string, McpAppResultEvent>();
	/** Per-server page-call history: `mcp_app_call` carries no resourceUri, so the key is the server. */
	private activity = new Map<string, AppActivityRow[]>();
	private activityListeners = new Set<(server: string, rows: AppActivityRow[]) => void>();

	subscribe(fn: (key: string, event: McpAppEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	latestFor(key: string): McpAppResultEvent | null {
		return this.latest.get(key) ?? null;
	}

	activityFor(server: string): AppActivityRow[] {
		return this.activity.get(server) ?? [];
	}

	subscribeActivity(fn: (server: string, rows: AppActivityRow[]) => void): () => void {
		this.activityListeners.add(fn);
		return () => this.activityListeners.delete(fn);
	}

	/** Page-initiated call for the activity line. Returns the server it landed on, or null. */
	noteCall(raw: unknown): string | null {
		if (!raw || typeof raw !== 'object') return null;
		const call = readAppCall(raw as {type: string} & Record<string, unknown>);
		if (!call) return null;
		const rows = reduceAppActivity(this.activity.get(call.server) ?? [], call);
		this.activity.set(call.server, rows);
		for (const fn of this.activityListeners) fn(call.server, rows);
		return call.server;
	}

	/** Returns the key it dispatched under, or null when the payload was not an app event. */
	dispatch(raw: unknown): string | null {
		const parsed = parseAppEvent(raw);
		if (!parsed) return null;
		if (parsed.event.kind === 'result') this.latest.set(parsed.key, parsed.event.result);
		for (const fn of this.listeners) fn(parsed.key, parsed.event);
		return parsed.key;
	}
}

export const mcpAppBus = new McpAppBus();
