import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Bot, BrainCircuit, Search, Sparkles, Zap} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {Badge} from '@fast-ide/ui/components/badge';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	settingsControlClass
} from './SettingsPrimitives';
import {useSettings} from './useSettings';
import {useProviders, type Provider, type SeedModel} from './useProviders';
import {clampEffort} from '../effortClamp';
import {AddModelDialog} from './AddModelDialog';
import {ChooseDefaultDialog} from './ChooseDefaultDialog';
import {ProviderModelsGroup} from './ProviderModelsGroup';
import {SearchAddDialog} from './SearchAddDialog';

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
								onToggleImage={(model, image) => {
									void providers.patchModels(provider.id, [
										{
											op: 'enable',
											modelId: model.modelId,
											inputModalities: image ? ['text', 'image'] : ['text']
										}
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
						supportsImage,
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
								inputModalities: supportsImage ? ['text', 'image'] : undefined,
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
