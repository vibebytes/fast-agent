import {useTranslation} from 'react-i18next';
import type {ClusterRosterItem} from '@fast-ide/session-view';
import {MonoTag} from './SettingsPrimitives';

export type Phase = 'idle' | 'joining' | 'joined' | 'leaving' | 'failed';
export type ReachRow = {reach: 'open' | 'down' | 'mismatch' | 'no-main'; message?: string};
export type ReachMap = Record<string, ReachRow>;

export function memberName(item: ClusterRosterItem): string {
	return item.displayName || item.agentId || item.id || '?';
}

export function memberKey(item: ClusterRosterItem): string {
	return item.id ?? item.agentId ?? memberName(item);
}

/** Engine presence vocabulary is Idle / InTurn / Unavailable. */
export function memberOnline(item: ClusterRosterItem): boolean {
	return item.presence !== 'Unavailable';
}

export function presenceKey(item: ClusterRosterItem): string {
	return item.presence === 'Unavailable' ? 'unavailable' : item.presence === 'InTurn' ? 'inTurn' : 'idle';
}

export function reachOf(item: ClusterRosterItem, reach: ReachMap): ReachRow | undefined {
	return reach[item.agentId ?? item.id ?? ''];
}

export function isBlocked(gated?: ReachRow): boolean {
	return gated?.reach === 'down' || gated?.reach === 'mismatch';
}

const MAX_RING_NODES = 12;

type MapNode = {item: ClusterRosterItem; x: number; y: number; online: boolean; key: string};

