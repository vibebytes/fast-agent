import {callError, isRpcNotification, isRpcRequest, rpcError, rpcResult, type RpcRequest} from './protocol';

export type HostTheme = 'dark' | 'light';

export type HostContext = {
	theme: HostTheme;
	containerDimensions: {width: number; height: number};
};

export type McpAppToolResult = {
	content: unknown[];
	structuredContent?: unknown;
	_meta?: unknown;
	isError?: boolean;
};

export type BridgeDeps = {
	server: string;
	/** Tools this server exposed with `visibility` containing `app`. */
	allowedTools: () => readonly string[];
	callTool: (tool: string, args: Record<string, unknown>) => Promise<
		{ok: true; result: McpAppToolResult} | {ok: false; notice: string}
	>;
	readResource?: (uri: string) => Promise<
		{ok: true; contents: unknown[]} | {ok: false; notice: string}
	>;
	updateModelContext: (payload: unknown) => void;
	context: () => HostContext;
};

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Host side of the app protocol. Everything the page asks for is re-checked here: the page is
 * untrusted, so the relay's forwarding decision is not a permission.
 */
export class McpAppBridge {
	constructor(private readonly deps: BridgeDeps) {}

	async handle(message: unknown): Promise<unknown | null> {
		if (isRpcNotification(message)) {
			if (message.method === 'ui/notifications/initialized') return null;
			return null;
		}
		if (!isRpcRequest(message)) return null;
		const req = message as RpcRequest;
		try {
			return await this.dispatch(req);
		} catch (e) {
			return rpcError(req.id, -32000, e instanceof Error ? e.message : 'host error');
		}
	}

	private async dispatch(req: RpcRequest): Promise<unknown> {
		const params = asRecord(req.params);
		switch (req.method) {
			case 'ui/initialize':
				return rpcResult(req.id, {
					protocolVersion: '2026-01-26',
					hostInfo: {name: 'Fast', version: '1'},
					hostCapabilities: {
						serverTools: {},
						serverResources: {},
						updateModelContext: {}
					},
					hostContext: this.deps.context()
				});
			case 'tools/call': {
				const name = params.name;
				if (typeof name !== 'string' || !this.deps.allowedTools().includes(name)) {
					return rpcError(req.id, INVALID_PARAMS, `tool not available to this app: ${String(name)}`);
				}
				const reply = await this.deps.callTool(name, asRecord(params.arguments));
				if (!reply.ok) return callError(req.id, reply.notice);
				const result = reply.result;
				return rpcResult(req.id, {
					content: Array.isArray(result.content) ? result.content : [],
					...(result.structuredContent === undefined ? {} : {structuredContent: result.structuredContent}),
					...(result._meta === undefined ? {} : {_meta: result._meta}),
					isError: result.isError === true
				});
			}
			case 'resources/read': {
				const uri = params.uri;
				if (typeof uri !== 'string' || !uri.startsWith('ui://')) {
					return rpcError(req.id, INVALID_PARAMS, 'only ui:// resources are readable');
				}
				if (!this.deps.readResource) return rpcError(req.id, METHOD_NOT_FOUND, 'resources not supported');
				const reply = await this.deps.readResource(uri);
				if (!reply.ok) return rpcError(req.id, -32000, reply.notice);
				return rpcResult(req.id, {contents: reply.contents});
			}
			case 'ui/update-model-context':
				this.deps.updateModelContext(params);
				return rpcResult(req.id, {});
			default:
				return rpcError(req.id, METHOD_NOT_FOUND, `unsupported method: ${req.method}`);
		}
	}
}
