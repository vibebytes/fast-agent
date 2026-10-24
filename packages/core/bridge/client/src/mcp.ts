export const mcpServerOps = ['start', 'stop', 'restart', 'reset-circuit', 'status'] as const;
export type McpServerOp = (typeof mcpServerOps)[number];

export function isMcpServerOp(value: unknown): value is McpServerOp {
	return mcpServerOps.includes(value as McpServerOp);
}

export type McpServerRow = {
	name: string;
	transport?: string;
	command?: string;
	args?: string[] | string;
	env?: Record<string, string> | string[];
	url?: string;
	/** Engine-known fields the edit dialog does not render; a save must carry them back untouched. */
	description?: string;
	timeout?: number;
	startupTimeout?: number;
	allowedTools?: string[];
	blockedTools?: string[];
	sandbox?: string;
	auth?: Record<string, unknown>;
	/** Standing consent for model + page calls; unset means stdio yes, remote no (§5.1). */
	autoApprove?: boolean;
	/** Per-server MCP Apps switch; only local stdio servers may open a page (§5.4). */
	mcpApps?: boolean;
	enabled?: boolean;
	restartRequired?: boolean;
	state?: string | null;
	pid?: number | null;
	restarts?: number | null;
	lastError?: string | null;
	stderrTail?: string | null;
	connectionStatus?: string | null;
	discoveredToolCount?: number | null;
};

/** §5.1 app row: a tool whose `_meta.ui` names a `ui://` page. */
export type McpAppRow = {
	server: string;
	tool: string;
	remoteTool: string;
	resourceUri: string;
	visibility: string[];
	/** `_meta.ui.csp` as the server declared it; the host sanitises it, nothing is trusted. */
	csp?: Record<string, unknown>;
};

export type McpControlResult = {
	ok: boolean;
	name: string;
	op: string;
	state: string;
	pid?: number | null;
	restarts?: number | null;
	restartRequired?: boolean;
	lastError?: string | null;
	message?: string;
};

export type McpOk<T> = {ok: true} & T;
export type McpErr = {ok: false; notice: string};

export type McpAdminApi = {
	listMcpServers: () => Promise<McpOk<{mcpServers: McpServerRow[]}> | McpErr>;
	mcpServerControl: (name: string, op: McpServerOp) => Promise<McpOk<{mcp: McpControlResult}> | McpErr>;
	mcpServerPut: (name: string, config: unknown) => Promise<McpOk<{mcpServers: McpServerRow[]}> | McpErr>;
	mcpServerEnabled: (name: string, enabled: boolean) => Promise<McpOk<{mcpServers: McpServerRow[]}> | McpErr>;
	mcpServerDelete: (name: string) => Promise<McpOk<Record<string, never>> | McpErr>;
	mcpConfigImport: (payload: unknown) => Promise<McpOk<{mcpServers: McpServerRow[]}> | McpErr>;
	mcpConfigReload: () => Promise<McpOk<{mcpServers: McpServerRow[]}> | McpErr>;
};

export const mcpAdminMethods = [
	'listMcpServers',
	'mcpServerControl',
	'mcpServerPut',
	'mcpServerEnabled',
	'mcpServerDelete',
	'mcpConfigImport',
	'mcpConfigReload'
] as const;

const NULLISH_KEYS = [
	'pid',
	'restarts',
	'lastError',
	'stderrTail',
	'connectionStatus',
	'discoveredToolCount'
] as const;

export function mcpServerRow(raw: McpServerRow): McpServerRow {
	const row: McpServerRow = {...raw};
	for (const key of NULLISH_KEYS) {
		if (row[key] == null) delete row[key];
	}
	return row;
}

export function mcpControlResult(raw: McpControlResult): McpControlResult {
	const result: McpControlResult = {...raw};
	if (!result.restartRequired) delete result.restartRequired;
	return result;
}
