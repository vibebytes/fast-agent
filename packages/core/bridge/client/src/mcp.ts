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
