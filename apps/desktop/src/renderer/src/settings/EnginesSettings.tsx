import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Cpu, Zap} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';
import type {EngineHostStatus} from '@fast-ide/session-view';
import type {EngineRow} from '@fastllm/bridge-client';
import {
	PulseStatusBadge,
	SettingsButton,
	SettingsSection,
	SettingsState,
	type SettingsIcon
} from './SettingsPrimitives';
import {engNoticeKind, useEngines} from './useEngines';

const ENGINE_ICON: Record<string, SettingsIcon> = {
	fast: Zap,
	dsh: Cpu
};

function canBeDefault(entry: EngineRow): boolean {
	if (entry.kind === 'builtin') return true;
	return entry.adapter === 'ready' && entry.program !== 'missing' && entry.program !== 'installing';
}

type Tone = 'healthy' | 'warning' | 'error' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
	healthy: 'bg-emerald-500',
	warning: 'bg-amber-500',
	error: 'bg-rose-500',
	neutral: 'bg-muted-foreground/40'
};

function adapterTone(phase: EngineRow['adapter']): Tone {
	return phase === 'ready' ? 'healthy' : phase === 'failed' ? 'error' : 'neutral';
}

function programTone(phase: EngineRow['program']): Tone {
	return phase === 'missing' || phase === 'installing' ? 'warning' : 'healthy';
}

function processTone(phase: EngineRow['process']): Tone {
	return phase === 'running' ? 'healthy' : 'neutral';
}

function overallStatus(entry: EngineRow): {tone: string; key: string} {
	if (entry.adapter === 'failed') return {tone: 'error', key: 'failed'};
	if (entry.process === 'running') return {tone: 'healthy', key: 'running'};
	if (canBeDefault(entry)) return {tone: 'healthy', key: 'available'};
	return {tone: 'neutral', key: 'notReady'};
}

function hostLaneOpen(status: EngineHostStatus | null): boolean {
	return status === 'ready' || status === 'starting' || status === 'reconnecting' || status === 'error';
}

export function EnginesSettings({
	engineReady,
	engineStatus
}: {
	engineReady: boolean;
	engineStatus?: EngineHostStatus | null;
}) {
	const {t} = useTranslation();
	const hostOpen = engineStatus === undefined ? engineReady : hostLaneOpen(engineStatus ?? null);
	const hostFailed = engineStatus === 'error' || engineStatus === 'exited';
	const {
		status,
		engines,
		notice,
		list,
		enable,
		disable,
		start,
		stop,
		setDefault,
		install,
		uninstall,
		cancelInstall
	} = useEngines(hostOpen);

	const retryHost = () => void window.fastIde.retryEngine();

	if (status === 'disabled') {
		return (
			<SettingsState
				status={hostFailed ? 'error' : 'disabled'}
				title={
					hostFailed ? t('settings.engines.engineFailed') : t('settings.engines.engineUnavailable')
				}
				description={
					hostFailed
						? t('settings.engines.engineFailedDescription')
						: t('settings.engines.engineUnavailableDescription')
				}
				onRetry={retryHost}
			/>
		);
	}
	if (status === 'loading' && engines.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (status === 'error' && engines.length === 0) {
		return (
			<SettingsState
				status="error"
				title={hostFailed ? t('settings.engines.engineFailed') : t('settings.engines.loadFailed')}
				description={notice ?? t('settings.engines.loadFailedDescription')}
				onRetry={hostFailed ? retryHost : () => void list()}
			/>
		);
	}

	return (
		<div className="space-y-4">
			{notice ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{engNoticeCopy(notice, t)}
				</div>
			) : null}
			<SettingsSection
				title={t('settings.engines.listTitle')}
				description={t('settings.engines.listDescription')}
			>
				<div role="radiogroup" aria-label={t('settings.engines.listTitle')} className="divide-y divide-border/40">
					{engines.map(entry => (
						<EngineRowView
							key={entry.id}
							entry={entry}
							onDefault={() => void setDefault(entry.id)}
							onAction={action => {
								if (action === 'enable') void enable(entry.id);
								else if (action === 'disable') void disable(entry.id);
								else if (action === 'start') void start(entry.id);
								else if (action === 'stop') {
									if (
										entry.process === 'running' &&
										!window.confirm(t('settings.engines.stopConfirm'))
									)
										return;
									void stop(entry.id);
								} else if (action === 'install') void install(entry.id);
								else if (action === 'uninstall') void uninstall(entry.id);
								else if (action === 'cancel') void cancelInstall(entry.id);
							}}
						/>
					))}
				</div>
			</SettingsSection>
		</div>
	);
}

