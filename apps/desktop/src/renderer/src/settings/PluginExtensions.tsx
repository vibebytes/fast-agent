import {useTranslation} from 'react-i18next';
import {Download, Trash2} from 'lucide-react';
import {Badge} from '@fast-ide/ui/components/badge';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	MonoTag
} from './SettingsPrimitives';
import {noticeKind, type ExtsView} from './useExtensions';
import type {ExtNote, ExtRow} from '@fastllm/bridge-client';

export function extNoticeCopy(notice: string, t: (key: string, options?: {defaultValue?: string}) => string): string {
	const kind = noticeKind(notice);
	if (kind === 'NeedsRestart') return t('settings.plugins.ext.restartHint');
	if (kind === 'Busy') return t('settings.plugins.ext.faultBusy', {defaultValue: notice});
	if (kind === 'DescFault') {
		return `${t('settings.plugins.ext.faultDesc')}: ${notice}`;
	}
	if (kind === 'RemoteUrl') return t('settings.plugins.ext.faultRemote', {defaultValue: notice});
	if (kind === 'Denied') return t('settings.plugins.ext.faultDenied', {defaultValue: notice});
	if (kind === 'EngineDown') return t('settings.plugins.ext.faultEngine', {defaultValue: notice});
	return notice;
}

export function ExtensionsTab({
	ext
}: {
	ext: ExtsView & {
		retry: () => void;
		install: (dir?: string) => Promise<boolean>;
		uninstall: (id: string) => Promise<boolean>;
		upgrade: (id: string) => Promise<boolean>;
		reinstall: (id: string) => Promise<boolean>;
	};
}) {
	const {t} = useTranslation();
	if (ext.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.plugins.ext.engineUnavailable')}
				description={t('settings.plugins.ext.engineUnavailablePrep')}
			/>
		);
	}
	if (ext.status === 'loading' && ext.extensions.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (ext.status === 'error' && ext.extensions.length === 0) {
		return (
			<SettingsState
				status="error"
				title={t('settings.plugins.ext.loadFailed')}
				description={ext.notice ?? t('settings.plugins.ext.loadFailedDescription')}
				onRetry={ext.retry}
			/>
		);
	}

	const visible = ext.extensions.filter(row => row.phase !== 'Uninstalled' || ext.failed?.id === row.id);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<SettingsButton
					className="shadow-2xs font-medium"
					onClick={() => void ext.install()}
					disabled={ext.status === 'loading'}
				>
					<Download className="mr-1 size-3.5" />
					{t('settings.plugins.ext.installLocal')}
				</SettingsButton>
			</div>

			{visible.length === 0 ? (
				<SettingsSection title={t('settings.plugins.ext.emptyTitle')}>
					<SettingsState
						status="empty"
						title={t('settings.plugins.ext.emptyTitle')}
						description={t('settings.plugins.ext.emptyDescription')}
					/>
				</SettingsSection>
			) : (
				<SettingsSection title={t('settings.plugins.tab.extensions')}>
					<div className="divide-y divide-border/40">
						{visible.map(row => (
							<ExtensionCard
								key={row.id}
								row={row}
								failed={ext.failed?.id === row.id}
								busy={ext.status === 'loading'}
								onUninstall={() => void ext.uninstall(row.id)}
								onUpgrade={() => void ext.upgrade(row.id)}
								onReinstall={() => void ext.reinstall(row.id)}
							/>
						))}
					</div>
				</SettingsSection>
			)}

			<LedgerTrail notes={ext.ledger} />
		</div>
	);
}

function ExtensionCard({
	row,
	failed,
	busy,
	onUninstall,
	onUpgrade,
	onReinstall
}: {
	row: ExtRow;
	failed: boolean;
	busy: boolean;
	onUninstall: () => void;
	onUpgrade: () => void;
	onReinstall: () => void;
}) {
	const {t} = useTranslation();
	const phaseLabel = t(`settings.plugins.ext.phase.${row.phase}`, {defaultValue: row.phase});
	const hint = row.restartHint ?? (!row.hotUnload ? t('settings.plugins.ext.restartHint') : undefined);
	return (
		<div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-mono text-[13px] font-semibold">{row.id}</span>
					<Badge variant={failed || row.phase === 'Failed' ? 'destructive' : 'secondary'}>
						{failed ? t('settings.plugins.ext.phase.Failed') : phaseLabel}
					</Badge>
					{row.hotUnload ? (
						<MonoTag>{t('settings.plugins.ext.hotUnload')}</MonoTag>
					) : null}
					{hint ? <MonoTag>{hint}</MonoTag> : null}
				</div>
				{row.fault ? (
					<p className="mt-1.5 text-[12px] text-destructive">{extNoticeCopy(row.fault, t)}</p>
				) : null}
				{failed ? (
					<p className="mt-1 text-[12px] text-muted-foreground">
						{t('settings.plugins.ext.canReinstall')}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{failed ? (
					<SettingsButton size="xs" onClick={onReinstall} disabled={busy}>
						{t('settings.plugins.ext.reinstall')}
					</SettingsButton>
				) : (
					<>
						<SettingsButton size="xs" variant="outline" onClick={onUpgrade} disabled={busy}>
							{t('settings.plugins.ext.upgrade')}
						</SettingsButton>
						<SettingsButton size="xs" variant="outline" onClick={onUninstall} disabled={busy}>
							<Trash2 className="mr-1 size-3" />
							{t('settings.plugins.ext.uninstall')}
						</SettingsButton>
					</>
				)}
			</div>
		</div>
	);
}

function LedgerTrail({notes}: {notes: ExtNote[]}) {
	const {t} = useTranslation();
	if (notes.length === 0) return null;
	return (
		<SettingsSection title={t('settings.plugins.ext.ledgerTitle')}>
			<ul className="space-y-1 px-4 py-3 font-mono text-[12px] text-muted-foreground">
				{notes.map((note, i) => (
					<li key={`${note.id}-${note.mark}-${i}`}>
						{note.id}
						<span className="mx-1.5 text-border">·</span>
						{note.mark === 'drop'
							? t('settings.plugins.ext.markDrop')
							: t('settings.plugins.ext.markPut')}
					</li>
				))}
			</ul>
		</SettingsSection>
	);
}
