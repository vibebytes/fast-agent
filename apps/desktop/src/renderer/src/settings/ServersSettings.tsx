import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, Check, Copy, Eye, EyeOff, HardDrive, LoaderCircle, Plus, Smartphone, Trash2} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {Switch} from '@fast-ide/ui/components/switch';
import {encodeQrMatrix} from './qr';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import type {EdgePublic, EdgesList, MobilePairingInfo} from '@fast-ide/session-view';
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

type PinAsk = {fingerprint: string; display: string; resume: 'test' | 'save'};

function PairingQr({
	serverUrl,
	token,
	fingerprint
}: {
	serverUrl: string;
	token: string;
	fingerprint: string;
}) {
	const matrix = useMemo(() => {
		const payload = `fast-bridge://pair?url=${encodeURIComponent(serverUrl)}&token=${encodeURIComponent(token)}&fingerprint=${encodeURIComponent(fingerprint)}`;
		return encodeQrMatrix(payload);
	}, [serverUrl, token, fingerprint]);
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
			aria-label="pairing QR code"
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

	useEffect(() => {
		void window.fastIde.listEdges().then(setList);
		return window.fastIde.onEdgesChanged(setList);
	}, []);

	useEffect(() => {
		void window.fastIde.mobilePairingInfo().then(setPairing);
	}, [list]);

	const pending = Boolean(list?.pendingEdgeId);

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
