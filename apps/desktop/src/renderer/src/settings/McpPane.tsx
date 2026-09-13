import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Plus, RefreshCw, Search, Upload} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {SettingsButton, SettingsSection, SettingsState} from './SettingsPrimitives';
import {McpServerCard} from './McpServerCard';
import {ServerEditDialog} from './ServerEditDialog';
import {ImportEcosystemDialog} from './ImportEcosystemDialog';
import {mcpNoticeKind, type McpHook} from './useMcpServers';
import type {McpServerRow} from '@fastllm/bridge-client';
import {cn} from '@fast-ide/ui/lib/utils';

export function mcpNoticeCopy(
	notice: string,
	t: (key: string, options?: {defaultValue?: string}) => string
): string {
	const kind = mcpNoticeKind(notice);
	if (kind === 'NeedsRestart') return t('settings.plugins.mcp.restartHint');
	if (kind === 'Busy') return t('settings.plugins.mcp.faultBusy', {defaultValue: notice});
	if (kind === 'InvalidJson') return t('settings.plugins.mcp.faultJson', {defaultValue: notice});
	if (kind === 'Denied') return t('settings.plugins.mcp.faultDenied', {defaultValue: notice});
	if (kind === 'EngineDown') return t('settings.plugins.mcp.faultEngine', {defaultValue: notice});
	return notice;
}

export function McpPane({mcp}: {mcp: McpHook}) {
	const {t} = useTranslation();
	const [filter, setFilter] = useState('');
	const [editOpen, setEditOpen] = useState(false);
	const [editing, setEditing] = useState<McpServerRow | null>(null);
	const [importOpen, setImportOpen] = useState(false);

	const visible = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return mcp.servers;
		return mcp.servers.filter(row =>
			[row.name, row.command, row.url].some(v => (v ?? '').toLowerCase().includes(q))
		);
	}, [mcp.servers, filter]);

	if (mcp.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.plugins.engineUnavailable')}
				description={t('settings.plugins.engineUnavailableDescription')}
			/>
		);
	}
	if (mcp.status === 'loading' && mcp.servers.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (mcp.status === 'error' && mcp.servers.length === 0) {
		return (
			<SettingsState
				status="error"
				title={t('settings.plugins.loadFailed')}
				description={mcp.notice ?? t('settings.plugins.loadFailedDescription')}
				onRetry={mcp.retry}
			/>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-48 flex-1">
					<Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
					<Input
						className="h-8 rounded-lg border-border/70 bg-background/80 pl-8 text-[12px] shadow-none"
						value={filter}
						onChange={e => setFilter(e.target.value)}
						placeholder={t('settings.plugins.mcp.search')}
					/>
				</div>
				<SettingsButton
					className="font-medium shadow-2xs"
					onClick={() => {
						setEditing(null);
						setEditOpen(true);
					}}
				>
					<Plus className="mr-1 size-3.5" />
					{t('settings.plugins.mcp.add')}
				</SettingsButton>
				<SettingsButton
					variant="outline"
					className="font-medium shadow-2xs"
					onClick={() => setImportOpen(true)}
				>
					<Upload className="mr-1 size-3.5" />
					{t('settings.plugins.mcp.import')}
				</SettingsButton>
				<SettingsButton
					variant="outline"
					className="font-medium shadow-2xs"
					disabled={mcp.busy.reload}
					onClick={() => void mcp.reload()}
				>
					<RefreshCw className={cn('mr-1 size-3.5', mcp.busy.reload && 'animate-spin')} />
					{t('settings.plugins.mcp.reload')}
				</SettingsButton>
			</div>

			{visible.length === 0 ? (
				<SettingsSection title={t('settings.plugins.mcp.count', {count: mcp.servers.length})}>
					<SettingsState
						status="empty"
						title={t('settings.plugins.mcp.emptyTitle')}
						description={t('settings.plugins.mcp.emptyDescription')}
					/>
				</SettingsSection>
			) : (
				<SettingsSection title={t('settings.plugins.mcp.count', {count: mcp.servers.length})}>
					<div className="divide-y divide-border/40">
						{visible.map(row => (
							<McpServerCard
								key={row.name}
								row={row}
								busy={mcp.busy[row.name] ?? false}
								onToggle={enabled => void mcp.toggle(row.name, enabled)}
								onRestart={() => void mcp.control(row.name, 'restart')}
								onEdit={() => {
									setEditing(row);
									setEditOpen(true);
								}}
								onDelete={() => void mcp.remove(row.name)}
							/>
						))}
					</div>
				</SettingsSection>
			)}

			<ServerEditDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				editing={editing}
				onSubmit={async (name, config) => mcp.save(name, config)}
			/>
			<ImportEcosystemDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				busy={mcp.busy.import ?? false}
				onImport={async payload => mcp.importServers(payload)}
			/>
		</div>
	);
}
