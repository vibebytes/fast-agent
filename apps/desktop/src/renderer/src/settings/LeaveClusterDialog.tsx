import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {SettingsButton} from './SettingsPrimitives';

export function LeaveClusterDialog({
	open,
	onOpenChange,
	busy,
	onLeave
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onLeave: () => Promise<void>;
}) {
	const {t} = useTranslation();
	const [notice, setNotice] = useState<string | null>(null);

	const submit = async () => {
		setNotice(null);
		try {
			await onLeave();
			onOpenChange(false);
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={next => {
				if (!next) setNotice(null);
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-sm" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.cluster.leaveDialogTitle')}</DialogTitle>
					<DialogDescription>{t('settings.cluster.leaveDialogDescription')}</DialogDescription>
				</DialogHeader>
				{notice ? (
					<p className="text-[11px] text-destructive" role="alert">
						{notice}
					</p>
				) : null}
				<DialogFooter className="gap-2">
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton type="button" variant="destructive" disabled={busy} onClick={() => void submit()}>
						{busy ? t('settings.cluster.leaving') : t('settings.cluster.leave')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
