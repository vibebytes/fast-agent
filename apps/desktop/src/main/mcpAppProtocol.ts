import {protocol} from 'electron';
import {MCP_RELAY_HTML, MCP_RELAY_URL} from './mcpRelay';

/** Privileged so the relay gets a real origin, not the app page's — the whole point of the extra frame. */
export const MCP_RELAY_SCHEME_PRIVILEGES = {
	scheme: 'fast-mcp-relay',
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: false,
		corsEnabled: false,
		stream: false,
		bypassCSP: false
	}
} as const;

export function handleMcpRelayProtocol(): void {
	protocol.handle('fast-mcp-relay', request => {
		const url = new URL(request.url);
		if (url.host !== 'relay' || url.pathname !== '/relay.html') {
			return new Response('Not found', {status: 404});
		}
		return new Response(MCP_RELAY_HTML, {
			status: 200,
			headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}
		});
	});
}

export {MCP_RELAY_URL};
