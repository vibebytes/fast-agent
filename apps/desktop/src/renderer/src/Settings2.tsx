import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Bell,
	BellRing,
	CheckCircle2,
	Volume2,
	FolderSync,
	Languages,
	LoaderCircle,
	Palette,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	ArrowRight
} from 'lucide-react';
import {LOCALE_NATIVE_NAME, SUPPORTED, type LocalePref} from '@fast-ide/i18n';
import type {EngineHostStatus, ModelCatalogEntry} from '@fast-ide/session-view';
import {playApprovalSound, playCompletionSound} from './completionSound';
import {ThemePicker} from './ThemePicker';
import {
	settingsSections,
	SettingsShell,
	sectionCopy,
	useSettingsMockState,
	type SettingsSection as SettingsSectionId
} from './settings/SettingsShell';
import {
	SettingsButton,
	SettingsPageHeader,
	SettingsRow,
	SettingsSection,
	SettingsState,
	PulseStatusBadge,
	SettingsSwitchRow,
	settingsControlClass
} from './settings/SettingsPrimitives';
import {settingsMockStore} from './settings/mock/settingsMockStore';
import {AgentsSettings} from './settings/AgentsSettings';
import {PermissionsSettings, ProjectsSettings} from './settings/MockSettingsPages';
import {ServersSettings} from './settings/ServersSettings';
import {AboutSettings, TasksHistorySettings, TracingSettings, UsageSettings} from './settings/MockObservabilityPages';
import {PluginsSettings} from './settings/PluginsSettings';
import {EnginesSettings} from './settings/EnginesSettings';
import {ProvidersSettings} from './settings/ProvidersSettings';
import {ModelsSettings} from './settings/ModelsSettings';
import {useSettings} from './settings/useSettings';
import {cn} from '@fast-ide/ui/lib/utils';
import {Root as DshRoot} from './dsh/settings/Root';

/** Keep the row; flip to show again. */
const SHOW_RESTORE_WORKSPACE = false;

export type LayoutPreference = 'coding' | 'general';

export type {SettingsSectionId};

export type SettingsSuite = 'fast' | 'dsh';

export type Props = {
	paletteId: string;
	onPaletteChange: (id: string) => void;
	localePref: LocalePref;
	onLocaleChange: (pref: LocalePref) => void;
	layout: LayoutPreference;
	onLayoutChange: (layout: LayoutPreference) => void;
	onBack: () => void;
	engineReady: boolean;
	engineStatus?: EngineHostStatus | null;
	modelCatalog: ModelCatalogEntry[];
	initialSection?: SettingsSectionId;
	initialSuite?: SettingsSuite;
	sessionId?: string;
};

