import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronRight, Pencil, RotateCcw, Terminal, Trash2} from 'lucide-react';
import {Switch} from '@fast-ide/ui/components/switch';
import {
	MonoTag,
	PulseStatusBadge,
	SettingsButton
} from './SettingsPrimitives';
import type {McpServerRow} from '@fastllm/bridge-client';
import {cn} from '@fast-ide/ui/lib/utils';

export function rowState(row: McpServerRow): {status: string; key: string} {
	if (!row.enabled) return {status: 'neutral', key: 'disabled'};
	const s = (row.state || row.connectionStatus || '').toLowerCase();
	if (s === 'failed' || s === 'error' || s === 'fail') return {status: 'error', key: 'failed'};
	if (s === 'circuit') return {status: 'warning', key: 'circuit'};
	if (s === 'starting' || s === 'connecting') return {status: 'warning', key: 'starting'};
	if (s === 'running' || s === 'ready' || s === 'connected' || s === 'healthy')
		return {status: 'healthy', key: 'running'};
	if (s.includes('fail') || s.includes('error')) return {status: 'error', key: 'failed'};
	return {status: 'neutral', key: 'stopped'};
}

export function summaryOf(row: McpServerRow): string {
	if (row.transport === 'remote') return row.url || '—';
	const args = Array.isArray(row.args) ? row.args.join(' ') : row.args ?? '';
	return [row.command, args].filter(Boolean).join(' ') || '—';
}

export function McpServerCard({
	row,
	busy,
	onToggle,
	onRestart,
	onEdit,
	onDelete
}: {
	row: McpServerRow;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onRestart: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const {t} = useTranslation();
	const [confirming, setConfirming] = useState(false);
	const [logsOpen, setLogsOpen] = useState(false);
	const state = rowState(row);
	const transport = row.transport === 'remote' ? 'remote' : 'stdio';

	return (
		<div
			className={cn(
				'flex flex-col gap-2 px-4 py-3',
				!row.enabled && 'opacity-60 grayscale-[25%]'
			)}
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-[13px] font-semibold">{row.name}</span>
						<PulseStatusBadge
							status={state.status}
							label={t(`settings.plugins.mcp.state.${state.key}`, {defaultValue: row.state ?? ''})}
						/>
						<MonoTag>{t(`settings.plugins.mcp.transport.${transport}`)}</MonoTag>
						{row.pid ? <MonoTag>{t('settings.plugins.mcp.pid', {pid: row.pid})}</MonoTag> : null}
						{row.restarts ? (
							<MonoTag>{t('settings.plugins.mcp.restarts', {count: row.restarts})}</MonoTag>
						) : null}
						{row.discoveredToolCount ? (
							<MonoTag>{t('settings.plugins.mcp.tools', {count: row.discoveredToolCount})}</MonoTag>
						) : null}
					</div>
					<p className="mt-1.5 truncate font-mono text-[12px] text-muted-foreground/90">
						{summaryOf(row)}
					</p>
					{row.lastError && state.key !== 'starting' ? (
						<p className="mt-1.5 text-[12px] text-destructive">{row.lastError}</p>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
					<SettingsButton
						size="xs"
						variant="outline"
						disabled={busy || !row.enabled}
						onClick={onRestart}
					>
						<RotateCcw className="mr-1 size-3" />
						{t('settings.plugins.mcp.restart')}
					</SettingsButton>
					<SettingsButton
						size="icon-xs"
						variant="ghost"
						disabled={busy}
						onClick={onEdit}
						title={t('settings.plugins.mcp.edit')}
					>
						<Pencil className="size-3.5" />
					</SettingsButton>
					<SettingsButton
						size="icon-xs"
						variant="ghost"
						disabled={busy}
						className={cn(
							confirming
								? 'text-destructive hover:bg-destructive/10'
								: 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
						)}
						onClick={() => {
							if (confirming) {
								setConfirming(false);
								onDelete();
							} else {
								setConfirming(true);
							}
						}}
						onBlur={() => setConfirming(false)}
						title={confirming ? t('settings.plugins.mcp.deleteConfirm') : t('settings.plugins.delete')}
					>
						<Trash2 className="size-3.5" />
					</SettingsButton>
					<Switch
						size="sm"
						checked={row.enabled ?? false}
						disabled={busy}
						onCheckedChange={onToggle}
						aria-label={`Toggle ${row.name}`}
					/>
				</div>
			</div>

			{row.restartRequired ? (
				<div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
					<span className="text-[12px] text-amber-600 dark:text-amber-400">
						{t('settings.plugins.mcp.restartRequired')}
					</span>
					<SettingsButton size="xs" variant="outline" disabled={busy} onClick={onRestart}>
						{t('settings.plugins.mcp.doRestart')}
					</SettingsButton>
				</div>
			) : null}

			{row.stderrTail ? (
				<div className="min-w-0 overflow-hidden rounded-lg border border-border/50 bg-muted/25">
					<button
						type="button"
						className="flex h-7 w-full items-center gap-1.5 px-2.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50"
						onClick={() => setLogsOpen(v => !v)}
						aria-expanded={logsOpen}
					>
						<ChevronRight
							className={cn('size-3 shrink-0 transition-transform duration-150', logsOpen && 'rotate-90')}
						/>
						<Terminal className="size-3 shrink-0 opacity-70" />
						{t('settings.plugins.mcp.logs')}
					</button>
					{logsOpen ? (
						<pre className="max-h-48 overflow-auto border-t border-border/40 bg-background/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
							{row.stderrTail}
						</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
}
