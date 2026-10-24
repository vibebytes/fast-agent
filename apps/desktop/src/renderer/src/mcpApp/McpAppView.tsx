import {useCallback, useEffect, useRef, useState} from 'react';
import {readAppContext, setAppContext} from '../composer/appContext';
import {McpAppBridge, type HostContext, type McpAppToolResult} from './bridge';
import {McpAppDelivery} from './delivery';
import {prepareDocument} from './mount';
import {RELAY_ORIGIN, RELAY_URL, isRpcRequest, readRelayOut, type RelayIn} from './protocol';
import {appKey, mcpAppBus} from './store';
import {activityLabel} from './activity';
import {appCardState} from './card';
import {liveKeysOf} from './catalog';
import {useMcpAppCatalog} from './useMcpAppCatalog';

export type McpAppViewProps = {
	server: string;
	resourceUri: string;
	title: string;
	/** Tab is the active one — the page is told when it is hidden so polling can stop. */
	active: boolean;
};

function hostTheme(): 'light' | 'dark' {
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * One tab = one relay frame = one inner page. The relay is loaded from a privileged scheme so the
 * inner document never shares the app origin; the host only talks to the relay, checked by source
 * and origin.
 */
export function McpAppView({server, resourceUri, title, active}: McpAppViewProps) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const deliveryRef = useRef<McpAppDelivery | null>(null);
	const allowedRef = useRef<string[]>([]);
	const documentRef = useRef<string | null>(null);
	const sizeRef = useRef({width: 0, height: 0});
	const toolCallRef = useRef<string | undefined>(undefined);
	const [notice, setNotice] = useState<string | null>(null);
	const [readState, setReadState] = useState<'pending' | 'ok' | 'failed'>('pending');
	const [callLine, setCallLine] = useState<string | null>(null);
	const key = appKey(server, resourceUri);
	const live = liveKeysOf(useMcpAppCatalog())?.has(key) ?? null;
	const card = appCardState({read: readState, notice, live, server});
	const overlay = card.kind === 'open' ? notice : card.kind === 'blocked' ? card.notice : `${server} is offline`;

	const post = useCallback((msg: RelayIn) => {
		frameRef.current?.contentWindow?.postMessage(msg, RELAY_ORIGIN);
	}, []);

	const context = useCallback((): HostContext => {
		const {width, height} = sizeRef.current;
		return {theme: hostTheme(), containerDimensions: active ? {width, height} : {width: 0, height: 0}};
	}, [active]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const rows = await window.fastIde.mcpAppList();
			if (cancelled || !rows.ok) return;
			allowedRef.current = rows.apps
				.filter(row => row.server === server && row.resourceUri === resourceUri)
				.map(row => row.tool);
			const read = await window.fastIde.mcpAppRead(server, resourceUri);
			if (cancelled) return;
			if (!read.ok) {
				setNotice(read.notice);
				setReadState('failed');
				return;
			}
			setReadState('ok');
			documentRef.current = prepareDocument(read.html, undefined).document;
			const frame = frameRef.current;
			frame?.contentWindow?.postMessage(
				{kind: 'relay.mount', document: documentRef.current, title} satisfies RelayIn,
				RELAY_ORIGIN
			);
		})();
		return () => {
			cancelled = true;
		};
	}, [server, resourceUri, title]);

	useEffect(() => {
		const delivery = new McpAppDelivery(msg => post({kind: 'relay.rpc', message: msg}));
		deliveryRef.current = delivery;
		const off = mcpAppBus.subscribe((hitKey, event) => {
			if (hitKey !== key) return;
			if (event.kind === 'cancelled') {
				delivery.onCancelled(event.cancel.toolCallId);
			} else {
				toolCallRef.current = event.result.toolCallId;
				delivery.onResult(event.result);
			}
		});
		const last = mcpAppBus.latestFor(key);
		if (last) {
			toolCallRef.current = last.toolCallId;
			delivery.onResult(last);
		}
		return () => {
			off();
			deliveryRef.current = null;
		};
	}, [key, post]);

	useEffect(() => {
		const rows = mcpAppBus.activityFor(server);
		const last = rows[rows.length - 1];
		setCallLine(last ? activityLabel(last) : null);
		return mcpAppBus.subscribeActivity((hit, next) => {
			if (hit !== server) return;
			const row = next[next.length - 1];
			setCallLine(row ? activityLabel(row) : null);
		});
	}, [server]);

	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const push = () => {
			sizeRef.current = {width: box.clientWidth, height: box.clientHeight};
			post({
				kind: 'relay.rpc',
				message: {jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: context()}
			});
		};
		push();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const ro = new ResizeObserver(() => {
			if (timer) return;
			timer = setTimeout(() => {
				timer = null;
				push();
			}, 100);
		});
		ro.observe(box);
		return () => {
			if (timer) clearTimeout(timer);
			ro.disconnect();
		};
	}, [context, post]);

	useEffect(() => {
		const bridge = new McpAppBridge({
			server,
			allowedTools: () => allowedRef.current,
			callTool: async (tool, args) => {
				const reply = await window.fastIde.mcpAppCall(server, tool, args);
				if (!reply.ok) return {ok: false, notice: reply.notice};
				const result = (reply.result ?? {}) as Partial<McpAppToolResult>;
				return {ok: true, result: {...result, content: Array.isArray(result.content) ? result.content : []}};
			},
			readResource: async uri => {
				const reply = await window.fastIde.mcpAppRead(server, uri);
				if (!reply.ok) return {ok: false, notice: reply.notice};
				return {
					ok: true,
					contents: [{uri, mimeType: 'text/html;profile=mcp-app', text: reply.html}]
				};
			},
			updateModelContext: payload => {
				const draft = readAppContext(payload);
				if (!draft.text.length && !draft.images.length && !draft.links.length) return;
				const toolCallId = toolCallRef.current;
				setAppContext({
					id: `${key}\u0000${toolCallId ?? 'direct'}`,
					server,
					title,
					toolCallId,
					...draft
				});
			},
			context
		});

		const onMessage = (ev: MessageEvent) => {
			if (ev.source !== frameRef.current?.contentWindow) return;
			if (ev.origin !== RELAY_ORIGIN) return;
			const out = readRelayOut(ev.data);
			if (!out) return;
			if (out.kind === 'relay.error') {
				setNotice(out.detail);
				return;
			}
			if (out.kind === 'relay.ready') {
				if (documentRef.current) {
					post({kind: 'relay.mount', document: documentRef.current, title});
				}
				return;
			}
			void (async () => {
				if (isRpcRequest(out.message) && out.message.method === 'ui/initialize') {
					deliveryRef.current?.onInitialized();
				}
				const reply = await bridge.handle(out.message);
				if (reply) post({kind: 'relay.rpc', message: reply});
			})();
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [server, title, context, post]);

	return (
		<div ref={boxRef} className="relative h-full w-full">
			<iframe
				ref={frameRef}
				title={title}
				src={RELAY_URL}
				className="h-full w-full border-0"
				onLoad={() => {
					if (documentRef.current) {
						post({kind: 'relay.mount', document: documentRef.current, title});
					}
				}}
			/>
			{callLine && !overlay ? (
				<div className="pointer-events-none absolute inset-x-2 bottom-1 truncate text-[11px] text-muted-foreground/80">
					{callLine}
				</div>
			) : null}
			{overlay ? (
				<div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6 text-center text-xs text-muted-foreground">
					{overlay}
				</div>
			) : null}
		</div>
	);
}
