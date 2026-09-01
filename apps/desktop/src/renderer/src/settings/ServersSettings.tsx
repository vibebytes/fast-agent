import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, Copy, HardDrive, LoaderCircle, Plus, Smartphone, Trash2} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
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

function PairingQr({serverUrl, token}: {serverUrl: string; token: string}) {
	const matrix = useMemo(() => {
		const payload = `fast-bridge://pair?url=${encodeURIComponent(serverUrl)}&token=${encodeURIComponent(token)}`;
		return encodeQrMatrix(payload);
	}, [serverUrl, token]);
	const n = matrix.length;
	return (
		<svg
			width={148}
			height={148}
			viewBox={`0 0 ${n} ${n}`}
			shapeRendering="crispEdges"
			className="shrink-0 rounded-md bg-white p-1"
			role="img"
			aria-label="pairing QR code"
		>
			{matrix.flatMap((row, y) =>
				row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000" /> : null))
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
	}, []);

	const pending = Boolean(list?.pendingEdgeId);

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
				{pairing?.available ? (
					<div className="grid gap-3">
						<CopyField
							label={t('settings.pages.servers.mobilePairingUrl')}
							value={pairing.serverUrl}
							copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
						/>
						<CopyField
							label={t('settings.pages.servers.mobilePairingToken')}
							value={pairing.token}
							copiedLabel={t('settings.pages.servers.mobilePairingCopied')}
						/>
						<div className="flex items-center gap-3">
							<PairingQr serverUrl={pairing.serverUrl} token={pairing.token} />
							<p className="text-xs text-muted-foreground">{t('settings.pages.servers.mobilePairingQrHint')}</p>
						</div>
					</div>
				) : (
					<SettingsRow
						icon={Smartphone}
						title={t('settings.pages.servers.mobilePairingOff')}
					/>
				)}
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
