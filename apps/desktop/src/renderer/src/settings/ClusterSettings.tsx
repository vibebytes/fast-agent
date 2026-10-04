import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Input} from '@fast-ide/ui/components/input';
import type {ClusterRosterItem, ClusterStatusPayload} from '@fast-ide/session-view';
import {
	MonoTag,
	SettingsButton,
	SettingsRow,
	SettingsSection,
	SettingsState,
	SettingsStatusBadge
} from './SettingsPrimitives';

type Phase = 'idle' | 'joining' | 'joined' | 'leaving' | 'failed';

const phaseBadge = (phase: Phase): 'healthy' | 'warning' | 'error' | 'neutral' =>
	phase === 'joined' ? 'healthy' : phase === 'joining' || phase === 'leaving' ? 'warning' : phase === 'failed' ? 'error' : 'neutral';

function memberName(item: ClusterRosterItem): string {
	return item.displayName || item.agentId || item.id || '?';
}

function memberKey(item: ClusterRosterItem): string {
	return item.id ?? item.agentId ?? memberName(item);
}

/** Engine presence vocabulary is Idle / InTurn / Unavailable. */
function memberOnline(item: ClusterRosterItem): boolean {
	return item.presence !== 'Unavailable';
}

function presenceKey(item: ClusterRosterItem): string {
	return item.presence === 'Unavailable' ? 'unavailable' : item.presence === 'InTurn' ? 'inTurn' : 'idle';
}

type MapNode = {item: ClusterRosterItem; x: number; y: number; online: boolean; key: string};

const MAX_RING_NODES = 12;

/** §2.1: 本机固定中心，成员环排（按 id 排序保证位置稳定），不画节点间连线。 */
function ClusterMap({
	roster,
	phase,
	selected,
	onSelect
}: {
	roster: ClusterRosterItem[];
	phase: Phase;
	selected: string | null;
	onSelect: (key: string) => void;
}) {
	const {t} = useTranslation();
	const cx = 200;
	const cy = 120;
	const radius = 82;
	const switching = phase === 'joining' || phase === 'leaving';
	const selfItem = roster.find(item => item.self) ?? null;
	const others = roster.filter(item => item !== selfItem).sort((a, b) => memberKey(a).localeCompare(memberKey(b)));
	const shown = others.slice(0, MAX_RING_NODES);
	const hidden = others.length - shown.length;
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
		<div className="flex flex-col items-center gap-2 py-3">
			<svg viewBox="0 0 400 240" className="w-full max-w-md" role="img" aria-label={t('settings.cluster.mapTitle')}>
				<circle cx={cx} cy={cy} r={radius} className="fill-none stroke-border/40" strokeWidth={1} strokeDasharray="2 4" />
				{selfNode ? (
					<g key={selfNode.key} className="cursor-pointer" onClick={() => onSelect(selfNode.key)}>
						<title>{memberName(selfNode.item)}</title>
						<circle
							cx={cx}
							cy={cy}
							r={14}
							className={`${selfNode.online ? 'fill-primary/20' : 'fill-muted'} ${selected === selfNode.key ? 'stroke-primary' : 'stroke-primary/50'} ${switching ? 'animate-pulse' : ''}`}
							strokeWidth={1.5}
						/>
						<text x={cx} y={cy + 4} textAnchor="middle" className="fill-foreground text-[8px] font-semibold">
							{roster.filter(memberOnline).length}
						</text>
						<text x={cx} y={cy + 32} textAnchor="middle" className="fill-muted-foreground text-[9px]">
							{t('settings.cluster.self')}
						</text>
					</g>
				) : null}
				{nodes.map(n => (
					<g key={n.key} className="cursor-pointer" onClick={() => onSelect(n.key)}>
						<title>{`${memberName(n.item)} · ${t(`settings.cluster.presence.${presenceKey(n.item)}`)}`}</title>
						<circle
							cx={n.x}
							cy={n.y}
							r={6}
							className={`${n.online ? 'fill-emerald-500 stroke-emerald-500/40' : 'fill-muted stroke-border'} ${selected === n.key ? 'stroke-primary' : ''}`}
							strokeWidth={1.5}
						/>
						<text
							x={n.x}
							y={n.y + (n.y >= cy ? 19 : -11)}
							textAnchor="middle"
							className={n.online ? 'fill-foreground text-[9px]' : 'fill-muted-foreground text-[9px]'}
						>
							{memberName(n.item).length > 14 ? `${memberName(n.item).slice(0, 13)}…` : memberName(n.item)}
						</text>
					</g>
				))}
			</svg>
			{switching ? <p className="animate-pulse text-[11px] text-primary">{t('settings.cluster.mapSwitching')}</p> : null}
			{detail ? <MemberDetails node={detail} /> : <p className="text-[11px] text-muted-foreground">{t('settings.cluster.selectHint')}</p>}
			{hidden > 0 ? <MonoTag>{`+${hidden}`}</MonoTag> : null}
		</div>
	);
}

