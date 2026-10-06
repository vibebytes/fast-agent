import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Plus} from 'lucide-react';
import type {ClusterRosterItem, ClusterStatusPayload} from '@fast-ide/session-view';
import {
	MonoTag,
	PulseStatusBadge,
	SettingsButton,
	SettingsSection,
	SettingsState
} from './SettingsPrimitives';
import {
	ClusterMap,
	isBlocked,
	memberKey,
	memberName,
	memberOnline,
	presenceKey,
	reachOf,
	type Phase,
	type ReachMap
} from './ClusterMap';
import {JoinClusterDialog} from './JoinClusterDialog';
import {LeaveClusterDialog} from './LeaveClusterDialog';

const phaseBadge = (phase: Phase): 'healthy' | 'warning' | 'error' | 'neutral' =>
	phase === 'joined' ? 'healthy' : phase === 'joining' || phase === 'leaving' ? 'warning' : phase === 'failed' ? 'error' : 'neutral';

/** 语义化成员列表：键盘可达，选择与地图联动。 */
function MemberList({
	roster,
	selected,
	reach,
	onSelect
}: {
	roster: ClusterRosterItem[];
	selected: string | null;
	reach: ReachMap;
	onSelect: (key: string) => void;
}) {
	const {t} = useTranslation();
	return (
		<ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto" aria-label={t('settings.cluster.members')}>
			{roster.map(item => {
				const key = memberKey(item);
				const online = memberOnline(item);
				const gated = reachOf(item, reach);
				const blocked = isBlocked(gated);
				return (
					<li key={key}>
						<button
							type="button"
							disabled={blocked}
							onClick={() => onSelect(key)}
							className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60 ${selected === key ? 'bg-muted' : ''}`}
						>
							<span className={`size-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
							<span className="truncate text-[12px]">{memberName(item)}</span>
							{item.self ? <span className="text-[10px] text-muted-foreground">{t('settings.cluster.self')}</span> : null}
							<span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
								{blocked ? gated?.message : item.endpoints?.[0] ?? ''}
							</span>
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

export function ClusterSettings() {
	const {t} = useTranslation();
	const [status, setStatus] = useState<ClusterStatusPayload | null>(null);
	const [roster, setRoster] = useState<ClusterRosterItem[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [reach, setReach] = useState<ReachMap>({});
	const [joinOpen, setJoinOpen] = useState(false);
	const [leaveOpen, setLeaveOpen] = useState(false);

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

	useEffect(() => {
		if (roster.length === 0) {
			setReach({});
			return;
		}
		let cancelled = false;
		void window.fastIde.probeClusterRoster(roster).then(result => {
			if (cancelled) return;
			const next: ReachMap = {};
			for (const row of result.items) {
				if (row.agentId) next[row.agentId] = {reach: row.reach, message: row.message};
			}
			setReach(next);
		});
		return () => {
			cancelled = true;
		};
	}, [roster]);

	const phase = (status?.phase ?? 'idle') as Phase;
	const joined = phase === 'joined' || phase === 'joining' || phase === 'leaving';
	const onlineCount = roster.filter(memberOnline).length;
	const updatedAt = status?.updatedAt ? new Date(status.updatedAt).toLocaleTimeString() : null;

	const sortedRoster = [...roster].sort((a, b) => {
		if (a.self !== b.self) return a.self ? -1 : 1;
		return memberKey(a).localeCompare(memberKey(b));
	});
	const selfItem = sortedRoster.find(item => item.self) ?? null;
	const visibleRoster = selfItem
		? sortedRoster
		: [
				{
					id: 'local',
					displayName: t('settings.cluster.self'),
					self: true,
					presence: 'Idle'
				},
				...sortedRoster
			];

	const join = async (input: {peerAddress: string; advertisedAddress?: string; displayName?: string}) => {
		setBusy(true);
		setNotice(null);
		try {
			await window.fastIde.joinCluster(input);
		} finally {
			setBusy(false);
		}
	};

	const leave = async () => {
		setBusy(true);
		setNotice(null);
		try {
			await window.fastIde.leaveCluster();
		} finally {
			setBusy(false);
		}
	};

	const memberReach = (item: ClusterRosterItem) => reachOf(item, reach);

	const openMember = async (item: ClusterRosterItem) => {
		const blocked = memberReach(item);
		if (isBlocked(blocked)) {
			setNotice(blocked?.message || t('settings.cluster.unreachable'));
			return;
		}
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
		if (!item) return;
		if (isBlocked(memberReach(item))) return;
		void openMember(item);
	};

	const emptyState = () => {
		if (phase === 'failed') {
			return (
				<SettingsState
					status="error"
					title={t('settings.cluster.errorTitle')}
					description={status?.error}
					onRetry={() => void window.fastIde.getClusterStatus().then(setStatus)}
				/>
			);
		}
		if (phase === 'idle') {
			return <SettingsState status="empty" title={t('settings.cluster.notJoined')} />;
		}
		if (roster.length === 0) {
			return <SettingsState status="empty" title={t('settings.cluster.emptyRoster')} />;
		}
		return null;
	};

	const empty = emptyState();

	return (
		<div className="mx-auto w-full max-w-2xl space-y-4">
			<SettingsSection
				title={t('settings.cluster.mapTitle')}
				tone="accent"
				action={
					<div className="flex items-center gap-2">
						{selfItem ? <MonoTag>{memberName(selfItem)}</MonoTag> : null}
						{joined ? (
							<SettingsButton variant="ghost" disabled={busy} onClick={() => setLeaveOpen(true)}>
								{t('settings.cluster.leave')}
							</SettingsButton>
						) : (
							<SettingsButton disabled={busy} onClick={() => setJoinOpen(true)}>
								<Plus className="mr-1 size-3.5" />
								{t('settings.cluster.join')}
							</SettingsButton>
						)}
					</div>
				}
			>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[11px] text-muted-foreground">
					<PulseStatusBadge status={phaseBadge(phase)} label={t(`settings.cluster.phase.${phase}`)} />
					<span>{t('settings.cluster.onlineCount', {count: onlineCount})}</span>
					{status?.advertisedAddress ? <MonoTag>{status.advertisedAddress}</MonoTag> : null}
					{updatedAt ? (
						<span>
							{t('settings.cluster.updatedAt')} {updatedAt}
						</span>
					) : null}
				</div>
				<div className="px-4 pb-3">
					{empty ? (
						empty
					) : (
						<>
							<ClusterMap
								roster={visibleRoster}
								phase={phase}
								selected={selected}
								reach={reach}
								onSelect={selectMember}
							/>
							<div className="mt-3">
								<MemberList roster={visibleRoster} selected={selected} reach={reach} onSelect={selectMember} />
							</div>
						</>
					)}
				</div>
				{notice ? (
					<p className="px-4 pb-3 text-[11px] text-destructive" role="alert">
						{notice}
					</p>
				) : null}
			</SettingsSection>

			<JoinClusterDialog open={joinOpen} onOpenChange={setJoinOpen} busy={busy} onJoin={join} />
			<LeaveClusterDialog open={leaveOpen} onOpenChange={setLeaveOpen} busy={busy} onLeave={leave} />
		</div>
	);
}
