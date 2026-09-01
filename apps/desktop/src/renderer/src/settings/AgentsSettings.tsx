import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Bot,
	BrainCircuit,
	Clock,
	Layers,
	Link2,
	Network,
	Sparkles,
	Workflow,
	Zap,
	ArrowDown
} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	SettingsRow,
	SettingsSection,
	SettingsState,
	settingsControlClass,
	MonoTag
} from './SettingsPrimitives';
import {Switch} from '@fast-ide/ui/components/switch';
import {clampVerdictAttempts, useSettings, type AgentModelBinding, type MemoryBinding} from './useSettings';
import {useProviders, type Provider} from './useProviders';

type Props = {
	engineReady: boolean;
};

type BindingKey = 'subagent' | 'scheduled' | 'goalControl' | 'goalWork';

type ModelOption = {
	key: string;
	platformId: string;
	modelId: string;
	label: string;
	providerName: string;
	displayName: string;
};

function modelOptions(providers: Provider[]): ModelOption[] {
	const out: ModelOption[] = [];
	for (const p of providers) {
		if (!p.enabled) continue;
		for (const m of p.models ?? []) {
			if (!m.enabled) continue;
			out.push({
				key: `${p.id}::${m.modelId}`,
				platformId: p.id,
				modelId: m.modelId,
				label: `${p.name} · ${m.displayName}`,
				providerName: p.name,
				displayName: m.displayName
			});
		}
	}
	return out;
}

function optionKey(b: AgentModelBinding): string {
	if (b.mode !== 'fixed' || !b.platformId || !b.modelId) return '';
	return `${b.platformId}::${b.modelId}`;
}

