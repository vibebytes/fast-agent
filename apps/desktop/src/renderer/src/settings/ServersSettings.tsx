import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Check, Copy, Eye, EyeOff, HardDrive, LoaderCircle, Plus, Smartphone, Trash2} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {Switch} from '@fast-ide/ui/components/switch';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@fast-ide/ui/components/tabs';
import {encodeQrMatrix} from './qr';
import {pairingPayload} from './pairingPayload';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import type {CloudflareTunnelStatus, EdgePublic, EdgesList, MobilePairingInfo} from '@fast-ide/session-view';
import {
	SettingsButton,
	SettingsPageHeader,
	SettingsRow,
	SettingsSection,
	SettingsState
} from './SettingsPrimitives';

type Draft = {
	id?: string;
	name: string;
	ip: string;
	port: string;
	token: string;
	fingerprint?: string;
};

const emptyDraft = (): Draft => ({
	name: '',
	ip: '',
	port: '1979',
	token: ''
});

const QR_BLUR_AFTER_MS = 120_000;

type PinAsk = {fingerprint: string; display: string; resume: 'test' | 'save'};

function PairingQr({
	serverUrl,
	token,
	fingerprint,
	trust,
	serverKey
}: {
	serverUrl: string;
	token: string;
	fingerprint: string;
	trust?: 'public';
	serverKey?: string;
}) {
	const {t} = useTranslation();
	const matrix = useMemo(
		() => encodeQrMatrix(pairingPayload({serverUrl, token, fingerprint, trust, serverKey})),
		[serverUrl, token, fingerprint, trust, serverKey]
	);
	const n = matrix.length;
	const quiet = 4;
	const box = n + quiet * 2;
	return (
		<svg
			width={200}
			height={200}
			viewBox={`0 0 ${box} ${box}`}
			shapeRendering="crispEdges"
			className="shrink-0 rounded-md bg-white"
			role="img"
			aria-label={t('settings.pages.servers.pairingQrAria')}
		>
			<rect width={box} height={box} fill="#fff" />
			{matrix.flatMap((row, y) =>
				row.map((dark, x) =>
					dark ? (
						<rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#000" />
					) : null
				)
			)}
		</svg>
	);
}

function CopyField({label, value, copiedLabel}: {label: string; value: string; copiedLabel: string}) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="grid gap-1 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono">
					{value}
				</code>
				<SettingsButton
					variant="ghost"
					onClick={() => {
						void navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
					{copied ? copiedLabel : null}
				</SettingsButton>
			</div>
		</div>
	);
}

