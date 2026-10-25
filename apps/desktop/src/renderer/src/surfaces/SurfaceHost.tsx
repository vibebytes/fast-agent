import {useCallback, useEffect, useRef, useState} from 'react';
import {Boxes, RotateCw} from 'lucide-react';
import {Button} from '@fast-ide/ui/components/button';
import type {RailTab} from '../railTabs';
import {allowFrom, hostReady, hostToken, readPageMsg, readyAccepted, surfaceSandbox} from './surfaceHandshake';
import {canAcceptReady, nextPhase, type Phase} from './surfacePhase';

export type MintSurfaceToken = (input: {
	extId: string;
	surfaceId: string;
	instanceKey: string;
}) => Promise<{token: string; toolScope: string[]} | null>;

const HANDSHAKE_TIMEOUT_MS = 10_000;

export function SurfaceHost({tab, mintToken}: {tab: RailTab; onPatch?: (patch: Partial<RailTab>) => void; mintToken?: MintSurfaceToken}) {
	const surface = tab.surface;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [phase, setPhase] = useState<Phase>('waiting');
	const [notice, setNotice] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	const url = surface?.url;
	// The open event carries the extension's instance key; fall back to the tab id so two panes of
	// the same extension never share a grant (revoke(instanceKey) would otherwise evict both).
	const instanceKey = surface?.instanceKey ?? tab.id;
	const origin = (() => {
		if (!url || !/^https?:\/\//i.test(url)) return null;
		try {
			return new URL(url).origin;
		} catch {
			return null;
		}
	})();

	const post = useCallback((msg: unknown) => {
		if (!origin) return;
		frameRef.current?.contentWindow?.postMessage(msg, origin);
	}, [origin]);

	useEffect(() => {
		setPhase(p => nextPhase(p, {kind: 'url', hasUrl: Boolean(url)}));
		setNotice(null);
		console.info('[surface] open', {surfaceId: surface?.surfaceId, tabId: tab.id, url, attempt});
	}, [url, attempt, surface?.surfaceId, tab.id]);

	useEffect(() => {
		if (phase !== 'handshaking') return;
		const timer = setTimeout(() => setPhase(p => nextPhase(p, {kind: 'timeout'})), HANDSHAKE_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [phase]);

	useEffect(() => {
		if (!surface || !origin) return;
		const onMessage = async (ev: MessageEvent) => {
			const msg = readPageMsg(ev.data, ev.origin, origin);
			if (!msg) return;
			if (msg.kind === 'surface.size') return;
			if (msg.kind === 'surface.openExternal') {
				setNotice(`面板请求打开外部链接：${msg.url}`);
				return;
			}
			if (!canAcceptReady(phase)) {
				console.warn('[surface] ready.ignored', {surfaceId: surface.surfaceId, tabId: tab.id, phase});
				return;
			}
			if (!readyAccepted(msg.capabilities, surface.capabilities)) {
				setPhase(p => nextPhase(p, {kind: 'page.ready', accepted: false}));
				console.warn('[surface] rejected', {surfaceId: surface.surfaceId, capabilities: msg.capabilities});
				setNotice(`请求了未声明的能力：${msg.capabilities.filter(c => !surface.capabilities.includes(c)).join(', ')}`);
				return;
			}
			console.info('[surface] handshake', {surfaceId: surface.surfaceId, tabId: tab.id, capabilities: msg.capabilities});
			setPhase(p => nextPhase(p, {kind: 'page.ready', accepted: true}));
			// The panel may announce `surface.ready` before our `host.ready` reached it (iframe load
			// races the bundle). Re-send so the panel always sees a handshake; idempotent on its side.
			post(
				hostReady({
					surfaceId: surface.surfaceId,
					instanceKey,
					theme: 'dark',
					width: frameRef.current?.clientWidth ?? 0,
					height: frameRef.current?.clientHeight ?? 0
				})
			);
			if (!mintToken) {
				setNotice('面板已就绪；宿主未提供 token 签发，工具调用不可用。');
				return;
			}
			const grant = await mintToken({
				extId: surface.extId,
				surfaceId: surface.surfaceId,
				instanceKey
			});
			if (!grant) {
				console.warn('[surface] token.failed', {surfaceId: surface.surfaceId, tabId: tab.id});
				setNotice('token 签发失败，工具调用不可用。');
				return;
			}
			console.info('[surface] ready', {surfaceId: surface.surfaceId, tabId: tab.id, toolScope: grant.toolScope});
			post(hostToken(grant.token, grant.toolScope));
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [surface, origin, mintToken, post, phase, instanceKey]);

	if (!surface) {
		return <Placeholder title="面板声明缺失" detail="该标签不是扩展面板。" />;
	}

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-background">
			{url ? (
				<iframe
					key={`${url}#${attempt}`}
					ref={frameRef}
					title={tab.title}
					src={url}
					sandbox={surfaceSandbox()}
					allow={allowFrom(surface.capabilities)}
					referrerPolicy="no-referrer"
					className="min-h-0 flex-1 border-0 bg-background"
					onLoad={() => {
						post(
							hostReady({
								surfaceId: surface.surfaceId,
								instanceKey,
								theme: 'dark',
								width: frameRef.current?.clientWidth ?? 0,
								height: frameRef.current?.clientHeight ?? 0
							})
						);
					}}
				/>
			) : (
				<Placeholder
					title={surface.state === 'down' ? '扩展服务未就绪' : '等待扩展打开面板'}
					detail={surface.detail ?? '面板实例 URL 由扩展在打开时下发；收到 ext.surface.open 后这里会自动加载。'}
				/>
			)}
			{phase === 'timeout' || phase === 'rejected' ? (
				<div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
					<span className="flex-1">
						{phase === 'timeout' ? (
							<>
								面板握手超时（10s）：未收到 <code>surface.ready</code>。
								<span className="ml-1 opacity-70">
									{surface.state === 'down' ? '扩展服务未就绪；' : ''}
									{url ? `url=${url.replace(/[?&]t=[^&]*/, '?t=***')}` : '无 url'}
								</span>
							</>
						) : (
							notice
						)}
					</span>
					<Button size="xs" variant="secondary" onClick={() => setAttempt(n => n + 1)}>
						<RotateCw className="mr-1 size-3" /> 重试
					</Button>
				</div>
			) : notice ? (
				<div className="absolute inset-x-0 bottom-0 border-t bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
					{notice}
				</div>
			) : null}
		</div>
	);
}

function Placeholder({title, detail}: {title: string; detail: string}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
			<Boxes className="size-6 text-muted-foreground" />
			<div className="text-sm font-medium">{title}</div>
			<div className="max-w-md text-xs text-muted-foreground">{detail}</div>
		</div>
	);
}
