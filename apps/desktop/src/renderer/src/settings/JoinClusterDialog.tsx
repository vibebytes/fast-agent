import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {SettingsButton} from './SettingsPrimitives';

const MAX_NAME_LENGTH = 40;

export function JoinClusterDialog({
	open,
	onOpenChange,
	busy,
	onJoin
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onJoin: (input: {peerAddress: string; advertisedAddress?: string; displayName?: string}) => Promise<void>;
}) {
	const {t} = useTranslation();
	const [peer, setPeer] = useState('');
	const [advertised, setAdvertised] = useState('');
	const [engineName, setEngineName] = useState('');
	const [notice, setNotice] = useState<string | null>(null);

	const reset = () => {
		setPeer('');
		setAdvertised('');
		setEngineName('');
		setNotice(null);
	};

	const submit = async () => {
		setNotice(null);
		try {
			await onJoin({
				peerAddress: peer.trim().replace(/^engine:\/\//, ''),
				advertisedAddress: advertised.trim() || undefined,
				displayName: engineName.trim() || undefined
			});
			reset();
			onOpenChange(false);
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={next => {
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-md" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.cluster.joinDialogTitle')}</DialogTitle>
					<DialogDescription>{t('settings.cluster.joinDialogDescription')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.cluster.peerAddress')}</span>
						<Input
							value={peer}
							onChange={e => setPeer(e.target.value)}
							placeholder={t('settings.cluster.peerPlaceholder')}
							disabled={busy}
							className="font-mono"
							autoFocus
						/>
					</label>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.cluster.advertisedAddress')}</span>
						<Input
							value={advertised}
							onChange={e => setAdvertised(e.target.value)}
							placeholder="10.0.0.8:2580"
							disabled={busy}
							className="font-mono"
						/>
					</label>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.cluster.engineName')}</span>
						<Input
							value={engineName}
							onChange={e => setEngineName(e.target.value.slice(0, MAX_NAME_LENGTH))}
							placeholder="engine-a"
							disabled={busy}
						/>
						<span className="block text-[11px] text-muted-foreground/80">{t('settings.cluster.engineNameHint')}</span>
					</label>
					<div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
						<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
						<span>{t('settings.cluster.trustWarning')}</span>
					</div>
					{notice ? (
						<p className="text-[11px] text-destructive" role="alert">
							{notice}
						</p>
					) : null}
				</div>
				<DialogFooter className="gap-2">
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton type="button" disabled={busy || !peer.trim()} onClick={() => void submit()}>
						{busy ? t('settings.cluster.joining') : t('settings.cluster.join')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
