import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Activity,
	Laptop,
	Network,
	Plus,
	Radio,
	RefreshCw,
	Server,
	ShieldAlert,
	Sparkles
} from 'lucide-react';
import type {ClusterRosterItem, ClusterStatusPayload, EdgesList} from '@fast-ide/session-view';
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

/** Compact member list: supports keyboard navigation & selection */
function MemberList({
	roster,
	selected,
	reach,
	activeEdgeId,
	onSelect
}: {
	roster: ClusterRosterItem[];
	selected: string | null;
	reach: ReachMap;
	activeEdgeId?: string | null;
	onSelect: (key: string) => void;
}) {
	const {t} = useTranslation();
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
				<span className="flex items-center gap-1.5">
					<Network className="size-3.5" />
					{t('settings.cluster.members')} ({roster.length})
				</span>
				<span>{t('settings.cluster.details.presence')}</span>
			</div>
			<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1" aria-label={t('settings.cluster.members')}>
				{roster.map(item => {
					const key = memberKey(item);
					const online = memberOnline(item);
					const gated = reachOf(item, reach);
					const blocked = isBlocked(gated);
					const isSelected = selected === key;
					const isActive = !activeEdgeId || activeEdgeId === 'local'
						? Boolean(item.self)
						: activeEdgeId === `individual:${item.agentId ?? item.id}` || activeEdgeId === (item.agentId ?? item.id);
					return (
						<li key={key}>
							<button
								type="button"
								onClick={() => onSelect(key)}
								className={`group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
									isSelected
										? isActive
											? 'border-emerald-500/60 bg-emerald-500/10 shadow-xs'
											: 'border-primary/50 bg-primary/10 shadow-xs'
										: isActive
											? 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 hover:bg-emerald-500/10'
											: 'border-border/40 bg-card/30 hover:border-border hover:bg-muted/40'
								}`}
							>
								<div
									className={`flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] ${
										isActive
											? 'bg-emerald-500/20 text-emerald-600 font-bold'
											: item.self
												? 'bg-primary/15 text-primary'
												: online
													? 'bg-emerald-500/15 text-emerald-600'
													: 'bg-muted text-muted-foreground'
									}`}
								>
									{item.self ? <Laptop className="size-3" /> : <Server className="size-3" />}
								</div>

								<div className="flex min-w-0 flex-1 items-center gap-1.5">
									<span className={`truncate text-[12px] ${isSelected ? 'font-semibold text-primary' : 'font-medium'}`}>
										{memberName(item)}
									</span>
									{item.self ? (
										<span className="rounded bg-primary/10 px-1 py-0.2 text-[9px] font-bold text-primary">
											{t('settings.cluster.self')}
										</span>
									) : null}
									{isActive ? (
										<span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600 border border-emerald-500/30">
											{t('settings.cluster.actions.connectedBadge')}
										</span>
									) : null}
								</div>

								<span className="truncate font-mono text-[10px] text-muted-foreground/80 max-w-[130px]">
									{blocked ? gated?.message : item.endpoints?.[0] ?? ''}
								</span>

								<div className="flex shrink-0 items-center gap-1.5 pl-1">
									<span
										className={`size-1.5 rounded-full ${
											blocked ? 'bg-destructive' : online ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-muted-foreground/30'
										}`}
									/>
									<span className={`text-[10px] ${blocked ? 'text-destructive' : online ? 'text-emerald-600' : 'text-muted-foreground'}`}>
										{blocked ? t('settings.cluster.unreachable') : t(`settings.cluster.presence.${presenceKey(item)}`)}
									</span>
								</div>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function ClusterSettings() {
	const {t} = useTranslation();
	const [status, setStatus] = useState<ClusterStatusPayload | null>(null);
	const [roster, setRoster] = useState<ClusterRosterItem[]>([]);
	const [edges, setEdges] = useState<EdgesList | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [reach, setReach] = useState<ReachMap>({});
	const [joinOpen, setJoinOpen] = useState(false);
	const [leaveOpen, setLeaveOpen] = useState(false);

	useEffect(() => {
		void window.fastIde.getClusterStatus().then(setStatus);
		void window.fastIde.listClusterRoster().then(r => setRoster(r.items));
		void window.fastIde.listEdges().then(setEdges);
		const offStatus = window.fastIde.onClusterStatus(setStatus);
		const offRoster = window.fastIde.onClusterRoster(setRoster);
		const offEdges = window.fastIde.onEdgesChanged(setEdges);
		return () => {
			offStatus();
			offRoster();
			offEdges();
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

	// Auto-select self initially
	useEffect(() => {
		if (!selected && visibleRoster.length > 0) {
			const initial = visibleRoster.find(r => r.self) ?? visibleRoster[0];
			if (initial) setSelected(memberKey(initial));
		}
	}, [visibleRoster, selected]);

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
	};

	const refreshRoster = () => {
		void window.fastIde.getClusterStatus().then(setStatus);
		void window.fastIde.listClusterRoster().then(r => setRoster(r.items));
		void window.fastIde.listEdges().then(setEdges);
	};

	return (
		<div className="mx-auto w-full max-w-3xl space-y-4">
			{/* Hero status & action bar */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-linear-to-r from-card/80 via-card/50 to-muted/20 px-4 py-3 shadow-xs">
				<div className="flex items-center gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Radio className="size-4.5 animate-pulse" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<h2 className="text-[14px] font-semibold tracking-tight text-foreground">{t('settings.cluster.mapTitle')}</h2>
							<PulseStatusBadge status={phaseBadge(phase)} label={t(`settings.cluster.phase.${phase}`)} />
						</div>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-[11px] text-muted-foreground">
							<span>{t('settings.cluster.onlineCount', {count: onlineCount})}</span>
							{status?.advertisedAddress ? (
								<>
									<span>·</span>
									<span className="font-mono">{status.advertisedAddress}</span>
								</>
							) : null}
							{updatedAt ? (
								<>
									<span>·</span>
									<span>{t('settings.cluster.updatedAt')} {updatedAt}</span>
								</>
							) : null}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={refreshRoster}
						disabled={busy}
						className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
						title={t('settings.cluster.retry')}
					>
						<RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
					</button>

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
			</div>

			{/* Error banner */}
			{notice ? (
				<div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-[12px] text-destructive">
					<ShieldAlert className="size-4 shrink-0" />
					<span className="flex-1">{notice}</span>
				</div>
			) : null}

			{/* Main area: error state or topology map */}
			{phase === 'failed' ? (
				<SettingsState
					status="error"
					title={t('settings.cluster.errorTitle')}
					description={status?.error}
					onRetry={refreshRoster}
				/>
			) : (
				<SettingsSection className="overflow-hidden border-border/70 p-4">
					<ClusterMap
						roster={visibleRoster}
						phase={phase}
						selected={selected}
						reach={reach}
						activeEdgeId={edges?.activeId}
						busy={busy}
						onSelect={selectMember}
						onOpen={openMember}
					/>

					<div className="mt-4 border-t border-border/40 pt-4">
						<MemberList
							roster={visibleRoster}
							selected={selected}
							reach={reach}
							activeEdgeId={edges?.activeId}
							onSelect={selectMember}
						/>
					</div>
				</SettingsSection>
			)}

			<JoinClusterDialog open={joinOpen} onOpenChange={setJoinOpen} busy={busy} onJoin={join} />
			<LeaveClusterDialog open={leaveOpen} onOpenChange={setLeaveOpen} busy={busy} onLeave={leave} />
		</div>
	);
}
