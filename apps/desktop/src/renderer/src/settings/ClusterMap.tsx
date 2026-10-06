import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	ArrowUpRight,
	Check,
	CheckCircle2,
	Copy,
	Fingerprint,
	Globe,
	Info,
	Laptop,
	Network,
	Radio,
	Server,
	ShieldAlert,
	Workflow
} from 'lucide-react';
import type {ClusterRosterItem} from '@fast-ide/session-view';
import {MonoTag, SettingsButton} from './SettingsPrimitives';

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

/** Check if item corresponds to the currently active edge */
export function isItemActive(item: ClusterRosterItem, activeEdgeId?: string | null): boolean {
	if (!activeEdgeId || activeEdgeId === 'local') {
		return Boolean(item.self);
	}
	const itemAgentId = item.agentId ?? item.id;
	return activeEdgeId === `individual:${itemAgentId}` || activeEdgeId === itemAgentId;
}

const MAX_RING_NODES = 12;

export type MapNode = {
	item: ClusterRosterItem;
	x: number;
	y: number;
	online: boolean;
	key: string;
	isActive: boolean;
};

function initial(name: string): string {
	return name.trim().slice(0, 1).toUpperCase() || '?';
}

export function ClusterMap({
	roster,
	phase,
	selected,
	reach,
	activeEdgeId,
	busy,
	onSelect,
	onOpen
}: {
	roster: ClusterRosterItem[];
	phase: Phase;
	selected: string | null;
	reach: ReachMap;
	activeEdgeId?: string | null;
	busy?: boolean;
	onSelect: (key: string) => void;
	onOpen?: (item: ClusterRosterItem) => void;
}) {
	const {t} = useTranslation();
	const switching = phase === 'joining' || phase === 'leaving';
	const selfItem = roster.find(item => item.self) ?? null;
	const others = roster.filter(item => item !== selfItem).sort((a, b) => memberKey(a).localeCompare(memberKey(b)));
	const shown = others.slice(0, MAX_RING_NODES);
	const hidden = others.length - shown.length;

	const count = shown.length;
	const cx = 220;
	const cy = 180;
	const baseRadius = count <= 2 ? 100 : count <= 6 ? 116 : 126;
	const height = 360;

	const nodes: MapNode[] = useMemo(() => {
		return shown.map((item, index) => {
			const angle = (Math.PI * 2 * index) / (shown.length || 1) - Math.PI / 2;
			return {
				item,
				x: Math.round(cx + baseRadius * Math.cos(angle)),
				y: Math.round(cy + baseRadius * Math.sin(angle)),
				online: memberOnline(item),
				key: memberKey(item),
				isActive: isItemActive(item, activeEdgeId)
			};
		});
	}, [shown, cx, cy, baseRadius, activeEdgeId]);

	const selfNode: MapNode | null = useMemo(() => {
		if (!selfItem) return null;
		return {
			item: selfItem,
			x: cx,
			y: cy,
			online: memberOnline(selfItem),
			key: memberKey(selfItem),
			isActive: isItemActive(selfItem, activeEdgeId)
		};
	}, [selfItem, cx, cy, activeEdgeId]);

	const selectedNode = [selfNode, ...nodes].find(n => n && n.key === selected) ?? selfNode ?? nodes[0] ?? null;

	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_310px]">
			{/* Left: Topology radar stage */}
			<div className="relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-linear-to-b from-card/80 via-card/30 to-muted/20 p-2 shadow-inner">
				{/* Background radial glow & crosshairs */}
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-30">
					<div className="size-[280px] rounded-full bg-primary/5 blur-2xl" />
				</div>

				<svg
					viewBox={`0 0 440 ${height}`}
					preserveAspectRatio="xMidYMid meet"
					className="relative z-10 size-full max-w-[480px] select-none"
					role="img"
					aria-label={t('settings.cluster.mapTitle')}
				>
					<defs>
						{/* Gradient lines */}
						<linearGradient id="conn-active" x1="0%" y1="0%" x2="100%" y2="100%">
							<stop offset="0%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="0.4" />
							<stop offset="100%" stopColor="var(--color-emerald-500, #10b981)" stopOpacity="0.7" />
						</linearGradient>
						<linearGradient id="conn-blocked" x1="0%" y1="0%" x2="100%" y2="100%">
							<stop offset="0%" stopColor="var(--color-destructive, #ef4444)" stopOpacity="0.2" />
							<stop offset="100%" stopColor="var(--color-destructive, #ef4444)" stopOpacity="0.6" />
						</linearGradient>
						{/* Center self glow filter */}
						<filter id="self-glow" x="-50%" y="-50%" width="200%" height="200%">
							<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
							<feMerge>
								<feMergeNode in="blur" />
								<feMergeNode in="SourceGraphic" />
							</feMerge>
						</filter>
						{/* Outer node glow filter */}
						<filter id="node-glow" x="-40%" y="-40%" width="180%" height="180%">
							<feGaussianBlur stdDeviation="2.5" result="blur" />
							<feComposite in="SourceGraphic" in2="blur" operator="over" />
						</filter>
					</defs>

					{/* Coordinate axes and concentric helper orbits */}
					<g className="opacity-40">
						<circle cx={cx} cy={cy} r={baseRadius * 0.45} className="fill-none stroke-border/50" strokeWidth={1} strokeDasharray="3 6" />
						<circle cx={cx} cy={cy} r={baseRadius} className="fill-none stroke-border/60" strokeWidth={1.2} />
						<circle cx={cx} cy={cy} r={baseRadius * 1.32} className="fill-none stroke-border/30" strokeWidth={1} strokeDasharray="2 8" />
						<line x1={cx - baseRadius * 1.35} y1={cy} x2={cx + baseRadius * 1.35} y2={cy} className="stroke-border/30" strokeWidth={1} strokeDasharray="2 4" />
						<line x1={cx} y1={cy - baseRadius * 1.35} x2={cx} y2={cy + baseRadius * 1.35} className="stroke-border/30" strokeWidth={1} strokeDasharray="2 4" />
					</g>

					{/* Radar dynamic scanning beam */}
					<g className={switching ? 'animate-spin origin-center' : ''} style={{transformOrigin: `${cx}px ${cy}px`}}>
						<circle
							cx={cx}
							cy={cy}
							r={baseRadius * 0.8}
							className="fill-none stroke-primary/15 transition-all duration-1000"
							strokeWidth={switching ? 3 : 1}
							strokeDasharray={switching ? '8 16' : '1 6'}
						/>
					</g>

					{/* Topology links (from self center to outer ring nodes) */}
					{selfNode &&
						nodes.map(n => {
							const gated = reachOf(n.item, reach);
							const blocked = isBlocked(gated);
							const isSelected = selectedNode?.key === n.key;
							const isCurrentActive = n.isActive;
							return (
								<g key={`edge-${n.key}`}>
									<line
										x1={cx}
										y1={cy}
										x2={n.x}
										y2={n.y}
										stroke={
											blocked
												? 'url(#conn-blocked)'
												: isCurrentActive
													? 'var(--color-emerald-500, #10b981)'
													: isSelected
														? 'var(--color-primary, #3b82f6)'
														: 'url(#conn-active)'
										}
										strokeWidth={isCurrentActive ? 2.5 : isSelected ? 2 : 1.2}
										strokeDasharray={blocked ? '3 3' : isCurrentActive ? 'none' : isSelected ? '4 2' : 'none'}
										className="transition-all duration-300"
										opacity={isCurrentActive ? 1 : isSelected ? 0.9 : 0.65}
									/>
									{/* Edge pulse particle: flows along path from self to peer */}
									{n.online && !blocked ? (
										<circle r={isCurrentActive ? 2.6 : 1.6} className={isCurrentActive ? 'fill-emerald-500' : 'fill-primary/70'}>
											<animateMotion
												dur={isCurrentActive ? '1.6s' : '2.6s'}
												repeatCount="indefinite"
												path={`M ${cx} ${cy} L ${n.x} ${n.y}`}
											/>
										</circle>
									) : null}
								</g>
							);
						})}

					{/* Member outer ring nodes */}
					{nodes.map(n => {
						const gated = reachOf(n.item, reach);
						const blocked = isBlocked(gated);
						const isSelected = selectedNode?.key === n.key;
						const isCurrentActive = n.isActive;
						const label = memberName(n.item);
						const labelShort = label.length > 12 ? `${label.slice(0, 11)}…` : label;
						const isTopHalf = n.y < cy;

						return (
							<g
								key={n.key}
								className="cursor-pointer transition-transform duration-200"
								onClick={() => onSelect(n.key)}
								role="button"
								tabIndex={0}
								onKeyDown={e => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelect(n.key);
									}
								}}
							>
								<title>{`${label} (${t(`settings.cluster.presence.${presenceKey(n.item)}`)})${isCurrentActive ? ` · ${t('settings.cluster.actions.connected')}` : ''}${blocked ? ` · ${gated?.message}` : ''}`}</title>

								{/* Outer highlight ring for active connection */}
								{isCurrentActive ? (
									<circle
										cx={n.x}
										cy={n.y}
										r={24}
										className="fill-emerald-500/15 stroke-emerald-500 animate-pulse"
										strokeWidth={1.8}
										strokeDasharray="4 2"
									/>
								) : null}

								{/* Outer highlight ring for selected state */}
								{isSelected && !isCurrentActive ? (
									<circle
										cx={n.x}
										cy={n.y}
										r={22}
										className="fill-primary/10 stroke-primary animate-pulse"
										strokeWidth={1.5}
									/>
								) : null}

								{/* Node outer circle */}
								<circle
									cx={n.x}
									cy={n.y}
									r={15}
									filter={n.online && !blocked ? 'url(#node-glow)' : undefined}
									className={`transition-all duration-200 ${
										blocked
											? 'fill-destructive/20 stroke-destructive/60'
											: isCurrentActive
												? 'fill-card stroke-emerald-500'
												: n.online
													? 'fill-card stroke-primary/80'
													: 'fill-muted/80 stroke-border'
									}`}
									strokeWidth={isCurrentActive ? 2.8 : isSelected ? 2.5 : 1.8}
								/>

								{/* Node inner status core */}
								<circle
									cx={n.x}
									cy={n.y}
									r={4}
									className={
										blocked
											? 'fill-destructive'
											: isCurrentActive
												? 'fill-emerald-500'
												: n.online
													? n.item.presence === 'InTurn'
														? 'fill-amber-500 animate-ping'
														: 'fill-primary'
													: 'fill-muted-foreground/40'
									}
								/>

								{/* Node text initial badge */}
								<text
									x={n.x}
									y={n.y + 3.5}
									textAnchor="middle"
									className={`pointer-events-none text-[9px] font-bold ${
										blocked
											? 'fill-destructive'
											: isCurrentActive
												? 'fill-emerald-600 font-extrabold'
												: n.online
													? 'fill-foreground'
													: 'fill-muted-foreground'
									}`}
								>
									{initial(label)}
								</text>

								{/* Node label tag (shifted radially outward to avoid overlap with halo and circle) */}
								<g transform={`translate(${n.x}, ${n.y + (isTopHalf ? -34 : 34)})`}>
									<rect
										x={-Math.min(labelShort.length * 4.2 + (isCurrentActive ? 18 : 8), 65)}
										y={-8}
										width={Math.min(labelShort.length * 8.4 + (isCurrentActive ? 36 : 16), 130)}
										height={16}
										rx={8}
										className={`transition-colors ${
											isCurrentActive
												? 'fill-emerald-500/20 stroke-emerald-500/70 shadow-xs'
												: isSelected
													? 'fill-primary/20 stroke-primary/50'
													: 'fill-background/80 stroke-border/40'
										}`}
										strokeWidth={isCurrentActive ? 1.2 : 0.8}
									/>
									<text
										x={0}
										y={3}
										textAnchor="middle"
										className={`pointer-events-none text-[9.5px] font-medium tracking-tight ${
											isCurrentActive
												? 'fill-emerald-600 font-bold'
												: isSelected
													? 'fill-primary font-semibold'
													: 'fill-foreground/90'
										}`}
									>
										{labelShort}
										{isCurrentActive ? ` ✓` : ''}
									</text>
								</g>
							</g>
						);
					})}

					{/* Self center node */}
					{selfNode ? (
						<g
							key={selfNode.key}
							className="cursor-pointer"
							onClick={() => onSelect(selfNode.key)}
							role="button"
							tabIndex={0}
							onKeyDown={e => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelect(selfNode.key);
								}
							}}
						>
							<title>{`${memberName(selfNode.item)} (${t('settings.cluster.self')})${selfNode.isActive ? ` · ${t('settings.cluster.actions.connected')}` : ''}`}</title>

							{/* Self dual-layer pulse glow rings */}
							<circle
								cx={cx}
								cy={cy}
								r={30}
								className={`fill-primary/5 stroke-primary/30 ${switching ? 'animate-spin' : 'animate-pulse'}`}
								strokeWidth={1}
								strokeDasharray="4 4"
							/>
							{selfNode.isActive ? (
								<circle
									cx={cx}
									cy={cy}
									r={26}
									className="fill-emerald-500/10 stroke-emerald-500/60 animate-pulse"
									strokeWidth={1.5}
								/>
							) : null}
							<circle
								cx={cx}
								cy={cy}
								r={21}
								filter="url(#self-glow)"
								className={`fill-card ${
									selfNode.isActive
										? 'stroke-emerald-500'
										: selectedNode?.key === selfNode.key
											? 'stroke-primary'
											: 'stroke-primary/70'
								}`}
								strokeWidth={selfNode.isActive || selectedNode?.key === selfNode.key ? 2.5 : 2}
							/>

							{/* Self core indicator */}
							<circle cx={cx} cy={cy} r={6} className={selfNode.isActive ? 'fill-emerald-500' : 'fill-primary'} />
							<circle cx={cx} cy={cy} r={3} className="fill-background" />

							{/* Self bottom dedicated badge */}
							<g transform={`translate(${cx}, ${cy + 36})`}>
								<rect
									x={selfNode.isActive ? -52 : -44}
									y={-9}
									width={selfNode.isActive ? 104 : 88}
									height={18}
									rx={9}
									className={
										selfNode.isActive
											? 'fill-emerald-500/15 stroke-emerald-500/50 shadow-xs'
											: 'fill-primary/15 stroke-primary/40 shadow-xs'
									}
									strokeWidth={1}
								/>
								<text
									x={0}
									y={3.5}
									textAnchor="middle"
									className={`pointer-events-none text-[9.5px] font-bold tracking-wider ${
										selfNode.isActive ? 'fill-emerald-600' : 'fill-primary'
									}`}
								>
									{selfNode.isActive
										? `${t('settings.cluster.self')} (${memberName(selfNode.item)}) ✓`
										: `${t('settings.cluster.self')} (${memberName(selfNode.item)})`}
								</text>
							</g>
						</g>
					) : null}
				</svg>

				{/* Bottom floating status indicator */}
				<div className="absolute bottom-2.5 left-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
					<Radio className="size-3 text-primary animate-pulse" />
					<span>{switching ? t('settings.cluster.mapSwitching') : t('settings.cluster.radar.scanning')}</span>
				</div>

				{hidden > 0 ? (
					<div className="absolute bottom-2.5 right-3">
						<MonoTag>{`+${hidden}`}</MonoTag>
					</div>
				) : null}
			</div>

			{/* Right: Node inspector and action card */}
			<div className="flex flex-col justify-between rounded-xl border border-border/70 bg-card/50 p-4 shadow-xs backdrop-blur-sm">
				{selectedNode ? (
					<InspectorCard
						node={selectedNode}
						gated={reachOf(selectedNode.item, reach)}
						busy={busy}
						onOpen={() => onOpen?.(selectedNode.item)}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center p-6 text-center">
						<Network className="mb-2 size-8 text-muted-foreground/40" />
						<p className="text-[12px] text-muted-foreground">{t('settings.cluster.selectHint')}</p>
					</div>
				)}
			</div>
		</div>
	);
}

