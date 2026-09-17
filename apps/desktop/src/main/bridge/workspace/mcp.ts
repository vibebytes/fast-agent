import type {McpControlResult, McpServerRow} from '@fastllm/bridge-client';
import {hostRequest, type CommandResult, type HostLane} from './hostWait.js';

type Notice = {ok: false; notice: string};
type McpRowsResult = {ok: true; mcpServers: McpServerRow[]} | Notice;

export type McpServerOp = 'start' | 'stop' | 'restart' | 'reset-circuit' | 'status';

export type WorkspaceMcp = {
	listMcpServers: () => Promise<McpRowsResult>;
	mcpServerControl: (name: string, op: McpServerOp) => Promise<{ok: true; mcp: McpControlResult} | Notice>;
	mcpServerPut: (name: string, config: unknown) => Promise<McpRowsResult>;
	mcpServerEnabled: (name: string, enabled: boolean) => Promise<McpRowsResult>;
	mcpServerDelete: (name: string) => Promise<{ok: true} | Notice>;
	mcpConfigImport: (payload: unknown) => Promise<McpRowsResult>;
	mcpConfigReload: () => Promise<McpRowsResult>;
};

/** Import/reload parse ecosystem JSON files; everything else is a single admin plane roundtrip (design §2). */
export function mcpTimeout(type: 'fast' | 'slow'): number {
	return type === 'slow' ? 30_000 : 12_000;
}

function mcpRowsFromEvent(event: CommandResult): McpRowsResult {
	const rows: McpServerRow[] = [];
	for (const row of event.mcpServers ?? []) {
		const {env, ...rest} = row;
		if (typeof env === 'string') {
			const invalid: Notice = {
				ok: false,
				notice: `Cannot read MCP response: invalid env JSON for server "${row.name}".`
			};
			let parsed: unknown;
			try {
				parsed = JSON.parse(env);
			} catch {
				return invalid;
			}
			if (!isEnvShape(parsed)) return invalid;
			rows.push({...rest, env: parsed});
		} else {
			rows.push(env === undefined ? rest : {...rest, env});
		}
	}
	return {ok: true, mcpServers: rows};
}

function isEnvShape(value: unknown): value is Record<string, string> | string[] {
	if (Array.isArray(value)) return value.every(item => typeof item === 'string');
	if (typeof value !== 'object' || value === null) return false;
	return Object.values(value).every(item => typeof item === 'string');
}

export function createMcp(lane: HostLane): WorkspaceMcp {
	return {
		async listMcpServers() {
			const r = await hostRequest(lane, ['ListMcpServers'], {type: 'ListMcpServers'}, {timeoutMs: mcpTimeout('fast')});
			if (!r.ok) return r;
			if (r.event.status === 'error') return {ok: false, notice: r.event.message};
			return mcpRowsFromEvent(r.event);
		},
		async mcpServerControl(name, op) {
			const r = await hostRequest(
				lane,
				['McpServerControl'],
				{type: 'McpServerControl', name, op},
				{timeoutMs: mcpTimeout('fast')}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			const mcp = r.event.mcp;
			const mcpName = mcp?.name;
			const mcpOp = mcp?.op;
			const mcpState = mcp?.state;
			const mcpOk = mcp?.ok;
			if (!mcp || mcpName == null || mcpOp == null || mcpState == null || mcpOk == null) {
				return {ok: false, notice: r.event.message || 'mcp control result missing'};
			}
			return {ok: true, mcp: {...mcp, ok: mcpOk, name: mcpName, op: mcpOp, state: mcpState}};
		},
		async mcpServerPut(name, config) {
			const r = await hostRequest(
				lane,
				['McpServerPut'],
				{type: 'McpServerPut', name, config: config as Record<string, unknown>},
				{timeoutMs: mcpTimeout('fast')}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			return mcpRowsFromEvent(r.event);
		},
		async mcpServerEnabled(name, enabled) {
			const r = await hostRequest(
				lane,
				['McpServerEnabled'],
				{type: 'McpServerEnabled', name, enabled},
				{timeoutMs: mcpTimeout('fast')}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			return mcpRowsFromEvent(r.event);
		},
		async mcpServerDelete(name) {
			const r = await hostRequest(
				lane,
				['McpServerDelete'],
				{type: 'McpServerDelete', name},
				{timeoutMs: mcpTimeout('fast')}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			return {ok: true};
		},
		async mcpConfigImport(payload) {
			const r = await hostRequest(
				lane,
				['McpConfigImport'],
				{type: 'McpConfigImport', payload: payload as Record<string, unknown>},
				{timeoutMs: mcpTimeout('slow')}
			);
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			return mcpRowsFromEvent(r.event);
		},
		async mcpConfigReload() {
			const r = await hostRequest(lane, ['McpConfigReload'], {type: 'McpConfigReload'}, {timeoutMs: mcpTimeout('slow')});
			if (!r.ok) return r;
			if (r.event.status === 'error' || r.event.status === 'rejected') {
				return {ok: false, notice: r.event.message};
			}
			return mcpRowsFromEvent(r.event);
		}
	};
}
