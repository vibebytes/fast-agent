import {useCallback, useEffect, useRef, useState} from 'react';
import {Boxes, RotateCw} from 'lucide-react';
import {Button} from '@fast-ide/ui/components/button';
import type {RailTab} from '../railTabs';
import {allowFrom, hostReady, hostToken, readPageMsg, readyAccepted, surfaceSandbox} from './surfaceHandshake';

export type MintSurfaceToken = (input: {
	extId: string;
	surfaceId: string;
	instanceKey: string;
}) => Promise<{token: string; toolScope: string[]} | null>;

type Phase = 'waiting' | 'handshaking' | 'ready' | 'rejected' | 'timeout';

const HANDSHAKE_TIMEOUT_MS = 10_000;

export function SurfaceHost({tab, mintToken}: {tab: RailTab; onPatch?: (patch: Partial<RailTab>) => void; mintToken?: MintSurfaceToken}) {
	const surface = tab.surface;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [phase, setPhase] = useState<Phase>('waiting');
	const [notice, setNotice] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	const url = surface?.url;
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
		setPhase(url ? 'handshaking' : 'waiting');
		setNotice(null);
	}, [url, attempt]);

	useEffect(() => {
		if (phase !== 'handshaking') return;
		const timer = setTimeout(() => setPhase('timeout'), HANDSHAKE_TIMEOUT_MS);
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
			if (!readyAccepted(msg.capabilities, surface.capabilities)) {
				setPhase('rejected');
				setNotice(`请求了未声明的能力：${msg.capabilities.filter(c => !surface.capabilities.includes(c)).join(', ')}`);
				return;
			}
			setPhase('ready');
			if (!mintToken) {
				setNotice('面板已就绪；宿主未提供 token 签发，工具调用不可用。');
				return;
			}
			const grant = await mintToken({
				extId: surface.extId,
				surfaceId: surface.surfaceId,
				instanceKey: tab.id
			});
			if (!grant) {
				setNotice('token 签发失败，工具调用不可用。');
				return;
			}
			post(hostToken(grant.token, grant.toolScope));
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [surface, origin, mintToken, post]);

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
								instanceKey: tab.id,
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
					<span className="flex-1">{phase === 'timeout' ? '面板握手超时（10s）。' : notice}</span>
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
