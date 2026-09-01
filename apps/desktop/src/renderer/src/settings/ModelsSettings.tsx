import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Bot,
	BrainCircuit,
	Check,
	Cpu,
	Layers,
	Pin,
	Plus,
	Search,
	Sparkles,
	Trash2,
	Zap
} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {Badge} from '@fast-ide/ui/components/badge';
import {Switch} from '@fast-ide/ui/components/switch';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	settingsControlClass,
	MonoTag,
	PulseStatusBadge
} from './SettingsPrimitives';
import {useSettings, type ModelsDoc} from './useSettings';
import {useProviders, type Provider, type SeedModel} from './useProviders';
import {modelSourceOf} from './providerPresets';
import {clampEffort} from '../effortClamp';

type Filter = 'enabled' | 'hidden' | 'all';

type Props = {
	engineReady: boolean;
	/** Optional deep-link from Providers page (highlight/filter this provider). */
	focusProviderId?: string | null;
};

export function ModelsSettings({engineReady, focusProviderId}: Props) {
	const {t} = useTranslation();
	const settings = useSettings(engineReady);
	const providers = useProviders(engineReady);
	const [filter, setFilter] = useState<Filter>('enabled');
	const [providerFilter, setProviderFilter] = useState(focusProviderId ?? 'all');
	const [query, setQuery] = useState('');
	const [addFor, setAddFor] = useState<string | null>(null);
	const [searchFor, setSearchFor] = useState<string | null>(null);
	const [pickDefaultOpen, setPickDefaultOpen] = useState(false);

	useEffect(() => {
		if (focusProviderId) setProviderFilter(focusProviderId);
	}, [focusProviderId]);

	const defaultUnavailable = useMemo(() => {
		const platform = settings.models.defaultPlatform;
		if (!platform) return false;
		const row = providers.providers.find(p => p.id === platform);
		return Boolean(row && !row.enabled);
	}, [providers.providers, settings.models.defaultPlatform]);

	const selectedModel = useMemo(() => {
		const platform = settings.models.defaultPlatform;
		const model = settings.models.defaultModel;
		if (!platform || !model) return null;
		const provider = providers.providers.find(p => p.id === platform);
		const row = provider?.models?.find(m => m.modelId === model) ?? null;
		return row ? {provider, model: row} : null;
	}, [providers.providers, settings.models.defaultPlatform, settings.models.defaultModel]);

	const filteredProviders = useMemo(() => {
		const q = query.trim().toLowerCase();
		return providers.providers
			.filter(p => providerFilter === 'all' || p.id === providerFilter)
			.map(p => {
				const models = (p.models ?? []).filter(m => {
					if (filter === 'enabled' && !m.enabled) return false;
					if (filter === 'hidden' && m.enabled) return false;
					if (!q) return true;
					return (
						m.displayName.toLowerCase().includes(q) ||
						m.modelId.toLowerCase().includes(q)
					);
				});
				return {...p, models};
			})
			.filter(p => (filter === 'all' && !q ? true : (p.models?.length ?? 0) > 0) || providerFilter === p.id);
	}, [providers.providers, providerFilter, filter, query]);

	const totals = useMemo(() => {
		let enabled = 0;
		let hidden = 0;
		for (const p of providers.providers) {
			for (const m of p.models ?? []) {
				if (m.enabled) enabled += 1;
				else hidden += 1;
			}
		}
		return {enabled, hidden, all: enabled + hidden};
	}, [providers.providers]);

	const pinDefault = (provider: Provider, model: SeedModel) => {
		const efforts = model.supportedEfforts ?? [];
		const effort = efforts.length
			? clampEffort(settings.models.defaultEffort, efforts, model.defaultEffort)
			: null;
		const thinking = model.supportsThinking ? (settings.models.defaultThinking ?? true) : null;
		const patch: Record<string, unknown> = {
			defaultPlatform: provider.id,
			defaultModel: model.modelId,
			defaultEffort: effort,
			defaultThinking: thinking
		};
		void settings.patchModels(patch);
	};

	const settingsEmpty = settings.docs.length === 0;
	const providersEmpty = providers.providers.length === 0;
	const block =
		settings.status === 'disabled' || providers.status === 'disabled' ? (
			<SettingsState
				status="disabled"
				title={t('settings.models.engineUnavailable')}
				description={t('settings.models.engineUnavailableDescription')}
			/>
		) : (settings.status === 'loading' && settingsEmpty) ||
		  (providers.status === 'loading' && providersEmpty) ? (
			<SettingsState status="loading" title={t('settings.common.loading')} />
		) : (settings.status === 'error' && settingsEmpty) ||
		  (providers.status === 'error' && providersEmpty) ? (
			<SettingsState
				status="error"
				title={t('settings.general.loadFailed')}
				description={
					settings.notice ?? providers.notice ?? t('settings.general.loadFailedDescription')
				}
				onRetry={() => {
					settings.retry();
					providers.retry();
				}}
			/>
		) : null;

	if (block) return <div className="space-y-4">{block}</div>;

	const efforts = selectedModel?.model.supportedEfforts ?? [];
	const showEffort = efforts.length > 0;
	const showThinking = Boolean(selectedModel?.model.supportsThinking);
	const effortValue =
		clampEffort(settings.models.defaultEffort, efforts, selectedModel?.model.defaultEffort) ?? '';

	return (
		<div className="space-y-4">
			{(settings.notice || providers.notice) && (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{t('settings.general.patchFailed')}: {settings.notice ?? providers.notice}
				</div>
			)}

			{providers.providers.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/80 bg-muted/30 p-4 text-xs text-muted-foreground flex items-center gap-2">
					<Bot className="size-4 text-primary" />
					<span>{t('settings.models.usingBuiltin')}</span>
				</div>
			) : null}

			{/* Hero Default Model Spotlight Card */}
			<div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-card/40 p-4 shadow-xs backdrop-blur-xs">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div className="flex items-start gap-3 min-w-0">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-xs">
							<Sparkles className="size-5" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2 flex-wrap">
								<h2 className="text-[14.5px] font-semibold tracking-tight text-foreground truncate">
									{selectedModel?.model.displayName ?? t('settings.models.noDefault')}
								</h2>
								{selectedModel?.provider ? (
									<Badge variant="secondary" className="rounded-md px-2 py-0 text-[11px] font-medium">
										{selectedModel.provider.name}
									</Badge>
								) : null}
								<span className="rounded-full bg-primary/15 text-primary border border-primary/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
									{t('settings.models.primaryDefaultBadge')}
								</span>
							</div>

							<p className="mt-0.5 text-[12px] text-muted-foreground">
								{defaultUnavailable
									? t('settings.models.defaultUnavailable')
									: t('settings.models.sessionDefaultDescription')}
							</p>

							{/* Thinking & Effort Controls */}
							{(showEffort || showThinking) && (
								<div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
									{showEffort ? (
										<div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1">
											<BrainCircuit className="size-3.5 text-primary" />
											<span className="text-muted-foreground font-medium">
												{t('settings.models.effort')}:
											</span>
											<select
												className="cursor-pointer bg-transparent text-[12px] font-medium text-foreground focus:outline-none"
												value={effortValue}
												onChange={event =>
													void settings.patchModels({defaultEffort: event.target.value})
												}
											>
												{efforts.map(e => (
													<option key={e} value={e.toLowerCase()}>
														{e}
													</option>
												))}
											</select>
										</div>
									) : null}

									{showThinking ? (
										<div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1">
											<Zap className="size-3.5 text-amber-500" />
											<span className="text-muted-foreground font-medium">
												{t('settings.models.thinking')}:
											</span>
											<select
												className="cursor-pointer bg-transparent text-[12px] font-medium text-foreground focus:outline-none"
												value={settings.models.defaultThinking === false ? 'off' : 'on'}
												onChange={event =>
													void settings.patchModels({
														defaultThinking: event.target.value === 'on'
													})
												}
											>
												<option value="on">{t('settings.models.thinkingOn')}</option>
												<option value="off">{t('settings.models.thinkingOff')}</option>
											</select>
										</div>
									) : null}
								</div>
							)}
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
						{defaultUnavailable ? (
							<SettingsButton
								variant="outline"
								onClick={() =>
									void settings.patchModels({
										defaultPlatform: null,
										defaultModel: null,
										defaultEffort: null,
										defaultThinking: null
									})
								}
							>
								{t('settings.models.reselect')}
							</SettingsButton>
						) : null}

						<SettingsButton
							variant="default"
							className="shadow-2xs font-medium"
							disabled={
								!providers.providers.some(
									p => p.enabled && (p.models ?? []).some(m => m.enabled)
								)
							}
							onClick={() => setPickDefaultOpen(true)}
						>
							{selectedModel
								? t('settings.models.changeDefault')
								: t('settings.models.chooseModel')}
						</SettingsButton>
					</div>
				</div>
			</div>

			{/* Available Models Catalog Section */}
			<SettingsSection
				title={t('settings.models.available')}
				description={t('settings.models.manageDescription')}
			>
				{/* Search and Filters Bar */}
				<div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-3 bg-muted/10">
					{/* Filter Segment */}
					<div className="inline-flex h-8 items-center rounded-lg border border-border/70 bg-muted/60 p-0.5">
						{(
							[
								['enabled', totals.enabled],
								['hidden', totals.hidden],
								['all', totals.all]
							] as const
						).map(([id, count]) => (
							<button
								key={id}
								type="button"
								onClick={() => setFilter(id)}
								className={cn(
									'h-full cursor-pointer rounded-md px-2.5 text-[12px] font-medium leading-none transition-all duration-150',
									filter === id
										? 'bg-background text-foreground shadow-2xs font-semibold'
										: 'text-muted-foreground hover:text-foreground'
								)}
							>
								{t(`settings.models.filter.${id}`, {count})}
							</button>
						))}
					</div>

					{/* Provider dropdown */}
					<select
						className={`${settingsControlClass} h-8 cursor-pointer min-w-36`}
						value={providerFilter}
						onChange={e => setProviderFilter(e.target.value)}
					>
						<option value="all">{t('settings.models.allProviders')}</option>
						{providers.providers.map(p => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>

					{/* Search input */}
					<div className="relative flex-1 min-w-36">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
						<Input
							className="h-8 pl-8 rounded-lg border-border/70 bg-background/80 text-[12px] shadow-none"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder={t('settings.models.searchPlaceholder')}
						/>
					</div>
				</div>

				{filteredProviders.length === 0 ? (
					<div className="p-4">
						<SettingsState
							status="empty"
							title={t('settings.models.emptyCatalog')}
							description={t('settings.models.emptyCatalogDescription')}
						/>
					</div>
				) : (
					<div className="divide-y divide-border/40">
						{filteredProviders.map(provider => (
							<ProviderModelsGroup
								key={provider.id}
								provider={provider}
								defaults={settings.models}
								onPin={model => pinDefault(provider, model)}
								onToggle={(model, enabled) => {
									if ((filter === 'enabled' && !enabled) || (filter === 'hidden' && enabled)) {
										setFilter('all');
									}
									void providers.patchModels(provider.id, [
										{op: 'enable', modelId: model.modelId, enabled}
									]);
								}}
								onAdd={() => setAddFor(provider.id)}
								onSearch={() => setSearchFor(provider.id)}
								onRemove={model =>
									void providers.patchModels(provider.id, [
										{op: 'remove', modelId: model.modelId}
									])
								}
							/>
						))}
					</div>
				)}
			</SettingsSection>

			{addFor ? (
				<AddModelDialog
					open
					providerName={providers.providers.find(p => p.id === addFor)?.name}
					onOpenChange={open => {
						if (!open) setAddFor(null);
					}}
					onSubmit={async (
						modelId,
						displayName,
						supportsThinking,
						supportedEfforts,
						defaultEffort
					) => {
						const ok = await providers.patchModels(addFor, [
							{
								op: 'add',
								modelId,
								displayName: displayName || modelId,
								supportsThinking,
								supportedEfforts: supportsThinking ? supportedEfforts : [],
								defaultEffort: supportsThinking ? defaultEffort : undefined,
								enabled: true
							}
						]);
						if (ok) setAddFor(null);
						return ok;
					}}
				/>
			) : null}

			{searchFor ? (
				<SearchAddDialog
					open
					providerId={searchFor}
					searchModels={providers.searchModels}
					patchModels={providers.patchModels}
					onOpenChange={open => {
						if (!open) setSearchFor(null);
					}}
				/>
			) : null}

			<ChooseDefaultDialog
				open={pickDefaultOpen}
				providers={providers.providers}
				currentPlatform={settings.models.defaultPlatform}
				currentModel={settings.models.defaultModel}
				onOpenChange={setPickDefaultOpen}
				onPick={(provider, model) => {
					pinDefault(provider, model);
					setPickDefaultOpen(false);
				}}
			/>
		</div>
	);
}

function ProviderModelsGroup({
	provider,
	defaults,
	onPin,
	onToggle,
	onAdd,
	onSearch,
	onRemove
}: {
	provider: Provider;
	defaults: ModelsDoc;
	onPin: (model: SeedModel) => void;
	onToggle: (model: SeedModel, enabled: boolean) => void;
	onAdd: () => void;
	onSearch: () => void;
	onRemove: (model: SeedModel) => void;
}) {
	const {t} = useTranslation();
	const source = modelSourceOf(provider.meta);
	const disconnected = !provider.enabled;
	const enabledCount = (provider.models ?? []).filter(m => m.enabled).length;
	const total = provider.models?.length ?? 0;
	const countLabel = t('settings.providers.enabledModels', {enabled: enabledCount, total});

	return (
		<div className={cn('p-4 space-y-2', disconnected && 'opacity-60 grayscale-[15%]')}>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-[12px] font-semibold tracking-wide text-foreground">
						{provider.name}
					</span>
					<span
						className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
						title={countLabel}
					>
						{enabledCount}/{total}
						{source === 'managed' ? ` · ${t('settings.models.managedLocked')}` : ''}
						{disconnected ? ` · ${t('settings.providers.disconnected')}` : ''}
					</span>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{source === 'search' ? (
						<SettingsButton
							variant="ghost"
							size="xs"
							disabled={disconnected}
							onClick={onSearch}
							className="text-primary hover:text-primary hover:bg-primary/10 text-[11px]"
						>
							<Plus className="mr-1 size-3" />
							{t('settings.models.searchAdd')}
						</SettingsButton>
					) : null}
					{source !== 'managed' ? (
						<SettingsButton
							variant="ghost"
							size="xs"
							disabled={disconnected}
							onClick={onAdd}
							className="text-muted-foreground hover:text-foreground hover:bg-muted text-[11px]"
						>
							<Plus className="mr-1 size-3" />
							{t('settings.models.addModel')}
						</SettingsButton>
					) : null}
					{source === 'managed' ? (
						<span className="text-[11px] text-muted-foreground/70">{t('settings.models.locked')}</span>
					) : null}
				</div>
			</div>

			<div className="space-y-1">
				{(provider.models ?? []).map(model => {
					const isDefault =
						defaults.defaultPlatform === provider.id && defaults.defaultModel === model.modelId;

					return (
						<div
							key={model.modelId}
							title={model.modelId}
							className={cn(
								'group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150',
								isDefault ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/40'
							)}
						>
							<div className="flex min-w-0 items-center gap-2">
								<span className="truncate text-[13px] font-medium text-foreground">
									{model.displayName}
								</span>
								<MonoTag className="text-[10px] hidden sm:inline-flex">{model.modelId}</MonoTag>
								{model.supportsThinking ? (
									<Badge
										variant="secondary"
										className="text-[10px] px-1.5 py-0 gap-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 font-medium shrink-0"
										title={
											model.supportedEfforts?.length
												? t('settings.models.thinkingSupportedWithEfforts', {
														efforts: model.supportedEfforts.join(', ')
													})
												: t('settings.models.thinkingSupported')
										}
									>
										<BrainCircuit className="size-2.5 stroke-[2.2]" />
										{t('settings.models.thinkingBadge')}
									</Badge>
								) : null}
								{model.source === 'manual' ? (
									<Badge variant="outline" className="text-[10px] px-1 py-0">
										{t('settings.models.manual')}
									</Badge>
								) : null}
								{isDefault ? (
									<Badge variant="default" className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/30">
										{t('settings.models.defaultBadge')}
									</Badge>
								) : null}
							</div>

							<div className="flex shrink-0 items-center gap-2">
								<SettingsButton
									size="icon-xs"
									variant="ghost"
									className={cn(
										'cursor-pointer transition-opacity duration-150',
										isDefault
											? 'text-primary opacity-100'
											: 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground'
									)}
									disabled={disconnected || !model.enabled || isDefault}
									onClick={() => onPin(model)}
									title={t('settings.models.setDefault')}
								>
									<Pin className={cn('size-3.5', isDefault && 'fill-current')} />
								</SettingsButton>

								<Switch
									size="sm"
									checked={model.enabled}
									disabled={disconnected}
									aria-label={t('settings.models.toggleVisibility', {name: model.displayName})}
									onCheckedChange={checked => onToggle(model, checked)}
								/>

								{model.source === 'manual' ? (
									<SettingsButton
										variant="ghost"
										size="xs"
										className="cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
										onClick={() => onRemove(model)}
									>
										<Trash2 className="size-3" />
									</SettingsButton>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ChooseDefaultDialog({
	open,
	providers,
	currentPlatform,
	currentModel,
	onOpenChange,
	onPick
}: {
	open: boolean;
	providers: Provider[];
	currentPlatform?: string;
	currentModel?: string;
	onOpenChange: (open: boolean) => void;
	onPick: (provider: Provider, model: SeedModel) => void;
}) {
	const {t} = useTranslation();
	const options = providers
		.filter(p => p.enabled)
		.map(p => ({
			provider: p,
			models: (p.models ?? []).filter(m => m.enabled)
		}))
		.filter(g => g.models.length > 0);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.models.chooseModel')}</DialogTitle>
					<DialogDescription>{t('settings.models.chooseModelDescription')}</DialogDescription>
				</DialogHeader>

				{options.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t('settings.models.noEnabledModels')}</p>
				) : (
					<div className="space-y-4">
						{options.map(({provider, models}) => (
							<div key={provider.id}>
								<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									{provider.name}
								</p>
								<div className="space-y-1">
									{models.map(model => {
										const selected =
											currentPlatform === provider.id && currentModel === model.modelId;
										return (
											<button
												key={model.modelId}
												type="button"
												className={cn(
													'flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left transition-all duration-150 hover:bg-muted/50',
													selected
														? 'border-primary/50 bg-primary/10 shadow-2xs ring-1 ring-primary/30'
														: 'border-border/70'
												)}
												onClick={() => onPick(provider, model)}
											>
												<span className="min-w-0">
													<span className="block text-sm font-semibold text-foreground">
														{model.displayName}
													</span>
													<span className="block truncate font-mono text-[11px] text-muted-foreground">
														{model.modelId}
													</span>
												</span>
												{selected ? (
													<Badge variant="default" className="text-[11px]">
														<Check className="mr-1 size-3" />
														{t('settings.common.default')}
													</Badge>
												) : null}
											</button>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
				<DialogFooter>
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AddModelDialog({
	open,
	providerName,
	onOpenChange,
	onSubmit
}: {
	open: boolean;
	providerName?: string;
	onOpenChange: (open: boolean) => void;
	onSubmit: (
		modelId: string,
		displayName: string,
		supportsThinking: boolean,
		supportedEfforts: string[],
		defaultEffort?: string
	) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [modelId, setModelId] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [supportsThinking, setSupportsThinking] = useState(false);
	const [supportedEfforts, setSupportedEfforts] = useState<string[]>(['low', 'medium', 'high', 'max']);
	const [defaultEffort, setDefaultEffort] = useState('medium');
	const [userToggledThinking, setUserToggledThinking] = useState(false);
	const [saving, setSaving] = useState(false);

	const onModelIdChange = (val: string) => {
		setModelId(val);
		if (!userToggledThinking) {
			const q = val.toLowerCase();
			const isThinkingHeuristic =
				q.includes('reasoner') ||
				q.includes('r1') ||
				q.includes('thinking') ||
				q.includes('thought') ||
				q.includes('o1') ||
				q.includes('o3') ||
				q.includes('o4') ||
				q.includes('claude-3-7') ||
				q.includes('sonnet-3.7') ||
				q.includes('glm-5') ||
				q.includes('qwq');
			if (isThinkingHeuristic) {
				setSupportsThinking(true);
			}
		}
	};

	const toggleEffort = (effort: string) => {
		setSupportedEfforts(prev => {
			const next = prev.includes(effort)
				? prev.filter(e => e !== effort)
				: [...prev, effort];
			if (next.length > 0 && !next.includes(defaultEffort)) {
				setDefaultEffort(next[0] ?? 'medium');
			}
			return next;
		});
	};

	const allEfforts = ['low', 'medium', 'high', 'max'];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" showCloseButton>
				<DialogHeader>
					<DialogTitle>
						{t('settings.models.addModel')}
						{providerName ? ` · ${providerName}` : ''}
					</DialogTitle>
					<DialogDescription>
						{providerName
							? t('settings.models.addModelDescriptionNamed', {
									provider: providerName
								})
							: t('settings.models.addModelDescription')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-1">
					<label className="block space-y-1.5">
						<span className="text-xs font-medium text-foreground">{t('settings.models.modelId')}</span>
						<Input
							value={modelId}
							onChange={e => onModelIdChange(e.target.value)}
							placeholder="e.g. glm-5.3, deepseek-reasoner, claude-3-7-sonnet..."
							className="text-xs font-mono"
							autoFocus
						/>
					</label>

					<label className="block space-y-1.5">
						<span className="text-xs font-medium text-foreground">{t('settings.models.displayName')}</span>
						<Input
							value={displayName}
							onChange={e => setDisplayName(e.target.value)}
							placeholder={modelId.trim() || t('settings.models.displayNamePlaceholder')}
							className="text-xs"
						/>
					</label>

					<div className="rounded-xl border border-border/70 bg-muted/25 dark:bg-muted/15 p-3.5 space-y-3">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2.5 min-w-0">
								<div className="size-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
									<BrainCircuit className="size-4 stroke-[2.2]" />
								</div>
								<div className="min-w-0">
									<div className="text-xs font-semibold text-foreground">
										{t('settings.models.supportsThinking')}
									</div>
									<div className="text-[10.5px] text-muted-foreground truncate">
										{t('settings.models.supportsThinkingDesc')}
									</div>
								</div>
							</div>
							<Switch
								size="sm"
								checked={supportsThinking}
								onCheckedChange={checked => {
									setUserToggledThinking(true);
									setSupportsThinking(checked);
								}}
							/>
						</div>

						{supportsThinking && (
							<div className="space-y-2.5 pt-2 border-t border-border/50 animate-in fade-in-50 duration-150">
								<div className="space-y-1.5">
									<span className="text-[11px] font-medium text-muted-foreground">
										{t('settings.models.supportedEfforts')}
									</span>
									<div className="flex flex-wrap gap-1.5">
										{allEfforts.map(e => {
											const checked = supportedEfforts.includes(e);
											const effortNames: Record<string, string> = {
												low: t('settings.models.effortLow'),
												medium: t('settings.models.effortMedium'),
												high: t('settings.models.effortHigh'),
												max: t('settings.models.effortMax')
											};
											return (
												<button
													key={e}
													type="button"
													onClick={() => toggleEffort(e)}
													className={cn(
														'h-6 px-2.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border flex items-center gap-1',
														checked
															? 'bg-primary/15 text-primary border-primary/30 font-semibold shadow-2xs'
															: 'bg-background/80 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/60'
													)}
												>
													{checked && <Check className="size-3 stroke-[2.5]" />}
													<span>{effortNames[e] ?? e}</span>
												</button>
											);
										})}
									</div>
								</div>

								{supportedEfforts.length > 0 && (
									<div className="flex items-center justify-between gap-2 pt-1">
										<span className="text-[11px] font-medium text-muted-foreground">
											{t('settings.models.defaultEffort')}
										</span>
										<div className="inline-flex h-6 items-center rounded-lg border border-border/60 bg-background/80 p-0.5 shadow-2xs shrink-0">
											{supportedEfforts.map(e => (
												<button
													key={e}
													type="button"
													onClick={() => setDefaultEffort(e)}
													className={cn(
														'h-full rounded-[5px] px-2 text-[10.5px] font-medium transition-all cursor-pointer',
														defaultEffort === e
															? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
															: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
													)}
												>
													{e}
												</button>
											))}
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>

				<DialogFooter className="gap-2">
					<SettingsButton variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton
						disabled={saving || !modelId.trim()}
						onClick={() => {
							setSaving(true);
							void onSubmit(
								modelId.trim(),
								displayName.trim(),
								supportsThinking,
								supportsThinking ? supportedEfforts : [],
								supportsThinking ? defaultEffort : undefined
							).finally(() => setSaving(false));
						}}
					>
						{saving ? t('shell.common.saving') : t('shell.common.save')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type SearchHit = {
	modelId: string;
	displayName: string;
	vendorHint?: string | null;
	contextLength?: number | null;
};

function contextLabel(n?: number | null): string | null {
	if (!n || n <= 0) return null;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
}

function SearchAddDialog({
	open,
	providerId,
	searchModels,
	patchModels,
	onOpenChange
}: {
	open: boolean;
	providerId: string;
	searchModels: (
		id: string,
		query: string
	) => Promise<{ok: true; models: SearchHit[]} | {ok: false; notice: string}>;
	patchModels: (
		id: string,
		patch: Array<{op: string; modelId: string; displayName?: string; enabled?: boolean}>
	) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
}) {
	const {t} = useTranslation();
	const [query, setQuery] = useState('');
	const [searching, setSearching] = useState(false);
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) {
			setQuery('');
			setHits([]);
			setSelected(new Set());
			setError(null);
			return;
		}
		void runSearch('');
	}, [open]);

	const runSearch = async (q: string) => {
		setSearching(true);
		setError(null);
		try {
			const res = await searchModels(providerId, q);
			if (res.ok) {
				setHits(res.models);
			} else {
				setError(res.notice);
				setHits([]);
			}
		} finally {
			setSearching(false);
		}
	};

	const toggle = (id: string) => {
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const save = async () => {
		if (selected.size === 0) return;
		setSaving(true);
		try {
			const patch = hits
				.filter(h => selected.has(h.modelId))
				.map(h => ({
					op: 'add',
					modelId: h.modelId,
					displayName: h.displayName,
					enabled: true
				}));
			const ok = await patchModels(providerId, patch);
			if (ok) onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.models.searchCatalog')}</DialogTitle>
					<DialogDescription>{t('settings.models.searchCatalogDescription')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="flex gap-2">
						<Input
							placeholder={t('settings.models.searchPlaceholder')}
							value={query}
							onChange={e => setQuery(e.target.value)}
							onKeyDown={e => {
								if (e.key === 'Enter') void runSearch(query);
							}}
						/>
						<SettingsButton
							variant="outline"
							disabled={searching}
							onClick={() => void runSearch(query)}
						>
							{searching ? t('settings.common.searching') : t('settings.models.searchButton')}
						</SettingsButton>
					</div>

					{error ? <p className="text-xs text-destructive">{error}</p> : null}

					<div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
						{hits.length === 0 && !searching ? (
							<p className="py-4 text-center text-xs text-muted-foreground">
								{t('settings.models.noSearchResults')}
							</p>
						) : null}
						{hits.map(hit => {
							const isChecked = selected.has(hit.modelId);
							const ctx = contextLabel(hit.contextLength);
							return (
								<label
									key={hit.modelId}
									className="flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 hover:bg-muted"
								>
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-medium">{hit.displayName}</span>
										<span className="block truncate font-mono text-xs text-muted-foreground">
											{hit.modelId}
											{hit.vendorHint ? ` · ${hit.vendorHint}` : ''}
											{ctx ? ` · ${ctx}` : ''}
										</span>
									</span>
									<input
										type="checkbox"
										checked={isChecked}
										onChange={() => toggle(hit.modelId)}
									/>
								</label>
							);
						})}
					</div>
				</div>

				<DialogFooter className="flex items-center justify-between">
					<span className="text-xs text-muted-foreground">
						{t('settings.models.selectedCount', {count: selected.size})}
					</span>
					<div className="flex gap-2">
						<SettingsButton variant="outline" onClick={() => onOpenChange(false)}>
							{t('shell.common.cancel')}
						</SettingsButton>
						<SettingsButton
							disabled={saving || selected.size === 0}
							onClick={() => void save()}
						>
							{saving
								? t('shell.common.saving')
								: t('settings.models.addSelected', {count: selected.size})}
						</SettingsButton>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