export function Settings2(props: Props) {
	const {t} = useTranslation();
	const [suite, setSuite] = useState<SettingsSuite>(props.initialSuite ?? 'fast');
	const [section, setSection] = useState<SettingsSectionId>(
		props.initialSection && props.initialSection !== 'models' && props.initialSuite === 'dsh'
			? 'general'
			: (props.initialSection ?? 'general')
	);
	const [modelsFocusProviderId, setModelsFocusProviderId] = useState<string | null>(null);

	useEffect(() => {
		if (props.initialSection) {
			setSection(props.initialSection);
		}
	}, [props.initialSection]);
	useEffect(() => {
		if (props.initialSuite) setSuite(props.initialSuite);
	}, [props.initialSuite]);
	const active = settingsSections.find(item => item.id === section) ?? settingsSections[0]!;
	const copy = sectionCopy(section, t);
	const headerExtra = (
		<div className="flex h-7 items-center rounded-lg border border-border/70 bg-muted/40 p-0.5">
			{(
				[
					['fast', 'Fast'],
					['dsh', 'DSH']
				] as const
			).map(([id, label]) => (
				<button
					key={id}
					type="button"
					className={cn(
						'h-6 rounded-md px-2.5 text-[12px] font-medium transition-colors',
						suite === id
							? 'bg-background text-foreground shadow-xs'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onClick={() => setSuite(id)}
				>
					{label}
				</button>
			))}
		</div>
	);

	if (suite === 'dsh') {
		return (
			<DshRoot
				onBack={props.onBack}
				headerExtra={headerExtra}
				sessionId={props.sessionId}
				initialSection={
					props.initialSection === 'models' ||
					props.initialSection === 'plugins' ||
					props.initialSection === 'general'
						? props.initialSection
						: props.initialSection === 'agents'
							? 'agent-presets'
							: undefined
				}
			/>
		);
	}

	return (
		<SettingsShell
			activeSection={section}
			onSectionChange={next => {
				setSection(next);
				if (next !== 'models') setModelsFocusProviderId(null);
			}}
			onBack={props.onBack}
			headerExtra={headerExtra}
		>
			<SettingsPageHeader icon={active.icon} title={copy.label} description={copy.description} />
			{section === 'general' ? (
				<GeneralSettings {...props} />
			) : section === 'models' ? (
				<ModelsSettings
					engineReady={props.engineReady}
					focusProviderId={modelsFocusProviderId}
				/>
			) : section === 'agents' ? (
				<AgentsSettings engineReady={props.engineReady} />
			) : section === 'health' ? (
				<HealthSettings
					onNavigate={target => {
						setSection(target);
					}}
				/>
			) : section === 'projects' ? (
				<ProjectsSettings />
			) : section === 'plugins' ? (
				<PluginsSettings engineReady={props.engineReady} />
			) : section === 'engines' ? (
				<EnginesSettings engineReady={props.engineReady} engineStatus={props.engineStatus} />
			) : section === 'providers' ? (
				<ProvidersSettings
					engineReady={props.engineReady}
					onOpenModels={providerId => {
						setModelsFocusProviderId(providerId ?? null);
						setSection('models');
					}}
				/>
			) : section === 'servers' ? (
				<ServersSettings />
			) : section === 'security' ? (
				<PermissionsSettings />
			) : section === 'tasks' ? (
				<TasksHistorySettings />
			) : section === 'usage' ? (
				<UsageSettings />
			) : section === 'tracing' ? (
				<TracingSettings />
			) : section === 'about' ? (
				<AboutSettings />
			) : (
				<SettingsState
					status="empty"
					title={t('settings.states.mockReady')}
					description={t('settings.states.mockDescription')}
				/>
			)}
		</SettingsShell>
	);
}

function GeneralSettings({
	paletteId,
	onPaletteChange,
	localePref,
	onLocaleChange,
	engineReady
}: Props) {
	const {t} = useTranslation();
	const settings = useSettings(engineReady);

	return (
		<div className="space-y-4">
			<SettingsSection
				title={t('settings.general.appearance')}
				description={t('settings.general.appearanceDescription')}
			>
				<SettingsRow
					icon={Palette}
					title={t('settings.general.theme')}
					description={t('settings.general.themeDescription')}
				>
					<ThemePicker compact variant="sidebar" paletteId={paletteId} onPaletteChange={onPaletteChange} />
				</SettingsRow>
				<SettingsRow
					icon={Languages}
					title={t('settings.general.language')}
					description={t('settings.general.languageDescription')}
				>
					<select
						className={`${settingsControlClass} min-w-44`}
						value={localePref}
						onChange={event => onLocaleChange(event.target.value as LocalePref)}
					>
						<option value="system">{t('settings.languageSystem')}</option>
						{SUPPORTED.map(code => (
							<option key={code} value={code}>
								{LOCALE_NATIVE_NAME[code]}
							</option>
						))}
					</select>
				</SettingsRow>
			</SettingsSection>

			<SettingsSection
				title={t('settings.general.behavior')}
				description={t('settings.general.behaviorDescription')}
			>
				{settings.status === 'disabled' ? (
					<SettingsState
						status="disabled"
						title={t('settings.general.engineUnavailable')}
						description={t('settings.general.engineUnavailableDescription')}
					/>
				) : settings.status === 'loading' ? (
					<SettingsState status="loading" title={t('settings.common.loading')} />
				) : settings.status === 'error' ? (
					<SettingsState
						status="error"
						title={t('settings.general.loadFailed')}
						description={settings.notice ?? t('settings.general.loadFailedDescription')}
						onRetry={settings.retry}
					/>
				) : (
					<>
						{settings.notice ? (
							<div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20">
								{t('settings.general.patchFailed')}: {settings.notice}
							</div>
						) : null}
						{SHOW_RESTORE_WORKSPACE ? (
							<SettingsSwitchRow
								icon={FolderSync}
								title={t('settings.general.restoreWorkspace')}
								description={t('settings.general.restoreWorkspaceDescription')}
								checked={settings.general.restoreWorkspace}
								onCheckedChange={checked =>
									void settings.patchGeneral({restoreWorkspace: checked})
								}
							/>
						) : null}
						<SettingsSwitchRow
							icon={BellRing}
							title={t('settings.general.notifications')}
							description={t('settings.general.notificationsDescription')}
							checked={settings.general.notifications}
							onCheckedChange={checked =>
								void settings.patchGeneral({notifications: checked})
							}
						/>
						<SettingsSwitchRow
							icon={Volume2}
							title={t('settings.general.soundPrompt')}
							description={t('settings.general.soundPromptDescription')}
							checked={settings.general.soundPrompt}
							onCheckedChange={checked => {
								void settings.patchGeneral({soundPrompt: checked});
								if (checked) void playCompletionSound();
							}}
						/>
						<SettingsSwitchRow
							icon={Bell}
							title={t('settings.general.approvalSound')}
							description={t('settings.general.approvalSoundDescription')}
							checked={settings.general.approvalSound}
							onCheckedChange={checked => {
								void settings.patchGeneral({approvalSound: checked});
								if (checked) void playApprovalSound();
							}}
						/>
					</>
				)}
			</SettingsSection>
		</div>
	);
}

function HealthSettings({onNavigate}: {onNavigate?: (section: SettingsSectionId) => void}) {
	const {t} = useTranslation();
	const state = useSettingsMockState();

	const hasErrors = state.health.some(item => item.status === 'error');
	const hasWarnings = state.health.some(item => item.status === 'warning');
	const allHealthy = !hasErrors && !hasWarnings;

	return (
		<div className="space-y-4">
			{/* Health Scorecard Hero Banner */}
			<div
				className={cn(
					'relative overflow-hidden rounded-xl border p-4 shadow-xs transition-all duration-200',
					allHealthy
						? 'border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent'
						: hasErrors
							? 'border-rose-500/30 bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent'
							: 'border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent'
				)}
			>
				<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
					<div className="flex items-center gap-3 min-w-0">
						<div
							className={cn(
								'flex size-10 shrink-0 items-center justify-center rounded-xl shadow-xs',
								allHealthy
									? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
									: hasErrors
										? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
										: 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
							)}
						>
							{allHealthy ? (
								<ShieldCheck className="size-5" />
							) : (
								<ShieldAlert className="size-5" />
							)}
						</div>
						<div>
							<div className="flex items-center gap-2">
								<h2 className="text-[14px] font-semibold tracking-tight text-foreground">
									{allHealthy
										? t('settings.health.allHealthyTitle')
										: hasErrors
											? t('settings.health.errorsTitle')
											: t('settings.health.warningsTitle')}
								</h2>
								<PulseStatusBadge
									status={allHealthy ? 'healthy' : hasErrors ? 'error' : 'warning'}
									label={
										allHealthy
											? t('settings.health.allReady')
											: hasErrors
												? t('settings.health.hasErrors')
												: t('settings.health.hasWarnings')
									}
								/>
							</div>
							<p className="mt-0.5 text-[12px] text-muted-foreground">
								{allHealthy
									? t('settings.health.allHealthyDescription')
									: t('settings.health.issuesDescription')}
							</p>
						</div>
					</div>
					<SettingsButton
						variant="outline"
						className="shrink-0 rounded-lg shadow-2xs font-medium"
						disabled={state.status === 'loading'}
						onClick={() => void settingsMockStore.runHealthChecks()}
					>
						{state.status === 'loading' ? (
							<>
								<LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
								{t('settings.common.checking')}
							</>
						) : (
							<>
								<Sparkles className="mr-1.5 size-3.5 text-primary" />
								{t('settings.health.runAll')}
							</>
						)}
					</SettingsButton>
				</div>
			</div>

			{/* Diagnostic Checklist */}
			<SettingsSection
				title={t('settings.health.title')}
				description={t('settings.health.description')}
			>
				{state.health.map(check => {
					const isError = check.status === 'error';
					const isWarning = check.status === 'warning';
					const isHealthy = check.status === 'healthy';

					return (
						<div
							key={check.id}
							className={cn(
								'flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150',
								isError && 'bg-rose-500/5 hover:bg-rose-500/10',
								isWarning && 'bg-amber-500/5 hover:bg-amber-500/10',
								isHealthy && 'hover:bg-muted/20'
							)}
						>
							<div className="flex items-start gap-3 min-w-0">
								<div
									className={cn(
										'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border',
										isHealthy && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
										isWarning && 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
										isError && 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
									)}
								>
									{isHealthy ? (
										<CheckCircle2 className="size-3.5" />
									) : (
										<ShieldAlert className="size-3.5" />
									)}
								</div>
								<div className="min-w-0">
									<p className="text-[13px] font-medium leading-tight text-foreground">{check.label}</p>
									<p className="mt-0.5 text-[12px] leading-snug text-muted-foreground/90">{check.message}</p>
								</div>
							</div>
							<div className="shrink-0 flex items-center gap-2">
								{isWarning && check.id.includes('provider') ? (
									<SettingsButton
										variant="ghost"
										size="xs"
										className="text-primary hover:text-primary hover:bg-primary/10 gap-1 text-[11px]"
										onClick={() => onNavigate?.('providers')}
									>
										{t('settings.health.goConfigure')}
										<ArrowRight className="size-3" />
									</SettingsButton>
								) : null}
								{isError && check.id.includes('model') ? (
									<SettingsButton
										variant="ghost"
										size="xs"
										className="text-primary hover:text-primary hover:bg-primary/10 gap-1 text-[11px]"
										onClick={() => onNavigate?.('models')}
									>
										{t('settings.health.changeModel')}
										<ArrowRight className="size-3" />
									</SettingsButton>
								) : null}
								<PulseStatusBadge
									status={isHealthy ? 'healthy' : isWarning ? 'warning' : 'error'}
									label={
										isHealthy
											? t('settings.common.ready')
											: isWarning
												? t('settings.common.warning')
												: t('settings.common.error')
									}
								/>
							</div>
						</div>
					);
				})}
			</SettingsSection>
		</div>
	);
}