function initial(name: string): string {
	return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** §2.1: 本机固定中心，成员环排（按 id 排序保证位置稳定），不画节点间连线。 */
export function ClusterMap({
	roster,
	phase,
	selected,
	reach,
	onSelect
}: {
	roster: ClusterRosterItem[];
	phase: Phase;
	selected: string | null;
	reach: ReachMap;
	onSelect: (key: string) => void;
}) {
	const {t} = useTranslation();
	const switching = phase === 'joining' || phase === 'leaving';
	const selfItem = roster.find(item => item.self) ?? null;
	const others = roster.filter(item => item !== selfItem).sort((a, b) => memberKey(a).localeCompare(memberKey(b)));
	const shown = others.slice(0, MAX_RING_NODES);
	const hidden = others.length - shown.length;

	const count = shown.length;
	const radius = count <= 2 ? 70 : count <= 6 ? 82 : 96;
	const height = count <= 2 ? 200 : 240;
	const cx = 200;
	const cy = height / 2;

	const nodes: MapNode[] = shown.map((item, index) => {
		const angle = (Math.PI * 2 * index) / shown.length - Math.PI / 2;
		return {
			item,
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
			online: memberOnline(item),
			key: memberKey(item)
		};
	});
	const selfNode: MapNode | null = selfItem
		? {item: selfItem, x: cx, y: cy, online: memberOnline(selfItem), key: memberKey(selfItem)}
		: null;
	const detail = [selfNode, ...nodes].find(n => n && n.key === selected) ?? null;

	return (
		<div className="grid gap-3 @container md:grid-cols-[1fr_240px]">
			<div className="flex flex-col items-center gap-2">
				<svg
					viewBox={`0 0 400 ${height}`}
					preserveAspectRatio="xMidYMid meet"
					className="hidden w-full max-w-md @[480px]:block"
					role="img"
					aria-label={t('settings.cluster.mapTitle')}
				>
					<circle cx={cx} cy={cy} r={radius} className="fill-none stroke-border/40" strokeWidth={1} strokeDasharray="2 4" />
					{selfNode ? (
						<g key={selfNode.key} className="cursor-pointer" onClick={() => onSelect(selfNode.key)}>
							<title>{memberName(selfNode.item)}</title>
							<circle
								cx={cx}
								cy={cy}
								r={16}
								className={`${selfNode.online ? 'fill-primary/20' : 'fill-muted'} ${selected === selfNode.key ? 'stroke-primary' : 'stroke-primary/50'} ${switching ? 'animate-pulse' : ''}`}
								strokeWidth={1.5}
							/>
							<text x={cx} y={cy + 4} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
								{initial(memberName(selfNode.item))}
							</text>
							<text x={cx} y={cy + 34} textAnchor="middle" className="fill-muted-foreground text-[10px]">
								{t('settings.cluster.self')}
							</text>
						</g>
					) : null}
					{nodes.map(n => {
						const gated = reachOf(n.item, reach);
						const blocked = isBlocked(gated);
						const label = gated?.message
							? `${memberName(n.item)} · ${gated.message}`
							: `${memberName(n.item)} · ${t(`settings.cluster.presence.${presenceKey(n.item)}`)}`;
						return (
							<g
								key={n.key}
								className={blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
								onClick={blocked ? undefined : () => onSelect(n.key)}
							>
								<title>{label}</title>
								{selected === n.key ? (
									<circle cx={n.x} cy={n.y} r={18} className="fill-primary/10 stroke-primary/40" strokeWidth={1} />
								) : null}
								<circle
									cx={n.x}
									cy={n.y}
									r={14}
									className={`${blocked ? 'fill-muted stroke-border' : n.online ? 'fill-emerald-500 stroke-emerald-500/40' : 'fill-muted stroke-border'}`}
									strokeWidth={1.5}
								/>
								<text
									x={n.x}
									y={n.y + 4}
									textAnchor="middle"
									className={`text-[10px] font-semibold ${blocked || !n.online ? 'fill-muted-foreground' : 'fill-white'}`}
								>
									{initial(memberName(n.item))}
								</text>
								<text
									x={n.x}
									y={n.y + (n.y >= cy ? 28 : -20)}
									textAnchor="middle"
									className={blocked || !n.online ? 'fill-muted-foreground text-[10px]' : 'fill-foreground text-[10px]'}
								>
									{memberName(n.item).length > 14 ? `${memberName(n.item).slice(0, 13)}…` : memberName(n.item)}
								</text>
								{blocked && gated?.message ? (
									<text
										x={n.x}
										y={n.y + (n.y >= cy ? 38 : -30)}
										textAnchor="middle"
										className="fill-destructive text-[10px]"
									>
										{gated.message}
									</text>
								) : null}
							</g>
						);
					})}
				</svg>
				{switching ? <p className="animate-pulse text-[11px] text-primary">{t('settings.cluster.mapSwitching')}</p> : null}
				{hidden > 0 ? <MonoTag>{`+${hidden}`}</MonoTag> : null}
			</div>
			<div className="rounded-lg border bg-muted/30 p-3">
				{detail ? (
					<MemberDetails node={detail} />
				) : (
					<p className="text-[11px] text-muted-foreground">{t('settings.cluster.selectHint')}</p>
				)}
			</div>
		</div>
	);
}

/** §2.3 成员详情：只读字段展示，联系点默认收起。 */
function MemberDetails({node}: {node: MapNode}) {
	const {t} = useTranslation();
	const item = node.item;
	const rows: Array<[string, string]> = [
		[t('settings.cluster.details.id'), item.id ?? item.agentId ?? '—'],
		[t('settings.cluster.details.fingerprint'), item.fingerprint ?? '—'],
		[t('settings.cluster.details.presence'), t(`settings.cluster.presence.${presenceKey(item)}`)]
	];
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="truncate text-[12px] font-medium">{memberName(item)}</p>
				{item.self ? <MonoTag>{t('settings.cluster.details.self')}</MonoTag> : null}
			</div>
			<dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1">
				{rows.map(([label, value]) => (
					<div key={label} className="col-span-1 col-start-1 col-end-3 grid grid-cols-subgrid">
						<dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
						<dd className="truncate font-mono text-[11px]">{value}</dd>
					</div>
				))}
			</dl>
			{item.endpoints?.length ? (
				<details className="text-[11px]">
					<summary className="cursor-pointer text-muted-foreground">
						{t('settings.cluster.details.endpoints')}
					</summary>
					<ul className="mt-1 space-y-0.5">
						{item.endpoints.map(ep => (
							<li key={ep} className="truncate font-mono text-[11px]">
								{ep}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}