export function AgentsSettings({engineReady}: Props) {
	const {t} = useTranslation();
	const settings = useSettings(engineReady);
	const providers = useProviders(engineReady);
	const options = useMemo(() => modelOptions(providers.providers), [providers.providers]);
	const [attemptsDraft, setAttemptsDraft] = useState<string | null>(null);

	const settingsEmpty = settings.docs.length === 0;
	const modeBlock =
		settings.status === 'disabled' || providers.status === 'disabled' ? (
			<SettingsState
				status="disabled"
				title={t('settings.agents.engineUnavailable')}
				description={t('settings.agents.engineUnavailableDescription')}
			/>
		) : (settings.status === 'loading' && settingsEmpty) ||
		  (providers.status === 'loading' && providers.providers.length === 0) ? (
			<SettingsState status="loading" title={t('settings.common.loading')} />
		) : settings.status === 'error' && settingsEmpty ? (
			<SettingsState
				status="error"
				title={t('settings.agents.loadFailed')}
				description={settings.notice ?? t('settings.agents.loadFailedDescription')}
				onRetry={settings.retry}
			/>
		) : null;

	const setBinding = (key: BindingKey, next: AgentModelBinding) => {
		void settings.patchAgents({[key]: next});
	};

	const setMode = (key: BindingKey, mode: 'follow' | 'fixed') => {
		const prev = settings.agents[key];
		if (mode === 'follow') {
			setBinding(key, {mode: 'follow'});
			return;
		}
		const fallback = options[0];
		setBinding(key, {
			mode: 'fixed',
			platformId: prev.platformId ?? fallback?.platformId,
			modelId: prev.modelId ?? fallback?.modelId
		});
	};

	const setFixedModel = (key: BindingKey, value: string) => {
		const opt = options.find(o => o.key === value);
		if (!opt) return;
		setBinding(key, {mode: 'fixed', platformId: opt.platformId, modelId: opt.modelId});
	};

	const setMemory = (next: MemoryBinding) => {
		void settings.patchAgents({memory: next});
	};

	const setMemoryMode = (mode: 'follow' | 'fixed') => {
		const prev = settings.agents.memory;
		if (mode === 'follow') {
			setMemory({mode: 'follow', enabled: prev.enabled});
			return;
		}
		const fallback = options[0];
		setMemory({
			mode: 'fixed',
			enabled: prev.enabled,
			platformId: prev.platformId ?? fallback?.platformId,
			modelId: prev.modelId ?? fallback?.modelId
		});
	};

	const setMemoryModel = (value: string) => {
		const opt = options.find(o => o.key === value);
		if (!opt) return;
		setMemory({
			mode: 'fixed',
			enabled: settings.agents.memory.enabled,
			platformId: opt.platformId,
			modelId: opt.modelId
		});
	};

	if (modeBlock) return <div className="space-y-4">{modeBlock}</div>;

	const subagent = settings.agents.subagent;
	const scheduled = settings.agents.scheduled;
	const memory = settings.agents.memory;

	return (
		<div className="space-y-4">
			{settings.notice ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{t('settings.agents.actionFailed')}: {settings.notice}
				</div>
			) : null}

			{/* Subagent & Scheduled Tasks */}
			<SettingsSection
				title={t('settings.agents.standaloneTitle')}
				description={t('settings.agents.subtitle')}
			>
				{/* Subagent row */}
				<AgentBindingCard
					icon={Bot}
					iconColor="bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25"
					title={t('settings.agents.subagent')}
					description={t('settings.agents.subagentDescription')}
					binding={subagent}
					options={options}
					onMode={mode => setMode('subagent', mode)}
					onModel={value => setFixedModel('subagent', value)}
				/>

				{/* Scheduled tasks row */}
				<AgentBindingCard
					icon={Clock}
					iconColor="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25"
					title={t('settings.agents.scheduled')}
					description={t('settings.agents.scheduledDescription')}
					binding={scheduled}
					options={options}
					onMode={mode => setMode('scheduled', mode)}
					onModel={value => setFixedModel('scheduled', value)}
				/>

				<AgentBindingCard
					icon={Sparkles}
					iconColor="bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25"
					title={t('settings.agents.memory')}
					description={t('settings.agents.memoryDescription')}
					binding={memory}
					options={options}
					enabled={memory.enabled}
					onEnabled={enabled => setMemory({...memory, enabled})}
					onMode={setMemoryMode}
					onModel={setMemoryModel}
				/>
			</SettingsSection>

			{/* Goal Pipeline Orchestration */}
			<SettingsSection
				title={t('settings.agents.goalAgents')}
				description={t('settings.agents.goalSectionDescription')}
			>
				<div className="p-4 space-y-3">
					{/* Planner node */}
					<div className="relative rounded-xl border border-border/70 bg-background/50 p-3.5 transition-all duration-150 hover:border-primary/30">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
							<div className="flex items-start gap-3 min-w-0">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25">
									<BrainCircuit className="size-4" />
								</div>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[13px] font-semibold text-foreground">
											{t('settings.agents.goalControl')}
										</span>
										<span className="rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-1.5 py-0.2 text-[10px] font-semibold uppercase">
											Planner
										</span>
									</div>
									<p className="mt-0.5 text-[12px] text-muted-foreground">
										{t('settings.agents.goalControlDescription')}
									</p>
								</div>
							</div>

							<div className="flex items-center gap-2 self-end sm:self-center">
								<ModeSegment
									value={settings.agents.goalControl.mode}
									onChange={mode => setMode('goalControl', mode)}
								/>
							</div>
						</div>

						{settings.agents.goalControl.mode === 'fixed' ? (
							<div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
								<span className="text-[12px] text-muted-foreground font-medium">指定 Planner 模型:</span>
								<ModelSelectDropdown
									binding={settings.agents.goalControl}
									options={options}
									onModel={value => setFixedModel('goalControl', value)}
								/>
							</div>
						) : null}
					</div>

					{/* Pipeline Flow Connector */}
					<div className="flex items-center justify-center -my-1 text-muted-foreground/60">
						<div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/40 border border-border/40 text-[10px] font-mono">
							<ArrowDown className="size-3 text-primary animate-bounce" />
							<span>编排与决策流转至执行节点</span>
						</div>
					</div>

					{/* Worker node */}
					<div className="relative rounded-xl border border-border/70 bg-background/50 p-3.5 transition-all duration-150 hover:border-primary/30">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
							<div className="flex items-start gap-3 min-w-0">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
									<Zap className="size-4" />
								</div>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[13px] font-semibold text-foreground">
											{t('settings.agents.goalWork')}
										</span>
										<span className="rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 text-[10px] font-semibold uppercase">
											Worker
										</span>
									</div>
									<p className="mt-0.5 text-[12px] text-muted-foreground">
										{t('settings.agents.goalWorkDescription')}
									</p>
								</div>
							</div>

							<div className="flex items-center gap-2 self-end sm:self-center">
								<ModeSegment
									value={settings.agents.goalWork.mode}
									onChange={mode => setMode('goalWork', mode)}
								/>
							</div>
						</div>

						{settings.agents.goalWork.mode === 'fixed' ? (
							<div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
								<span className="text-[12px] text-muted-foreground font-medium">指定 Worker 模型:</span>
								<ModelSelectDropdown
									binding={settings.agents.goalWork}
									options={options}
									onModel={value => setFixedModel('goalWork', value)}
								/>
							</div>
						) : null}
					</div>

					<div className="relative rounded-xl border border-border/70 bg-background/50 p-3.5 transition-all duration-150 hover:border-primary/30">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
							<div className="flex items-start gap-3 min-w-0">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25">
									<Layers className="size-4" />
								</div>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[13px] font-semibold text-foreground">
											{t('settings.agents.goalVerdict')}
										</span>
									</div>
									<p className="mt-0.5 text-[12px] text-muted-foreground">
										{t('settings.agents.goalVerdictDescription')}
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2 self-end sm:self-center">
								<Segment
									value={settings.agents.goal.onMissingVerdict}
									onChange={onMissingVerdict =>
										void settings.patchAgents({
											goal: {...settings.agents.goal, onMissingVerdict}
										})
									}
									items={[
										{id: 'block', label: t('settings.agents.goalVerdictBlock')},
										{id: 'fail', label: t('settings.agents.goalVerdictFail')}
									]}
								/>
							</div>
						</div>
						<div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
							<div className="min-w-0">
								<span className="text-[12px] text-muted-foreground font-medium">
									{t('settings.agents.goalVerdictAttempts')}
								</span>
								<p className="mt-0.5 text-[11px] text-muted-foreground">
									{t('settings.agents.goalVerdictAttemptsDescription')}
								</p>
							</div>
							<input
								type="number"
								min={1}
								max={20}
								className={`${settingsControlClass} h-7 w-16 cursor-text text-center font-medium`}
								value={attemptsDraft ?? String(settings.agents.goal.verdictAttempts)}
								onChange={e => {
									const raw = e.target.value;
									setAttemptsDraft(raw);
									const n = clampVerdictAttempts(raw);
									if (n === undefined) return;
									void settings.patchAgents({
										goal: {...settings.agents.goal, verdictAttempts: n}
									});
								}}
								onBlur={() => setAttemptsDraft(null)}
							/>
						</div>
					</div>
				</div>
			</SettingsSection>
		</div>
	);
}

