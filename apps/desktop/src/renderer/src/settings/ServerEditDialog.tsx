import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
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
import type {McpServerRow} from '@fastllm/bridge-client';
import {carriedFields, mergeServerConfig} from './serverConfigForm';
import {cn} from '@fast-ide/ui/lib/utils';

function kvLinesOf(value: Record<string, string> | string[] | undefined): string {
	if (!value) return '';
	if (Array.isArray(value)) return value.join('\n');
	return Object.entries(value)
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');
}

export function ServerEditDialog({
	open,
	onOpenChange,
	editing,
	onSubmit
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing: McpServerRow | null;
	onSubmit: (name: string, config: unknown) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState('');
	const [transport, setTransport] = useState<'stdio' | 'remote'>('stdio');
	const [command, setCommand] = useState('');
	const [args, setArgs] = useState('');
	const [env, setEnv] = useState('');
	const [url, setUrl] = useState('');
	const [autoApprove, setAutoApprove] = useState(true);
	const [mcpApps, setMcpApps] = useState(true);
	const [carried, setCarried] = useState<Record<string, unknown>>({});
	const [saving, setSaving] = useState(false);

	const reset = () => {
		const row = editing;
		setName(row?.name ?? '');
		setTransport(row?.transport === 'remote' ? 'remote' : 'stdio');
		setCommand(row?.command ?? '');
		setArgs(Array.isArray(row?.args) ? row.args.join(' ') : (row?.args ?? ''));
		setEnv(kvLinesOf(row?.env));
		setUrl(row?.url ?? '');
		setAutoApprove(row?.autoApprove ?? (row?.transport !== 'remote'));
		setMcpApps(row?.mcpApps ?? false);
		setCarried(carriedFields(row));
		setSaving(false);
	};

	useEffect(() => {
		if (open) reset();
	}, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps -- re-seed only when the dialog opens or the row changes

	if (!open) return null;

	const invalid = !name.trim() || (transport === 'stdio' ? !command.trim() : !url.trim());

	const save = async () => {
		if (invalid) return;
		setSaving(true);
		const ok = await onSubmit(
			name.trim(),
			mergeServerConfig({transport, command, args, env, url, autoApprove, mcpApps}, carried)
		);
		setSaving(false);
		if (ok) onOpenChange(false);
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
					<DialogTitle>
						{editing ? t('settings.plugins.mcp.editTitle') : t('settings.plugins.mcp.addTitle')}
					</DialogTitle>
					<DialogDescription>{t('settings.plugins.mcpSubtitle')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.plugins.mcp.formName')}</span>
						<Input
							value={name}
							disabled={Boolean(editing)}
							onChange={e => setName(e.target.value)}
							placeholder="filesystem"
						/>
					</label>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">
							{t('settings.plugins.mcp.formTransport')}
						</span>
						<select
							className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							value={transport}
							onChange={e => setTransport(e.target.value as 'stdio' | 'remote')}
						>
							<option value="stdio">{t('settings.plugins.mcp.transportStdio')}</option>
							<option value="remote">{t('settings.plugins.mcp.transportRemote')}</option>
						</select>
					</label>
					{transport === 'stdio' ? (
						<>
							<label className="block space-y-1">
								<span className="text-xs text-muted-foreground">
									{t('settings.plugins.mcp.formCommand')}
								</span>
								<Input
									value={command}
									onChange={e => setCommand(e.target.value)}
									placeholder="npx"
									className={cn('font-mono', !command.trim() && 'border-destructive/50')}
								/>
							</label>
							<label className="block space-y-1">
								<span className="text-xs text-muted-foreground">
									{t('settings.plugins.mcp.formArgs')}
								</span>
								<Input
									value={args}
									onChange={e => setArgs(e.target.value)}
									placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
									className="font-mono"
								/>
								<span className="block text-[11px] text-muted-foreground/70">
									{t('settings.plugins.mcp.formArgsHint')}
								</span>
							</label>
							<label className="block space-y-1">
								<span className="text-xs text-muted-foreground">
									{t('settings.plugins.mcp.formEnv')}
								</span>
								<textarea
									rows={3}
									value={env}
									onChange={e => setEnv(e.target.value)}
									className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px]"
									placeholder={'API_KEY=sk-...'}
								/>
								<span className="block text-[11px] text-muted-foreground/70">
									{t('settings.plugins.mcp.formKvHint')}
								</span>
							</label>
						</>
					) : (
						<>
							<label className="block space-y-1">
								<span className="text-xs text-muted-foreground">
									{t('settings.plugins.mcp.formUrl')}
								</span>
							<Input
								value={url}
								onChange={e => setUrl(e.target.value)}
								placeholder="https://mcp.example.com/sse"
								className={cn('font-mono', !url.trim() && 'border-destructive/50')}
							/>
						</label>
					</>
				)}
					<div className="space-y-2 rounded-md border border-input/60 p-3">
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								className="mt-0.5"
								checked={autoApprove}
								onChange={e => setAutoApprove(e.target.checked)}
							/>
							<span className="space-y-0.5">
								<span className="block text-xs">{t('settings.plugins.mcp.formAutoApprove')}</span>
								<span className="block text-[11px] text-muted-foreground/70">
									{t('settings.plugins.mcp.formAutoApproveHint')}
								</span>
							</span>
						</label>
						<label
							className={cn('flex items-start gap-2', transport === 'remote' && 'opacity-50')}
						>
							<input
								type="checkbox"
								className="mt-0.5"
								checked={transport === 'stdio' && mcpApps}
								disabled={transport === 'remote'}
								onChange={e => setMcpApps(e.target.checked)}
							/>
							<span className="space-y-0.5">
								<span className="block text-xs">{t('settings.plugins.mcp.formMcpApps')}</span>
								<span className="block text-[11px] text-muted-foreground/70">
									{t('settings.plugins.mcp.formMcpAppsHint')}
								</span>
							</span>
						</label>
					</div>
				</div>
				<DialogFooter className="gap-2">
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton type="button" disabled={saving || invalid} onClick={() => void save()}>
						{saving ? t('shell.common.saving') : t('shell.common.save')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