function SecretField({
	label,
	value,
	copiedLabel,
	showLabel,
	hideLabel
}: {
	label: string;
	value: string;
	copiedLabel: string;
	showLabel: string;
	hideLabel: string;
}) {
	const [reveal, setReveal] = useState(false);
	const [copied, setCopied] = useState(false);
	return (
		<div className="grid gap-1 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono">
					{reveal ? value : '●●●●●●●●'}
				</code>
				<SettingsButton variant="ghost" onClick={() => setReveal(r => !r)} aria-label={reveal ? hideLabel : showLabel}>
					{reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
				</SettingsButton>
				<SettingsButton
					variant="ghost"
					onClick={() => {
						void navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
					{copied ? copiedLabel : null}
				</SettingsButton>
			</div>
		</div>
	);
}

export function ServersSettings() {
	const {t} = useTranslation();
	const [list, setList] = useState<EdgesList | null>(null);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<Draft>(emptyDraft);
	const [busy, setBusy] = useState(false);
	const [testMsg, setTestMsg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmedFingerprint, setConfirmedFingerprint] = useState<string | undefined>();
	const [pinAsk, setPinAsk] = useState<PinAsk | null>(null);
	const [pairing, setPairing] = useState<MobilePairingInfo | null>(null);

	const [channel, setChannel] = useState<'lan' | 'cloudflare'>(() => {
		const saved = window.localStorage.getItem('servers.pairingChannel');
		return saved === 'cloudflare' ? 'cloudflare' : 'lan';
	});
	const [cf, setCf] = useState<CloudflareTunnelStatus>({state: 'disabled'});
	const cfBusy = cf.state === 'starting' || cf.state === 'stopping';

	useEffect(() => {
		window.localStorage.setItem('servers.pairingChannel', channel);
	}, [channel]);

	useEffect(() => {
		void window.fastIde.listEdges().then(setList);
		return window.fastIde.onEdgesChanged(setList);
	}, []);

	useEffect(() => {
		void window.fastIde.mobilePairingInfo().then(setPairing);
	}, [list]);

	useEffect(() => {
		void window.fastIde.cloudflareTunnelStatus().then(setCf);
		return window.fastIde.onCloudflareTunnelChanged(setCf);
	}, []);

	async function startCloudflare() {
		if (cfBusy) return;
		setCf(await window.fastIde.cloudflareTunnelStart());
	}

	async function stopCloudflare() {
		if (cfBusy) return;
		if (cf.state === 'ready' && !window.confirm(t('settings.pages.servers.cloudflareStopConfirm'))) return;
		setCf(await window.fastIde.cloudflareTunnelStop());
	}

	async function copyFullPairing() {
		if (cf.state !== 'ready') return;
		if (!window.confirm(t('settings.pages.servers.cloudflareCopyFullConfirm'))) return;
		await navigator.clipboard.writeText(
			pairingPayload({serverUrl: cf.url, token: pairing?.token ?? '', trust: 'public', serverKey: cf.serverKey})
		);
	}

	const pending = Boolean(list?.pendingEdgeId);

	const [qrHidden, setQrHidden] = useState(false);
	const [qrBlur, setQrBlur] = useState(false);
	// 引擎仅在配对监听开启时经 GetBridgePairing 下发 token；ready 时重拉一次，
	// 兼治「先开隧道后开配对」与引擎重启 token 轮换后的 stale 二维码。
	const cfReadyUrl = cf.state === 'ready' ? cf.url : null;
	useEffect(() => {
		if (!cfReadyUrl) return;
		let alive = true;
		void window.fastIde.mobilePairingInfo().then((info) => {
			if (alive) setPairing(info);
		});
		return () => {
			alive = false;
		};
	}, [cfReadyUrl]);
	const cfTokenReady = Boolean(pairing?.available && pairing.token);
	const [blurEpoch, setBlurEpoch] = useState(0);
	useEffect(() => {
		if (cf.state !== 'ready' || qrHidden) return;
		setQrBlur(false);
		const timer = window.setTimeout(() => setQrBlur(true), QR_BLUR_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [cf.state, qrHidden, blurEpoch]);

	const [lanToggle, setLanToggle] = useState<'on' | 'off' | null>(null);
	const [lanError, setLanError] = useState<string | null>(null);
	const lanBusy = lanToggle !== null;
	const lanBindError = lanError ? /bind|address already in use|eaddrinuse/i.test(lanError) : false;
	const activeEdge =
		list?.activeId && list.activeId !== 'local'
			? list.servers.find(s => s.id === list.activeId)
			: undefined;

	async function toggleLanPairing(enabled: boolean) {
		if (lanToggle) return;
		setLanToggle(enabled ? 'on' : 'off');
		setLanError(null);
		const timer = window.setTimeout(() => {
			setLanToggle(null);
			setLanError(t('settings.pages.servers.mobilePairingTimeout'));
		}, 5000);
		try {
			const next = await window.fastIde.setLanPairing(enabled);
			setPairing(next);
			if (next.error) setLanError(next.error);
		} catch {
			setLanError(t('settings.pages.servers.mobilePairingFailed'));
		} finally {
			window.clearTimeout(timer);
			setLanToggle(null);
		}
	}

	function pinFor(d: Draft = draft): string | undefined {
		return d.fingerprint || confirmedFingerprint;
	}

	async function edit(row: EdgePublic) {
		const detail = await window.fastIde.getEdge(row.id);
		if (!detail) return;
		setDraft({
			id: detail.id,
			name: detail.name,
			ip: detail.ip,
			port: String(detail.port),
			token: detail.token,
			fingerprint: detail.fingerprint
		});
		setConfirmedFingerprint(detail.fingerprint);
		setPinAsk(null);
		setTestMsg(null);
		setError(null);
		setOpen(true);
	}

	async function save(fp = pinFor()) {
		setBusy(true);
		setError(null);
		const res = await window.fastIde.upsertEdge({
			id: draft.id,
			name: draft.name,
			ip: draft.ip,
			port: Number(draft.port),
			token: draft.token,
			fingerprint: fp
		});
		setBusy(false);
		if (!res.ok && res.code === 'confirm' && res.fingerprint && res.display) {
			setPinAsk({fingerprint: res.fingerprint, display: res.display, resume: 'save'});
			return;
		}
		if (!res.ok && res.code === 'mismatch') {
			setError(t('settings.pages.servers.fingerprintMismatch'));
			return;
		}
		if (!res.ok && res.code === 'plaintext') {
			setError(t('settings.pages.servers.tlsPlaintext'));
			return;
		}
		if (!res.ok) {
			setError(res.message);
			return;
		}
		setOpen(false);
	}

	async function test(fp = pinFor()) {
		setBusy(true);
		setTestMsg(null);
		const res = await window.fastIde.testEdge({
			ip: draft.ip,
			port: Number(draft.port),
			token: draft.token,
			fingerprint: fp
		});
		setBusy(false);
		if (!res.ok && res.code === 'confirm' && res.fingerprint && res.display) {
			setPinAsk({fingerprint: res.fingerprint, display: res.display, resume: 'test'});
			return;
		}
		if (!res.ok && res.code === 'mismatch') {
			setTestMsg(t('settings.pages.servers.fingerprintMismatch'));
			return;
		}
		if (!res.ok && res.code === 'plaintext') {
			setTestMsg(t('settings.pages.servers.tlsPlaintext'));
			return;
		}
		if (res.ok) {
			const pinned = res.fingerprint ?? fp;
			if (pinned) {
				setConfirmedFingerprint(pinned);
				setDraft(d => ({...d, fingerprint: pinned}));
			}
			setTestMsg(t('settings.pages.servers.testOk'));
			return;
		}
		setTestMsg(t('settings.pages.servers.testFail', {code: res.code, message: res.message}));
	}

	function acceptPin() {
		if (!pinAsk) return;
		const {fingerprint, resume} = pinAsk;
		setPinAsk(null);
		setConfirmedFingerprint(fingerprint);
		setDraft(d => ({...d, fingerprint}));
		if (resume === 'test') void test(fingerprint);
		else void save(fingerprint);
	}

	async function remove(id: string) {
		if (pending) return;
		if (list?.runActive && list.activeId === id) {
			if (!window.confirm(t('shell.sidebar.switchEdgeConfirm'))) return;
		}
		const res = await window.fastIde.deleteEdge(id);
		if (!res.ok) setError(res.message);
	}

	return (
		<>
			<SettingsPageHeader
				icon={HardDrive}
				title={t('settings.navigation.servers')}
				description={t('settings.navigation.serversDescription')}
			/>
			<SettingsSection
				title={t('settings.pages.servers.edges')}
				description={t('settings.pages.servers.edgesDescription')}
				action={
					<SettingsButton
						disabled={pending}
						onClick={() => {
							setDraft(emptyDraft());
							setConfirmedFingerprint(undefined);
							setPinAsk(null);
							setTestMsg(null);
							setError(null);
							setOpen(true);
						}}
					>
						<Plus className="size-3.5" />
						{t('settings.pages.servers.add')}
					</SettingsButton>
				}
			>
				{(list?.servers.length ?? 0) === 0 ? (
					<SettingsState
						status="empty"
						title={t('settings.pages.servers.empty')}
						description={t('settings.pages.servers.emptyDescription')}
					/>
				) : (
					list?.servers.map(row => (
						<SettingsRow
							key={row.id}
							title={row.name}
							description={`${row.ip}:${row.port}`}
							onClick={pending ? undefined : () => void edit(row)}
						>
							<SettingsButton
								variant="ghost"
								disabled={pending}
								onClick={e => {
									e.stopPropagation();
									void remove(row.id);
								}}
							>
								<Trash2 className="size-3.5" />
							</SettingsButton>
						</SettingsRow>
					))
				)}
			</SettingsSection>

			<SettingsSection
				title={t('settings.pages.servers.mobilePairing')}
				description={t('settings.pages.servers.mobilePairingDescription')}
			>
				<Tabs
					value={channel}
					onValueChange={v => setChannel(v === 'cloudflare' ? 'cloudflare' : 'lan')}
					className="px-4 pb-4"
				>
					<TabsList>
						<TabsTrigger value="lan">{t('settings.pages.servers.cloudflareTabLan')}</TabsTrigger>
						<TabsTrigger value="cloudflare">
							{t('settings.pages.servers.cloudflareTab')}
						</TabsTrigger>
					</TabsList>
					<TabsContent value="lan" className="pt-4">
					<SettingsRow
					icon={Smartphone}
					title={t('settings.pages.servers.mobilePairing')}
					badge={
						<span className="max-w-40 truncate rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
							{t('settings.pages.servers.mobilePairingTargetLabel')}{' '}
							{activeEdge
								? t('settings.pages.servers.mobilePairingTargetRemote', {name: activeEdge.name, host: activeEdge.ip})
								: t('settings.pages.servers.mobilePairingTargetLocal')}
						</span>
					}
					description={
						pending
							? t('settings.pages.servers.mobilePairingPendingEdge')
							: lanToggle === 'on'
								? t('settings.pages.servers.mobilePairingStarting')
								: lanToggle === 'off'
									? t('settings.pages.servers.mobilePairingStopping')
									: undefined
					}
				>
					{lanBusy ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : null}
					<Switch
						checked={pairing?.available ?? false}
						disabled={lanBusy || pending}
						aria-label={t('settings.pages.servers.mobilePairing')}
						onCheckedChange={next => void toggleLanPairing(next)}
					/>
				</SettingsRow>
				{pairing?.available && lanToggle !== 'off' ? (
					<div className="grid gap-3 px-4 py-4">
						<CopyField
							label={t('settings.pages.servers.mobilePairingUrl')}
							value={pairing.serverUrl}
							copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
						/>
						<SecretField
							label={t('settings.pages.servers.mobilePairingToken')}
							value={pairing.token}
							copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
							showLabel={t('settings.pages.servers.mobilePairingTokenShow')}
							hideLabel={t('settings.pages.servers.mobilePairingTokenHide')}
						/>
						<CopyField
							label={t('settings.pages.servers.mobilePairingFingerprint')}
							value={pairing.fingerprint}
							copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
						/>
						<div className="flex items-start gap-3">
							<PairingQr
								serverUrl={pairing.serverUrl}
								token={pairing.token}
								fingerprint={pairing.fingerprint}
							/>
							<div className="grid gap-2">
								<p className="text-xs text-muted-foreground">{t('settings.pages.servers.mobilePairingQrHint')}</p>
								<p className="text-xs text-muted-foreground">
									{t('settings.pages.servers.mobilePairingFirewallHint', {port: pairing.port})}
								</p>
							</div>
						</div>
					</div>
				) : lanToggle === 'on' ? (
					<div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
						<LoaderCircle className="size-3.5 animate-spin" />
						{t('settings.pages.servers.mobilePairingStarting')}
					</div>
				) : !lanBusy ? (
					<div className="grid gap-2 px-4 py-4">
						<p className="text-xs text-muted-foreground">
							{t(
								pairing?.reason === 'engine'
									? 'settings.pages.servers.mobilePairingEngineOff'
									: pairing?.reason === 'no_lan'
										? 'settings.pages.servers.mobilePairingNoLan'
										: 'settings.pages.servers.mobilePairingOff'
							)}
						</p>
						{lanError ? (
							<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
								<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
								<div className="grid min-w-0 gap-1 text-xs">
									<p className="font-medium text-destructive">
										{lanBindError
											? t('settings.pages.servers.mobilePairingBindFailed', {port: pairing?.port || 1979})
											: lanError}
									</p>
									{lanBindError ? <p className="break-all text-muted-foreground">{lanError}</p> : null}
									{!pairing?.available ? (
										<SettingsButton
											variant="outline"
											className="w-fit"
											onClick={() => void toggleLanPairing(true)}
										>
											{t('settings.common.retry')}
										</SettingsButton>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				) : null}
					</TabsContent>
					<TabsContent value="cloudflare" className="pt-4">
						<div className="grid gap-3">
							{cf.state === 'disabled' ? (
								<div className="grid gap-3">
									<p className="text-xs text-muted-foreground">
										{t('settings.pages.servers.cloudflareIdle')}
									</p>
									<div>
										<SettingsButton disabled={Boolean(activeEdge) || cfBusy} onClick={() => void startCloudflare()}>
											{t('settings.pages.servers.cloudflareStart')}
										</SettingsButton>
									</div>
								{activeEdge ? (
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{t('settings.pages.servers.cloudflareRemoteUnsupported', {name: activeEdge.name})}</span>
										<SettingsButton variant="outline" onClick={() => void window.fastIde.selectEdge('local')}>
											{t('settings.pages.servers.cloudflareSwitchLocal')}
										</SettingsButton>
									</div>
								) : null}
								</div>
							) : cf.state === 'starting' || cf.state === 'stopping' ? (
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<LoaderCircle className="size-3.5 animate-spin" />
									{cf.state === 'starting'
										? t('settings.pages.servers.cloudflareStarting')
										: t('settings.pages.servers.cloudflareStopping')}
								</div>
							) : cf.state === 'ready' ? (
								<div className="grid gap-3">
									<CopyField
										label={t('settings.pages.servers.cloudflareUrl')}
										value={cf.url}
										copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
									/>
									<div className="flex items-start gap-3 transition-opacity">
									{qrHidden ? (
										<button
											type="button"
											onClick={() => {
												setQrHidden(false);
												setBlurEpoch(e => e + 1);
											}}
											aria-label={t('settings.pages.servers.cloudflareShowQr')}
											className="flex size-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:bg-muted/50"
										>
											<Eye className="size-4" />
											{t('settings.pages.servers.cloudflareQrHidden')}
										</button>
									) : !cfTokenReady ? (
										<div className="grid size-[200px] shrink-0 place-content-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-center">
											<AlertTriangle className="mx-auto size-4 text-amber-600" />
											<p className="text-xs font-medium text-amber-700 dark:text-amber-500">
												{t('settings.pages.servers.cloudflareTokenUnavailable')}
											</p>
										</div>
									) : (
										<div
											className={`relative shrink-0 ${qrBlur ? 'cursor-pointer select-none blur-md' : ''}`}
											onPointerDown={() => {
												setQrBlur(false);
												setBlurEpoch(e => e + 1);
											}}
										>
											<PairingQr
												serverUrl={cf.url}
												token={pairing?.token ?? ''}
												fingerprint=""
												trust="public"
												serverKey={cf.serverKey}
											/>
											<button
												type="button"
												onClick={() => setQrHidden(true)}
												aria-label={t('settings.pages.servers.cloudflareHideQr')}
												title={t('settings.pages.servers.cloudflareHideQr')}
												className="absolute right-1.5 top-1.5 rounded-md bg-black/5 p-1 text-neutral-600 transition-colors hover:bg-black/15"
											>
												<EyeOff className="size-3.5" />
											</button>
										</div>
									)}
									<div className="grid gap-2">
										<p className="text-xs text-muted-foreground">
											{t('settings.pages.servers.cloudflarePublicHint')}
										</p>
										<p className="text-xs text-muted-foreground">
											{t('settings.pages.servers.cloudflareQrHint')}
										</p>
										{qrBlur ? (
											<p className="text-xs text-muted-foreground">
											{t('settings.pages.servers.cloudflareQrBlurred')}
										</p>
									) : null}
									{!cfTokenReady ? (
										<div className="grid gap-2">
											<p className="text-xs text-amber-700 dark:text-amber-500">
												{t('settings.pages.servers.cloudflareTokenUnavailableHint')}
											</p>
											<div>
												<SettingsButton
													variant="outline"
													className="w-fit"
													disabled={lanBusy || pending}
													onClick={() => void toggleLanPairing(true)}
												>
													{t('settings.pages.servers.cloudflareEnableLanPairing')}
												</SettingsButton>
											</div>
											{lanError ? <p className="text-xs text-destructive">{lanError}</p> : null}
										</div>
									) : null}
								</div>
								</div>
								<div className="flex items-center gap-2">
									<SettingsButton variant="outline" disabled={!cfTokenReady} onClick={() => void copyFullPairing()}>
										{t('settings.pages.servers.cloudflareCopyFullPairing')}
									</SettingsButton>
									<SettingsButton variant="outline" disabled={cfBusy} onClick={() => void stopCloudflare()}>
										{t('settings.pages.servers.cloudflareStop')}
									</SettingsButton>
								</div>
								</div>
							) : cf.state === 'failed' ? (
								<div className="grid gap-3">
									<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
										<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
										<div className="grid gap-0.5 text-xs">
											<p className="font-medium text-destructive">
												{t(`settings.pages.servers.cloudflareFailed.${cf.code}`)}
											</p>
											{cf.message ? <p className="break-all text-muted-foreground">{cf.message}</p> : null}
										</div>
									</div>
									<div className="flex gap-2">
										<SettingsButton onClick={() => void startCloudflare()}>
											{t('settings.common.retry')}
										</SettingsButton>
										<SettingsButton variant="outline" onClick={() => setChannel('lan')}>
											{t('settings.pages.servers.cloudflareSwitchLan')}
										</SettingsButton>
									</div>
								</div>
							) : null}
						</div>
					</TabsContent>
				</Tabs>
			</SettingsSection>

			<Dialog
				open={open}
				onOpenChange={next => {
					setOpen(next);
					if (!next) setPinAsk(null);
				}}
			>
				<DialogContent className="gap-4 sm:max-w-lg">
					{pinAsk ? (
						<>
							<DialogHeader>
								<DialogTitle>{t('settings.pages.servers.fingerprintTitle')}</DialogTitle>
								<DialogDescription>{t('settings.pages.servers.fingerprintHint')}</DialogDescription>
							</DialogHeader>
							<pre className="whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
								{pinAsk.display}
							</pre>
							<DialogFooter>
								<SettingsButton
									variant="outline"
									disabled={busy}
									onClick={() => setPinAsk(null)}
								>
									{t('settings.pages.servers.fingerprintReject')}
								</SettingsButton>
								<SettingsButton disabled={busy} onClick={acceptPin}>
									{t('settings.pages.servers.fingerprintAccept')}
								</SettingsButton>
							</DialogFooter>
						</>
					) : (
						<>
							<DialogHeader>
								<DialogTitle>
									{draft.id ? t('settings.pages.servers.edit') : t('settings.pages.servers.add')}
								</DialogTitle>
								<DialogDescription>{t('settings.pages.servers.formHint')}</DialogDescription>
							</DialogHeader>
							<div className="grid gap-3">
								<label className="grid gap-1 text-xs">
									{t('settings.pages.servers.name')}
									<Input
										value={draft.name}
										onChange={e => setDraft(d => ({...d, name: e.target.value}))}
									/>
								</label>
								<div className="grid grid-cols-[1fr_7rem] gap-2">
									<label className="grid gap-1 text-xs">
										{t('settings.pages.servers.ip')}
										<Input
											value={draft.ip}
											onChange={e => {
												setDraft(d => ({...d, ip: e.target.value, fingerprint: undefined}));
												setConfirmedFingerprint(undefined);
											}}
										/>
									</label>
									<label className="grid gap-1 text-xs">
										{t('settings.pages.servers.port')}
										<Input
											value={draft.port}
											onChange={e => {
												setDraft(d => ({...d, port: e.target.value, fingerprint: undefined}));
												setConfirmedFingerprint(undefined);
											}}
										/>
									</label>
								</div>
								<label className="grid gap-1 text-xs">
									{t('settings.pages.servers.token')}
									<Input
										type="password"
										value={draft.token}
										onChange={e => setDraft(d => ({...d, token: e.target.value}))}
									/>
								</label>
								{error ? <p className="text-xs text-destructive">{error}</p> : null}
								{testMsg ? <p className="text-xs text-muted-foreground">{testMsg}</p> : null}
							</div>
							<DialogFooter>
								<SettingsButton variant="outline" disabled={busy} onClick={() => void test()}>
									{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
									{t('settings.pages.servers.test')}
								</SettingsButton>
								<SettingsButton disabled={busy} onClick={() => void save()}>
									{t('settings.pages.servers.save')}
								</SettingsButton>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
