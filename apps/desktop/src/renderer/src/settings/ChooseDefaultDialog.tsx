import {useTranslation} from 'react-i18next';
import {Check} from 'lucide-react';
import {Badge} from '@fast-ide/ui/components/badge';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {SettingsButton} from './SettingsPrimitives';
import {type Provider, type SeedModel} from './useProviders';

export function ChooseDefaultDialog({
	open,
	providers,
	currentPlatform,
	currentModel,
	title,
	description,
	onOpenChange,
	onPick
}: {
	open: boolean;
	providers: Provider[];
	currentPlatform?: string;
	currentModel?: string;
	title?: string;
	description?: string;
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
					<DialogTitle>{title ?? t('settings.models.chooseModel')}</DialogTitle>
					<DialogDescription>
						{description ?? t('settings.models.chooseModelDescription')}
					</DialogDescription>
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
