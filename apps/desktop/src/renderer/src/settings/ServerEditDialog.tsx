import {useState} from 'react';
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
import {cn} from '@fast-ide/ui/lib/utils';

export type ServerConfig = {
	transport: 'stdio' | 'remote';
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
};

export function parseKvLines(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const idx = trimmed.indexOf('=');
		if (idx <= 0) continue;
		out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
	}
	return out;
}

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
	const [saving, setSaving] = useState(false);

	const reset = () => {
		const row = editing;
		setName(row?.name ?? '');
		setTransport(row?.transport === 'remote' ? 'remote' : 'stdio');
		setCommand(row?.command ?? '');
		setArgs(Array.isArray(row?.args) ? row.args.join(' ') : (row?.args ?? ''));
		setEnv(kvLinesOf(row?.env));
		setUrl(row?.url ?? '');
		setSaving(false);
	};

	if (!open) return null;

	const invalid = !name.trim() || (transport === 'stdio' ? !command.trim() : !url.trim());

	const save = async () => {
		if (invalid) return;
		setSaving(true);
		const config: ServerConfig =
			transport === 'stdio'
				? {
						transport,
						command: command.trim(),
						args: args.trim() ? args.trim().split(/\s+/) : [],
						env: parseKvLines(env)
					}
				: {
						transport,
						url: url.trim()
					};
		const ok = await onSubmit(name.trim(), config);
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