/** Node profile & action inspector */
function InspectorCard({
	node,
	gated,
	busy,
	onOpen
}: {
	node: MapNode;
	gated?: ReachRow;
	busy?: boolean;
	onOpen?: () => void;
}) {
	const {t} = useTranslation();
	const item = node.item;
	const isSelf = Boolean(item.self);
	const blocked = isBlocked(gated);
	const isCurrentActive = node.isActive;
	const [copied, setCopied] = useState(false);

	const handleCopyEndpoint = (text: string) => {
		void navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const primaryEndpoint = item.endpoints?.[0] ?? '';

	return (
		<div className="flex h-full flex-col justify-between space-y-4">
			{/* Header: Node identity and status */}
			<div className="space-y-3">
				<div className="flex items-start justify-between gap-2 border-b border-border/40 pb-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<div
							className={`flex size-9 shrink-0 items-center justify-center rounded-lg border font-semibold ${
								isCurrentActive
									? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 shadow-xs'
									: isSelf
										? 'border-primary/40 bg-primary/10 text-primary'
										: node.online
											? 'border-border bg-muted/60 text-foreground'
											: 'border-border bg-muted text-muted-foreground'
							}`}
						>
							{isSelf ? <Laptop className="size-4" /> : <Server className="size-4" />}
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-1.5">
								<h3 className="truncate text-[13px] font-semibold text-foreground">{memberName(item)}</h3>
								{isCurrentActive ? (
									<span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-600">
										<CheckCircle2 className="size-2.5" />
										{t('settings.cluster.actions.connectedBadge')}
									</span>
								) : null}
							</div>
							<div className="flex items-center gap-1.5 pt-0.5">
								<span
									className={`size-1.5 rounded-full ${
										blocked
											? 'bg-destructive'
											: isCurrentActive
												? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]'
												: node.online
													? 'bg-emerald-500'
													: 'bg-muted-foreground/40'
									}`}
								/>
								<span className="text-[11px] text-muted-foreground">
									{blocked
										? gated?.message || t('settings.cluster.unreachable')
										: t(`settings.cluster.presence.${presenceKey(item)}`)}
								</span>
							</div>
						</div>
					</div>
					{isSelf ? (
						<MonoTag>{t('settings.cluster.radar.selfPill')}</MonoTag>
					) : (
						<span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
							{t('settings.cluster.radar.peerPill')}
						</span>
					)}
				</div>

				{/* Detail fields grid */}
				<div className="space-y-2 text-[11px]">
					<div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
						<span className="flex items-center gap-1.5 text-muted-foreground">
							<Workflow className="size-3 text-muted-foreground/70" />
							{t('settings.cluster.details.id')}
						</span>
						<span className="max-w-[150px] truncate font-mono text-[11px] text-foreground">
							{item.id ?? item.agentId ?? '—'}
						</span>
					</div>

					{item.fingerprint ? (
						<div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
							<span className="flex items-center gap-1.5 text-muted-foreground">
								<Fingerprint className="size-3 text-muted-foreground/70" />
								{t('settings.cluster.details.fingerprint')}
							</span>
							<span className="max-w-[150px] truncate font-mono text-[11px] text-foreground" title={item.fingerprint}>
								{item.fingerprint}
							</span>
						</div>
					) : null}

					{primaryEndpoint ? (
						<div className="space-y-1 rounded-md bg-muted/30 p-2">
							<div className="flex items-center justify-between text-muted-foreground">
								<span className="flex items-center gap-1.5">
									<Globe className="size-3 text-muted-foreground/70" />
									{t('settings.cluster.details.endpoints')}
								</span>
								<button
									type="button"
									onClick={() => handleCopyEndpoint(primaryEndpoint)}
									className="flex items-center gap-1 text-[10px] text-primary hover:underline"
								>
									{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
									{copied ? t('settings.cluster.actions.copied') : t('settings.cluster.actions.copyEndpoint')}
								</button>
							</div>
							<p className="truncate font-mono text-[11px] text-foreground">{primaryEndpoint}</p>
						</div>
					) : null}
				</div>
			</div>

			{/* Action footer (distinguish current vs switch) */}
			<div className="border-t border-border/40 pt-3">
				{isCurrentActive ? (
					<div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-600">
						<CheckCircle2 className="size-3.5 shrink-0" />
						<span>{t('settings.cluster.actions.currentlyActive')}</span>
					</div>
				) : (
					<div className="space-y-2">
						<SettingsButton
							className="w-full justify-center shadow-xs"
							disabled={busy || blocked || !node.online}
							onClick={onOpen}
						>
							<ArrowUpRight className="mr-1.5 size-3.5" />
							{t('settings.cluster.actions.switch')}
						</SettingsButton>
						<div className="flex items-start gap-1 px-1 text-[10px] text-muted-foreground">
							<Info className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" />
							<span>{t('settings.cluster.actions.switchHelp')}</span>
						</div>
						{blocked ? (
							<div className="flex items-center gap-1.5 text-[10px] text-destructive">
								<ShieldAlert className="size-3 shrink-0" />
								<span className="truncate">{gated?.message || t('settings.cluster.unreachable')}</span>
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