function EngineRowView({
	entry,
	onDefault,
	onAction
}: {
	entry: EngineRow;
	onDefault: () => void;
	onAction: (action: string) => void;
}) {
	const {t} = useTranslation();
	const Icon = ENGINE_ICON[entry.id] ?? Cpu;
	const available = canBeDefault(entry);
	const selectable = available && !entry.isDefault;
	const name = t(`settings.engines.name.${entry.id}`, {defaultValue: entry.id});
	const kindLabel =
		entry.kind === 'builtin' ? t('settings.engines.builtin') : t('settings.engines.extension');
	const status = overallStatus(entry);
	const processLabel =
		entry.process === 'running' && entry.processDetail
			? entry.processDetail
			: t(`settings.engines.processPhase.${entry.process}`);
	const [logOpen, setLogOpen] = useState(entry.program === 'installing');
	const showLog = logOpen || entry.program === 'installing';
	const hasLog = (entry.installLog && entry.installLog.length > 0) || entry.program === 'installing';

	return (
		<div
			role="radio"
			aria-checked={entry.isDefault}
			tabIndex={selectable ? 0 : -1}
			onClick={selectable ? onDefault : undefined}
			onKeyDown={
				selectable
					? event => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								onDefault();
							}
						}
					: undefined
			}
			className={cn(
				'relative flex flex-col gap-3 px-4 py-3.5 outline-none transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
				selectable && 'cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30',
				entry.isDefault && 'bg-primary/[0.04]'
			)}
		>
			{entry.isDefault ? <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" /> : null}
			<div className="flex min-w-0 items-start gap-3">
				<div
					className={cn(
						'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
						entry.isDefault
							? 'border-primary/30 bg-primary/10 text-primary'
							: 'border-border/40 bg-muted/60 text-muted-foreground'
					)}
				>
					<Icon className="size-3.5" />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[13px] font-medium leading-tight text-foreground">{name}</span>
						{entry.isDefault ? (
							<span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium leading-none text-primary">
								{t('settings.engines.isDefault')}
							</span>
						) : null}
						<span className="text-[11px] text-muted-foreground/80">{kindLabel}</span>
					</div>
					<div className="mt-1.5">
						<PulseStatusBadge
							status={status.tone}
							label={t(`settings.engines.status.${status.key}`)}
						/>
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
						{(
							[
								{
									label: t('settings.engines.adapter'),
									value: t(`settings.engines.adapterPhase.${entry.adapter}`),
									tone: adapterTone(entry.adapter)
								},
								{
									label: t('settings.engines.program'),
									value: t(`settings.engines.programPhase.${entry.program}`),
									tone: programTone(entry.program)
								},
								{
									label: t('settings.engines.process'),
									value: processLabel,
									tone: processTone(entry.process)
								}
							] as const
						).map(segment => (
							<span
								key={segment.label}
								className="inline-flex items-center gap-1.5 text-[11px] leading-snug"
							>
								<span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[segment.tone])} />
								<span className="text-muted-foreground/60">{segment.label}</span>
								<span className="text-muted-foreground">{segment.value}</span>
							</span>
						))}
					</div>
					{hasLog ? (
						<div className="mt-2">
							<button
								type="button"
								className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
								onClick={event => {
									event.stopPropagation();
									setLogOpen(v => !v);
								}}
							>
								{t('settings.engines.installLog')}
							</button>
							{showLog ? (
								<pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] leading-snug text-muted-foreground">
									{(entry.installLog ?? []).map(l => l.text).join('\n')}
								</pre>
							) : null}
						</div>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 items-center justify-end pl-11 sm:pl-0">
				<EngineActions entry={entry} onAction={onAction} />
			</div>
		</div>
	);
}

function EngineActions({entry, onAction}: {entry: EngineRow; onAction: (action: string) => void}) {
	const {t} = useTranslation();
	if (entry.kind === 'builtin') return null;
	const primary = primaryAction(entry);
	const actions = entry.actions.length > 0 ? entry.actions : primary ? [primary] : [];
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center justify-end gap-1.5">
			{actions.map((action, i) => (
				<SettingsButton
					key={action}
					variant={i === 0 && isPrimaryAction(action) ? 'default' : 'outline'}
					onClick={event => {
						event.stopPropagation();
						onAction(action);
					}}
				>
					{t(`settings.engines.${action}`)}
				</SettingsButton>
			))}
		</div>
	);
}

function isPrimaryAction(action: string): boolean {
	return action === 'enable' || action === 'install' || action === 'start';
}

function primaryAction(entry: EngineRow): string | null {
	if (entry.program === 'installing') return 'cancel';
	if (entry.inRegistry) return 'stop';
	if (entry.program === 'missing' && entry.process !== 'running') return 'install';
	if (entry.adapter === 'disabled') return 'enable';
	if (entry.program === 'installed' || entry.process === 'running') return 'start';
	return null;
}

function engNoticeCopy(
	notice: string,
	t: (key: string, options?: {defaultValue?: string}) => string
): string {
	const kind = engNoticeKind(notice);
	if (kind === 'Busy') return t('settings.engines.faultBusy', {defaultValue: notice});
	if (kind === 'Denied') return t('settings.engines.faultDenied', {defaultValue: notice});
	if (kind === 'EngineDown') return t('settings.engines.faultEngine', {defaultValue: notice});
	if (kind === 'RemoteUrl') return t('settings.engines.faultRemote', {defaultValue: notice});
	if (kind === 'Idle') return t('settings.engines.faultIdle', {defaultValue: notice});
	return `${t('settings.engines.actionFailed')}: ${notice}`;
}
