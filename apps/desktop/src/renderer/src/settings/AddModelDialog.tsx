import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {BrainCircuit, Check, Image as ImageIcon} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
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
import {SettingsButton} from './SettingsPrimitives';

export function AddModelDialog({
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
		supportsImage: boolean,
		defaultEffort?: string
	) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [modelId, setModelId] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [supportsThinking, setSupportsThinking] = useState(false);
	const [supportsImage, setSupportsImage] = useState(false);
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

					<div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/25 dark:bg-muted/15 p-3.5">
						<div className="flex items-center gap-2.5 min-w-0">
							<div className="size-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
								<ImageIcon className="size-4 stroke-[2.2]" />
							</div>
							<div className="min-w-0">
								<div className="text-xs font-semibold text-foreground">
									{t('settings.models.supportsImage')}
								</div>
								<div className="text-[10.5px] text-muted-foreground truncate">
									{t('settings.models.supportsImageDesc')}
								</div>
							</div>
						</div>
						<Switch size="sm" checked={supportsImage} onCheckedChange={setSupportsImage} />
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
								supportsImage,
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
