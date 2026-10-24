/** Host page ↔ relay iframe. The relay has its own origin (privileged scheme), so both sides check source and origin. */
export const RELAY_ORIGIN = 'fast-mcp-relay://relay';
export const RELAY_URL = `${RELAY_ORIGIN}/relay.html`;

export type JsonRpcId = string | number;

export type RpcRequest = {jsonrpc: '2.0'; id: JsonRpcId; method: string; params?: unknown};
export type RpcNotification = {jsonrpc: '2.0'; method: string; params?: unknown};

export type RelayOut =
	| {kind: 'relay.ready'}
	| {kind: 'relay.rpc'; message: unknown}
	| {kind: 'relay.error'; detail: string};

export type RelayIn =
	/** `document` already carries the injected CSP meta — one implementation, in `csp.ts`. */
	| {kind: 'relay.mount'; document: string; title: string}
	| {kind: 'relay.rpc'; message: unknown}
	| {kind: 'relay.visibility'; visible: boolean};

export function readRelayOut(data: unknown): RelayOut | null {
	if (!data || typeof data !== 'object') return null;
	const msg = data as {kind?: unknown; message?: unknown; detail?: unknown};
	switch (msg.kind) {
		case 'relay.ready':
			return {kind: 'relay.ready'};
		case 'relay.rpc':
			return {kind: 'relay.rpc', message: msg.message};
		case 'relay.error':
			return {kind: 'relay.error', detail: typeof msg.detail === 'string' ? msg.detail : 'relay error'};
		default:
			return null;
	}
}

function isId(value: unknown): value is JsonRpcId {
	return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Only requests with an id get a reply; notifications are handled and answered with null. */
export function isRpcRequest(value: unknown): value is RpcRequest {
	if (!value || typeof value !== 'object') return false;
	const msg = value as {jsonrpc?: unknown; id?: unknown; method?: unknown};
	return msg.jsonrpc === '2.0' && isId(msg.id) && typeof msg.method === 'string' && msg.method.length > 0;
}

export function isRpcNotification(value: unknown): value is RpcNotification {
	if (!value || typeof value !== 'object') return false;
	const msg = value as {jsonrpc?: unknown; id?: unknown; method?: unknown};
	return msg.jsonrpc === '2.0' && msg.id === undefined && typeof msg.method === 'string' && msg.method.length > 0;
}

export function rpcResult(id: JsonRpcId, result: unknown) {
	return {jsonrpc: '2.0' as const, id, result};
}

export function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
	return data === undefined ? {jsonrpc: '2.0' as const, id, error: {code, message}} : {jsonrpc: '2.0' as const, id, error: {code, message, data}};
}

const RATE_LIMITED = /^rate_limited:(\d+):([\s\S]*)$/;
const APPROVAL_REQUIRED = /^approval_required:\s*([\s\S]*)$/;

/** Engine-side refusals (`McpCallFailure.pageError`, the page gate) carry their retry decision in `data`. */
export function callError(id: JsonRpcId, notice: string) {
	const rate = RATE_LIMITED.exec(notice);
	if (rate) return rpcError(id, -32000, rate[2] || 'rate limited', {retryable: true, retryAfterMs: Number(rate[1])});
	const approval = APPROVAL_REQUIRED.exec(notice);
	if (approval) return rpcError(id, -32001, approval[1] || 'approval required', {retryable: false, approvalRequired: true});
	return rpcError(id, -32000, notice);
}
