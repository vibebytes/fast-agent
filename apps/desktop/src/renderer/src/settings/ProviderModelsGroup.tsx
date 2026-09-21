import {useTranslation} from 'react-i18next';
import {BrainCircuit, Image as ImageIcon, Pin, Plus, Trash2} from 'lucide-react';
import {Badge} from '@fast-ide/ui/components/badge';
import {Switch} from '@fast-ide/ui/components/switch';
import {cn} from '@fast-ide/ui/lib/utils';
import {MonoTag, SettingsButton} from './SettingsPrimitives';
import {type ModelsDoc} from './useSettings';
import {type Provider, type SeedModel} from './useProviders';
import {modelSourceOf} from './providerPresets';

export function ProviderModelsGroup({
	provider,
	defaults,
	onPin,
	onToggle,
	onToggleImage,
	onAdd,
	onSearch,
	onRemove
}: {
	provider: Provider;
	defaults: ModelsDoc;
	onPin: (model: SeedModel) => void;
	onToggle: (model: SeedModel, enabled: boolean) => void;
	onToggleImage: (model: SeedModel, image: boolean) => void;
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
								{model.inputModalities?.includes('image') ? (
									<Badge
										variant="secondary"
										className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium shrink-0"
										title={t('settings.models.imageSupported')}
									>
										<ImageIcon className="size-2.5 stroke-[2.2]" />
										{t('settings.models.imageBadge')}
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
										model.inputModalities?.includes('image')
											? 'text-primary opacity-100'
											: 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground'
									)}
									disabled={disconnected}
									onClick={() => onToggleImage(model, !model.inputModalities?.includes('image'))}
									title={t('settings.models.toggleImage')}
								>
									<ImageIcon className="size-3.5" />
								</SettingsButton>

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
