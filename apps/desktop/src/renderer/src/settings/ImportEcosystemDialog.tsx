import {useMemo, useState} from 'react';
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
import {parseImportPayload} from './useMcpServers';

export function ImportEcosystemDialog({
	open,
	onOpenChange,
	busy,
	onImport
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onImport: (payload: unknown) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [text, setText] = useState('');
	const [importing, setImporting] = useState(false);

	const parsed = useMemo(() => parseImportPayload(text), [text]);

	const runImport = async () => {
		if (!parsed.ok) return;
		setImporting(true);
		const ok = await onImport(parsed.payload);
		setImporting(false);
		if (ok) onOpenChange(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={next => {
				if (!next) setText('');
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.plugins.mcp.importTitle')}</DialogTitle>
					<DialogDescription>{t('settings.plugins.mcp.importDescription')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<textarea
						rows={8}
						value={text}
						onChange={e => setText(e.target.value)}
						className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px]"
						placeholder={
							'{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": [...] }\n  }\n}'
						}
					/>
					{text.trim() ? (
						parsed.ok ? (
							<p className="text-[12px] text-emerald-600 dark:text-emerald-400">
								{t('settings.plugins.mcp.importPreview', {
									count: parsed.count,
									names: Object.keys(parsed.payload.mcpServers).join(', ')
								})}
							</p>
						) : (
							<p className="text-[12px] text-destructive">
								{t('settings.plugins.mcp.importInvalid')}: {parsed.error}
							</p>
						)
					) : null}
				</div>
				<DialogFooter className="gap-2">
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton
						type="button"
						disabled={!parsed.ok || importing || busy}
						onClick={() => void runImport()}
					>
						{importing || busy ? t('shell.common.saving') : t('settings.plugins.mcp.import')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
