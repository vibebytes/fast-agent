import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {LoaderCircle, Trash2} from 'lucide-react';
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
import type {Provider} from './useProviders';

export function EditProviderDialog({
	provider,
	open,
	onOpenChange,
	onSave,
	onTest,
	onDelete
}: {
	provider: Provider;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (input: {name?: string; baseUrl?: string; credential?: string}) => Promise<boolean>;
	onTest: () => void;
	onDelete: () => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState(provider.name);
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
	const [credential, setCredential] = useState('');
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		setName(provider.name);
		setBaseUrl(provider.baseUrl ?? '');
		setCredential('');
	}, [provider]);

	const save = async () => {
		setSaving(true);
		try {
			await onSave({
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				...(credential.trim() ? {credential: credential.trim()} : {})
			});
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!confirm(t('settings.providers.deleteConfirm', {name: provider.name}))) return;
		setDeleting(true);
		try {
			await onDelete();
		} finally {
			setDeleting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.providers.editProvider', {name: provider.name})}</DialogTitle>
					<DialogDescription>{t('settings.providers.editProviderDescription')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.providers.name')}</span>
						<Input value={name} onChange={e => setName(e.target.value)} />
					</label>

					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.providers.baseUrl')}</span>
						<Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
					</label>

					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">
							{t('settings.providers.apiKeyOptional')}
						</span>
						<Input
							type="password"
							autoComplete="new-password"
							placeholder={
								provider.last4
									? t('settings.providers.keyLast4', {last4: provider.last4})
									: 'sk-...'
							}
							value={credential}
							onChange={e => setCredential(e.target.value)}
						/>
					</label>
				</div>

				<DialogFooter className="flex flex-row items-center justify-between">
					<SettingsButton
						variant="destructive"
						disabled={deleting || saving}
						onClick={() => void remove()}
					>
						<Trash2 className="mr-1.5 size-3.5" />
						{t('settings.providers.delete')}
					</SettingsButton>

					<div className="flex items-center gap-2">
						<SettingsButton variant="outline" onClick={onTest}>
							{t('settings.providers.test')}
						</SettingsButton>
						<SettingsButton
							disabled={saving || deleting || !name.trim()}
							onClick={() => void save()}
						>
							{saving ? (
								<>
									<LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
									{t('settings.common.saving')}
								</>
							) : (
								t('settings.providers.save')
							)}
						</SettingsButton>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
