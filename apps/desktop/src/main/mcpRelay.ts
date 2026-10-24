/**
 * The relay is a packaged static document, loaded from its own privileged scheme so it has an
 * origin distinct from the app's page. Its only job: mount the inner document and pass JSON-RPC.
 * It must stay dependency-free — it runs before any app code exists.
 */
export const MCP_RELAY_SCHEME = 'fast-mcp-relay';

export const MCP_RELAY_ORIGIN = `${MCP_RELAY_SCHEME}://relay`;

export const MCP_RELAY_URL = `${MCP_RELAY_ORIGIN}/relay.html`;

/** Only these reach the host page; `ui/notifications/sandbox-*` is host-side and never relayed inward. */
const FORWARD_UP = [
	'ui/initialize',
	'ui/notifications/initialized',
	'ui/notifications/size-changed',
	'tools/call',
	'resources/read',
	'ui/update-model-context'
];

const FORWARD_DOWN = [
	'ui/notifications/tool-input',
	'ui/notifications/tool-result',
	'ui/notifications/tool-cancelled',
	'ui/notifications/host-context-changed'
];

export const MCP_RELAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'self' data: blob:; frame-ancestors 'self' file: http://localhost:* https://localhost:*">
<title>MCP App</title>
<style>html,body{margin:0;height:100%;background:transparent}#stage{position:absolute;inset:0}#stage iframe{width:100%;height:100%;border:0;background:transparent}</style>
</head>
<body>
<div id="stage"></div>
<script>
(function () {
	var UP = ${JSON.stringify(FORWARD_UP)};
	var DOWN = ${JSON.stringify(FORWARD_DOWN)};
	var inner = null;
	var hostOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
	if (hostOrigin === 'null' || hostOrigin === '') hostOrigin = '*';
	function toHost(msg) {
		try { parent.postMessage(msg, hostOrigin); } catch (e) { parent.postMessage(msg, '*'); }
	}
	function mount(documentHtml, title) {
		if (inner) { inner.remove(); inner = null; }
		inner = document.createElement('iframe');
		inner.setAttribute('sandbox', 'allow-scripts');
		inner.setAttribute('title', title || 'MCP App');
		inner.srcdoc = documentHtml;
		document.getElementById('stage').appendChild(inner);
	}
	function down(message) {
		if (!inner || !inner.contentWindow) return;
		if (!message || typeof message !== 'object') return;
		var isResponse = 'id' in message && !('method' in message);
		if (isResponse || (typeof message.method === 'string' && DOWN.indexOf(message.method) >= 0)) {
			inner.contentWindow.postMessage(message, '*');
		}
	}
	function up(message) {
		if (Array.isArray(message)) {
			for (var i = 0; i < message.length; i++) up(message[i]);
			return;
		}
		if (!message || typeof message !== 'object' || typeof message.method !== 'string') return;
		if (UP.indexOf(message.method) < 0) return;
		toHost({kind: 'relay.rpc', message: message});
	}
	window.addEventListener('message', function (event) {
		if (event.source === parent) {
			var m = event.data;
			if (!m || typeof m !== 'object') return;
			if (m.kind === 'relay.mount') mount(String(m.document || ''), String(m.title || ''));
			else if (m.kind === 'relay.rpc') down(m.message);
			return;
		}
		if (!inner || event.source !== inner.contentWindow) return;
		up(event.data);
	});
	window.addEventListener('error', function (e) {
		toHost({kind: 'relay.error', detail: String((e && e.message) || 'relay error')});
	});
	toHost({kind: 'relay.ready'});
})();
</script>
</body>
</html>`;
