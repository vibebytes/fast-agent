import type {RpcNotification} from './protocol';

export type McpToolResult = {
	toolCallId: string;
	tool: string;
	arguments: unknown;
	content: unknown[];
	structuredContent?: unknown;
	meta?: Record<string, unknown>;
	isError: boolean;
};

type Pending = {input?: {toolCallId: string; arguments: unknown}; result?: McpToolResult};

const MAX_TRACKED = 32;

/**
 * Per-tab delivery: the app page may not be listening yet, and a reload gives it a blank memory.
 * One input pairs one result — buffering keeps only the newest call so a page never gets a
 * mismatched pair.
 */
export class McpAppDelivery {
	private initialized = false;
	private everInitialized = false;
	private pending: Pending = {};
	private lastResult: McpToolResult | null = null;
	private delivered: string[] = [];

	constructor(private readonly send: (msg: RpcNotification) => void) {}

	onResult(result: McpToolResult): void {
		this.lastResult = result;
		if (!this.initialized) {
			this.pending = {
				input: {toolCallId: result.toolCallId, arguments: result.arguments},
				result
			};
			return;
		}
		this.emitInput(result);
		this.emitResult(result);
	}

	onCancelled(toolCallId: string): void {
		if (!this.initialized) {
			if (this.pending.input?.toolCallId === toolCallId) delete this.pending.input;
			if (this.pending.result?.toolCallId === toolCallId) delete this.pending.result;
		}
		if (this.delivered.includes(toolCallId)) {
			this.send({jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: {toolCallId}});
		}
	}

	/** First ready: buffered pair. After a reload: only the newest result — the page must tolerate a missing input. */
	onInitialized(): void {
		this.initialized = true;
		if (!this.everInitialized) {
			this.everInitialized = true;
			const {input, result} = this.pending;
			this.pending = {};
			if (input) {
				this.send({jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: {arguments: input.arguments}});
				this.markDelivered(input.toolCallId);
			}
			if (result) this.emitResult(result);
			return;
		}
		if (this.lastResult) this.emitResult(this.lastResult);
	}

	/** The page navigated/reloaded: it is a new instance with no input history. */
	onReloaded(): void {
		this.initialized = false;
		this.pending = this.lastResult ? {result: this.lastResult} : {};
	}

	private emitInput(result: McpToolResult): void {
		this.send({jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: {arguments: result.arguments}});
		this.markDelivered(result.toolCallId);
	}

	private emitResult(result: McpToolResult): void {
		this.send({
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-result',
			params: {
				content: result.content,
				...(result.structuredContent === undefined ? {} : {structuredContent: result.structuredContent}),
				...(result.meta === undefined ? {} : {_meta: result.meta}),
				isError: result.isError
			}
		});
	}

	private markDelivered(toolCallId: string): void {
		this.delivered.push(toolCallId);
		if (this.delivered.length > MAX_TRACKED) this.delivered.shift();
	}
}