/** §2.3 成员详情：只读字段展示。 */
function MemberDetails({node}: {node: MapNode}) {
	const {t} = useTranslation();
	const item = node.item;
	const rows: Array<[string, string]> = [
		[t('settings.cluster.details.id'), item.id ?? item.agentId ?? '—'],
		[t('settings.cluster.details.fingerprint'), item.fingerprint ?? '—'],
		[t('settings.cluster.details.endpoints'), item.endpoints?.length ? item.endpoints.join(', ') : '—'],
		[t('settings.cluster.details.presence'), t(`settings.cluster.presence.${presenceKey(item)}`)]
	];
	return (
		<div className="w-full max-w-md rounded-lg border bg-muted/30 px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[12px] font-medium">{memberName(item)}</p>
				{item.self ? <MonoTag>{t('settings.cluster.details.self')}</MonoTag> : null}
			</div>
			<dl className="mt-1 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1">
				{rows.map(([label, value]) => (
					<div key={label} className="col-span-1 col-start-1 col-end-3 grid grid-cols-subgrid">
						<dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
						<dd className="truncate font-mono text-[11px]">{value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

/** 语义化成员列表：键盘可达，选择与地图联动。 */
function MemberList({
	roster,
	selected,
	onSelect
}: {
	roster: ClusterRosterItem[];
	selected: string | null;
	onSelect: (key: string) => void;
}) {
	const {t} = useTranslation();
	return (
		<ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto" aria-label={t('settings.cluster.members')}>
			{roster.map(item => {
				const key = memberKey(item);
				const online = memberOnline(item);
				return (
					<li key={key}>
						<button
							type="button"
							onClick={() => onSelect(key)}
							className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/60 ${selected === key ? 'bg-muted' : ''}`}
						>
							<span className={`size-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
							<span className="truncate text-[12px]">{memberName(item)}</span>
							{item.self ? <span className="text-[10px] text-muted-foreground">{t('settings.cluster.self')}</span> : null}
							<span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{item.endpoints?.[0] ?? ''}</span>
							<span className={`shrink-0 text-[10px] ${online ? 'text-emerald-600' : 'text-muted-foreground'}`}>
								{t(`settings.cluster.presence.${presenceKey(item)}`)}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

const MAX_NAME_LENGTH = 40;

export function ClusterSettings() {
	const {t} = useTranslation();
	const [status, setStatus] = useState<ClusterStatusPayload | null>(null);
	const [roster, setRoster] = useState<ClusterRosterItem[]>([]);
	const [peer, setPeer] = useState('');
	const [advertised, setAdvertised] = useState('');
	const [engineName, setEngineName] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);

	useEffect(() => {
		void window.fastIde.getClusterStatus().then(setStatus);
		void window.fastIde.listClusterRoster().then(r => setRoster(r.items));
		const offStatus = window.fastIde.onClusterStatus(setStatus);
		const offRoster = window.fastIde.onClusterRoster(setRoster);
		return () => {
			offStatus();
			offRoster();
		};
	}, []);

	const phase = (status?.phase ?? 'idle') as Phase;
	const joined = phase === 'joined' || phase === 'joining' || phase === 'leaving';
	const switching = phase === 'joining' || phase === 'leaving';
	const sortedRoster = [...roster].sort((a, b) => {
		if (a.self !== b.self) return a.self ? -1 : 1;
		return memberKey(a).localeCompare(memberKey(b));
	});
	const visibleRoster = sortedRoster.some(item => item.self)
		? sortedRoster
		: [
				{
					id: 'local',
					displayName: engineName.trim() || t('settings.cluster.self'),
					self: true,
					presence: 'Idle'
				},
				...sortedRoster
			];

	const peerTarget = () => peer.trim().replace(/^engine:\/\//, '');

	const join = async () => {
		setBusy(true);
		setNotice(null);
		try {
			await window.fastIde.joinCluster({
				peerAddress: peerTarget(),
				advertisedAddress: advertised.trim() || undefined,
				displayName: engineName.trim() || undefined
			});
			setPeer('');
			setAdvertised('');
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const openMember = async (item: ClusterRosterItem) => {
		setBusy(true);
		setNotice(null);
		try {
			const result = await window.fastIde.openClusterIndividual({
				self: Boolean(item.self),
				agentId: item.agentId ?? item.id,
				endpoints: item.endpoints,
				fingerprint: item.fingerprint,
				token: item.token,
				mainSessionId: item.mainSessionId
			});
			if (!result.ok) setNotice(result.message || t('settings.cluster.unreachable'));
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const selectMember = (key: string) => {
		setSelected(key);
		const item = visibleRoster.find(row => memberKey(row) === key);
		if (item) void openMember(item);
	};

	const leave = async () => {
		setBusy(true);
		setNotice(null);
		try {
			await window.fastIde.leaveCluster();
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mx-auto w-full max-w-2xl space-y-4">
			<SettingsSection title={t('settings.cluster.statusTitle')}>
				<SettingsRow
					title={
						<div className="flex items-center gap-2">
							<SettingsStatusBadge status={phaseBadge(phase)} />
							<span>{t(`settings.cluster.phase.${phase}`)}</span>
						</div>
					}
					description={status?.error ? t('settings.cluster.errorTitle') : status?.advertisedAddress}
				>
					{status?.error ? <span className="font-mono text-[11px] text-destructive">{status.error}</span> : null}
				</SettingsRow>
			</SettingsSection>

			<SettingsSection title={t('settings.cluster.mapTitle')}>
				{switching ? (
					<p className="mb-1 text-[11px] text-amber-600 dark:text-amber-400">{t('settings.cluster.mapSwitching')}</p>
				) : null}
				<ClusterMap roster={visibleRoster} phase={phase} selected={selected} onSelect={selectMember} />
				{phase === 'idle' ? (
					<p className="text-center text-[11px] text-muted-foreground">{t('settings.cluster.notJoined')}</p>
				) : roster.length === 0 ? (
					<p className="text-center text-[11px] text-muted-foreground">{t('settings.cluster.emptyRoster')}</p>
				) : null}
				<MemberList roster={visibleRoster} selected={selected} onSelect={selectMember} />
			</SettingsSection>

			<SettingsSection title={t('settings.navigation.cluster')}>
				<SettingsRow title={t('settings.cluster.engineName')} description={t('settings.cluster.engineNameHint')}>
					<Input
						value={engineName}
						onChange={e => setEngineName(e.target.value.slice(0, MAX_NAME_LENGTH))}
						placeholder="engine-a"
						disabled={busy}
						className="w-56"
					/>
				</SettingsRow>
				<SettingsRow title={t('settings.cluster.peerAddress')} description={t('settings.cluster.joinHint')}>
					<Input
						value={peer}
						onChange={e => setPeer(e.target.value)}
						placeholder={t('settings.cluster.peerPlaceholder')}
						disabled={busy || joined}
						className="w-56 font-mono"
					/>
				</SettingsRow>
				<SettingsRow title={t('settings.cluster.advertisedAddress')} description={t('settings.cluster.advertisedPlaceholder')}>
					<Input
						value={advertised}
						onChange={e => setAdvertised(e.target.value)}
						placeholder="10.0.0.8:2580"
						disabled={busy}
						className="w-56 font-mono"
					/>
				</SettingsRow>
				<div className="flex items-center justify-end gap-2 pt-1">
					{joined ? (
						<SettingsButton variant="ghost" disabled={busy || phase === 'leaving'} onClick={leave}>
							{busy && phase === 'leaving' ? t('settings.cluster.leaving') : t('settings.cluster.leave')}
						</SettingsButton>
					) : null}
					<SettingsButton disabled={busy || joined || !peer.trim()} onClick={join}>
						{busy && phase === 'joining' ? t('settings.cluster.joining') : t('settings.cluster.join')}
					</SettingsButton>
				</div>
				{notice ? (
					<p className="pt-1 text-right text-[11px] text-destructive" role="alert">
						{notice}
					</p>
				) : null}
			</SettingsSection>
		</div>
	);
}