function AgentBindingCard({
	icon: Icon,
	iconColor,
	title,
	description,
	binding,
	options,
	onMode,
	onModel,
	enabled,
	onEnabled
}: {
	icon: any;
	iconColor: string;
	title: string;
	description: string;
	binding: AgentModelBinding;
	options: ModelOption[];
	onMode: (mode: 'follow' | 'fixed') => void;
	onModel: (value: string) => void;
	enabled?: boolean;
	onEnabled?: (enabled: boolean) => void;
}) {
	const {t} = useTranslation();
	const modelDisabled = enabled === false;
	return (
		<div className="px-4 py-3.5 transition-colors duration-150 hover:bg-muted/15">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div className="flex items-start gap-3 min-w-0">
					<div
						className={cn(
							'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
							iconColor
						)}
					>
						<Icon className="size-4" />
					</div>
					<div className="min-w-0">
						<span className="text-[13px] font-medium leading-tight text-foreground">{title}</span>
						<p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
					{onEnabled ? (
						<div className="flex items-center gap-1.5 pr-1">
							<span className="text-[12px] text-muted-foreground">{t('settings.agents.memoryEnable')}</span>
							<Switch
								checked={enabled === true}
								onCheckedChange={onEnabled}
								aria-label={t('settings.agents.memoryEnable')}
							/>
						</div>
					) : null}
					<ModeSegment value={binding.mode} onChange={onMode} />
				</div>
			</div>

			{binding.mode === 'fixed' ? (
				<div
					className={cn(
						'mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between gap-2',
						modelDisabled && 'opacity-50'
					)}
				>
					<span className="text-[12px] text-muted-foreground font-medium">指定专用模型:</span>
					<ModelSelectDropdown
						binding={binding}
						options={options}
						onModel={onModel}
					/>
				</div>
			) : null}
		</div>
	);
}

function Segment<T extends string>({
	value,
	onChange,
	items
}: {
	value: T;
	onChange: (v: T) => void;
	items: {id: T; label: string}[];
}) {
	return (
		<div
			role="group"
			className="inline-flex h-7 shrink-0 items-center rounded-lg border border-border/70 bg-muted/60 p-0.5"
		>
			{items.map(item => {
				const active = value === item.id;
				return (
					<button
						key={item.id}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(item.id)}
						className={cn(
							'h-full cursor-pointer rounded-md px-2.5 text-[12px] font-medium leading-none whitespace-nowrap transition-all duration-150',
							active
								? 'bg-background font-semibold text-foreground shadow-2xs'
								: 'text-muted-foreground hover:text-foreground'
						)}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}

function ModeSegment({
	value,
	onChange
}: {
	value: 'follow' | 'fixed';
	onChange: (mode: 'follow' | 'fixed') => void;
}) {
	const {t} = useTranslation();
	return (
		<Segment
			value={value}
			onChange={onChange}
			items={[
				{id: 'follow', label: t('settings.agents.modeFollow')},
				{id: 'fixed', label: t('settings.agents.modeFixed')}
			]}
		/>
	);
}

function ModelSelectDropdown({
	binding,
	options,
	onModel
}: {
	binding: AgentModelBinding;
	options: ModelOption[];
	onModel: (value: string) => void;
}) {
	const current = optionKey(binding);
	return (
		<select
			className={`${settingsControlClass} h-7 cursor-pointer min-w-56 font-medium`}
			value={current}
			onChange={e => onModel(e.target.value)}
		>
			{options.map(opt => (
				<option key={opt.key} value={opt.key}>
					{opt.label}
				</option>
			))}
		</select>
	);
}
