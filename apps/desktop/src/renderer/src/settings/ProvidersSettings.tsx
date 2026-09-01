import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ArrowRight, Bot, Cpu, Globe, KeyRound, Link2, LoaderCircle, Plus, Sparkles, Trash2, Zap} from 'lucide-react';
import {Input} from '@fast-ide/ui/components/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {Badge} from '@fast-ide/ui/components/badge';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	PulseStatusBadge,
	MonoTag
} from './SettingsPrimitives';
import {useProviders, type Provider, type SeedModel, type UpsertInput} from './useProviders';
import {
	PRESET_GROUPS,
	customPresetKey,
	presetByKey,
	statusLabelKey,
	type PresetCard
} from './providerPresets';
import {cn} from '@fast-ide/ui/lib/utils';

type CustomProtocol = 'openai-compat' | 'anthropic';

type Props = {
	engineReady: boolean;
	onOpenModels?: (providerId?: string) => void;
};

function getProviderBrandStyle(id: string, name: string) {
	const lower = `${id} ${name}`.toLowerCase();
	if (lower.includes('deepseek')) {
		return {
			iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25',
			badge: 'DeepSeek',
			initial: 'DS'
		};
	}
	if (lower.includes('moonshot') || lower.includes('kimi')) {
		return {
			iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25',
			badge: 'Moonshot',
			initial: 'MS'
		};
	}
	if (lower.includes('openrouter')) {
		return {
			iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25',
			badge: 'OpenRouter',
			initial: 'OR'
		};
	}
	if (lower.includes('zhipu') || lower.includes('glm')) {
		return {
			iconBg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/25',
			badge: '智谱 GLM',
			initial: 'GLM'
		};
	}
	if (lower.includes('volces') || lower.includes('ark')) {
		return {
			iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/25',
			badge: '火山方舟',
			initial: 'ARK'
		};
	}
	if (lower.includes('anthropic') || lower.includes('claude')) {
		return {
			iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25',
			badge: 'Anthropic',
			initial: 'CL'
		};
	}
	if (lower.includes('openai') || lower.includes('gpt')) {
		return {
			iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25',
			badge: 'OpenAI',
			initial: 'OA'
		};
	}
	return {
		iconBg: 'bg-muted text-muted-foreground border border-border/60',
		badge: 'API',
		initial: name.slice(0, 2).toUpperCase() || 'AI'
	};
}

export function ProvidersSettings({engineReady, onOpenModels}: Props) {
	const {t} = useTranslation();
	const providers = useProviders(engineReady);
	const [addOpen, setAddOpen] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const [formPreset, setFormPreset] = useState<PresetCard | null>(null);
	const [testingId, setTestingId] = useState<string | null>(null);

	const editing = useMemo(
		() => providers.providers.find(p => p.id === editId) ?? null,
		[providers.providers, editId]
	);

	if (providers.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.providers.engineUnavailable')}
				description={t('settings.providers.engineUnavailableDescription')}
			/>
		);
	}
	if (providers.status === 'loading' && providers.providers.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (providers.status === 'error' && providers.providers.length === 0) {
		return (
			<SettingsState
				status="error"
				title={t('settings.providers.loadFailed')}
				description={providers.notice ?? t('settings.providers.loadFailedDescription')}
				onRetry={providers.retry}
			/>
		);
	}

	const handleTest = async (id: string) => {
		setTestingId(id);
		try {
			await providers.test(id);
		} finally {
			setTestingId(null);
		}
	};

	return (
		<div className="space-y-4">
			{providers.notice ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{t('settings.providers.actionFailed')}: {providers.notice}
				</div>
			) : null}

			<div className="flex items-center justify-between gap-3">
				<p className="text-[12px] text-muted-foreground">{t('settings.providers.subtitle')}</p>
				<SettingsButton
					className="shadow-2xs font-medium"
					onClick={() => {
						setFormPreset(null);
						setAddOpen(true);
					}}
				>
					<Plus className="mr-1.5 size-3.5" />
					{t('settings.providers.add')}
				</SettingsButton>
			</div>

			{providers.providers.length === 0 ? (
				<SettingsSection title={t('settings.providers.emptyTitle')}>
					<SettingsState
						status="empty"
						title={t('settings.providers.emptyTitle')}
						description={t('settings.providers.emptyDescription')}
					/>
					<div className="flex justify-center pb-4">
						<SettingsButton
							onClick={() => {
								setFormPreset(null);
								setAddOpen(true);
							}}
						>
							<Plus className="mr-1.5 size-3.5" />
							{t('settings.providers.addFirst')}
						</SettingsButton>
					</div>
				</SettingsSection>
			) : (
				<SettingsSection
					title={t('settings.providers.connected')}
					description={t('settings.providers.connectedDescription')}
				>
					{providers.providers.map(provider => (
						<ProviderCard
							key={provider.id}
							provider={provider}
							busy={providers.status === 'loading'}
							isTesting={testingId === provider.id}
							onEdit={() => setEditId(provider.id)}
							onTest={() => void handleTest(provider.id)}
							onDisconnect={() => void providers.setEnabled(provider.id, false)}
							onReconnect={() => void providers.setEnabled(provider.id, true)}
							onOpenModels={() => onOpenModels?.(provider.id)}
						/>
					))}
				</SettingsSection>
			)}

			<AddProviderDialog
				open={addOpen}
				preset={formPreset}
				onPickPreset={setFormPreset}
				onOpenChange={open => {
					setAddOpen(open);
					if (!open) setFormPreset(null);
				}}
				onSubmit={async input => {
					const created = await providers.upsert(input);
					if (created) {
						setAddOpen(false);
						setFormPreset(null);
						void providers.test(created.id);
					}
					return Boolean(created);
				}}
			/>

			{editing ? (
				<EditProviderDialog
					provider={editing}
					open={Boolean(editId)}
					onOpenChange={open => {
						if (!open) setEditId(null);
					}}
					onSave={async input => {
						const updated = await providers.upsert({
							...input,
							id: editing.id,
							name: input.name ?? editing.name
						});
						if (updated) {
							setEditId(null);
							void providers.test(updated.id);
						}
						return Boolean(updated);
					}}
					onTest={() => void handleTest(editing.id)}
					onDelete={async () => {
						const ok = await providers.remove(editing.id);
						if (ok) setEditId(null);
						return ok;
					}}
				/>
			) : null}
		</div>
	);
}

function providerStatusNote(detail: string | null | undefined): string | null {
	const text = detail?.trim();
	if (!text) return null;
	if (/^HTTP\s+\d+/i.test(text)) return null;
	return text;
}

function ProviderCard({
	provider,
	busy,
	isTesting,
	onEdit,
	onTest,
	onDisconnect,
	onReconnect,
	onOpenModels
}: {
	provider: Provider;
	busy: boolean;
	isTesting: boolean;
	onEdit: () => void;
	onTest: () => void;
	onDisconnect: () => void;
	onReconnect: () => void;
	onOpenModels: () => void;
}) {
	const {t} = useTranslation();
	const statusKey = statusLabelKey(provider.status);
	const disconnected = !provider.enabled;
	const statusNote = providerStatusNote(provider.statusDetail);
	const brand = getProviderBrandStyle(provider.id, provider.name);

	const isHealthy = statusKey === 'ok' && !disconnected;
	const isError = statusKey === 'authFailed' || statusKey === 'unreachable';

	return (
		<div
			className={cn(
				'px-4 py-3.5 transition-colors duration-150 hover:bg-muted/15',
				disconnected && 'opacity-60 grayscale-[20%]'
			)}
		>
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div className="flex items-start gap-3 min-w-0">
					{/* Brand Visual Icon Avatar */}
					<div
						className={cn(
							'flex size-9 shrink-0 items-center justify-center rounded-xl font-semibold text-[11px] shadow-xs',
							brand.iconBg
						)}
					>
						{brand.initial}
					</div>

					<div className="min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-[13.5px] font-semibold tracking-tight text-foreground">
								{provider.name}
							</span>
							<PulseStatusBadge
								status={disconnected ? 'neutral' : isHealthy ? 'healthy' : isError ? 'error' : 'neutral'}
								label={
									disconnected
										? t('settings.providers.disconnected')
										: t(`settings.providers.status.${statusKey}`)
								}
							/>
						</div>

						{statusNote ? (
							<p className="mt-1 text-[11px] text-muted-foreground">{statusNote}</p>
						) : null}

						{/* Subtitle Metadata Tags */}
						<div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
							<button
								type="button"
								onClick={onOpenModels}
								className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary transition-colors hover:bg-primary/10 hover:border-primary/30"
							>
								<span>
									{t('settings.providers.enabledModels', {
										enabled: provider.enabledModelCount,
										total: provider.modelCount
									})}
								</span>
								<ArrowRight className="size-2.5" />
							</button>

							<span className="inline-flex items-center gap-1 text-muted-foreground/80">
								<KeyRound className="size-3 text-muted-foreground/60" />
								<MonoTag>
									{provider.last4
										? t('settings.providers.keyLast4', {last4: provider.last4})
										: t('settings.common.notConfigured')}
								</MonoTag>
							</span>

							{provider.baseUrl ? (
								<span className="inline-flex items-center gap-1 text-muted-foreground/80 truncate max-w-xs" title={provider.baseUrl}>
									<Link2 className="size-3 text-muted-foreground/60" />
									<MonoTag className="truncate max-w-[200px]">{provider.baseUrl}</MonoTag>
								</span>
							) : null}
						</div>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
					<SettingsButton
						variant="outline"
						size="xs"
						disabled={busy || disconnected || isTesting}
						onClick={onTest}
						className="shadow-2xs"
					>
						{isTesting ? (
							<>
								<LoaderCircle className="mr-1 size-3 animate-spin" />
								测试中
							</>
						) : (
							t('settings.providers.test')
						)}
					</SettingsButton>

					<SettingsButton
						variant="ghost"
						size="xs"
						disabled={busy}
						onClick={onEdit}
					>
						{t('settings.providers.edit')}
					</SettingsButton>

					{disconnected ? (
						<SettingsButton
							variant="ghost"
							size="xs"
							disabled={busy}
							onClick={onReconnect}
							className="text-primary hover:text-primary"
						>
							{t('settings.providers.reconnect')}
						</SettingsButton>
					) : (
						<SettingsButton
							variant="ghost"
							size="xs"
							disabled={busy}
							onClick={onDisconnect}
							className="text-muted-foreground hover:text-destructive"
						>
							{t('settings.common.disconnect')}
						</SettingsButton>
					)}
				</div>
			</div>
		</div>
	);
}

function AddProviderDialog({
	open,
	preset,
	onPickPreset,
	onOpenChange,
	onSubmit
}: {
	open: boolean;
	preset: PresetCard | null;
	onPickPreset: (preset: PresetCard | null) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: UpsertInput) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [credential, setCredential] = useState('');
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [seedIds, setSeedIds] = useState('');
	const [protocol, setProtocol] = useState<CustomProtocol>('openai-compat');

	const resetForm = (card: PresetCard | null) => {
		setName(card?.form === 'custom' ? '' : (card?.displayName ?? ''));
		setBaseUrl(card?.baseUrl ?? '');
		setCredential('');
		setShowAdvanced(false);
		setSeedIds('');
		setProtocol('openai-compat');
	};

	const pick = (card: PresetCard) => {
		if (card.comingSoon) return;
		onPickPreset(card);
		resetForm(card);
	};

	const save = async () => {
		if (!preset) return;
		setSaving(true);
		try {
			if (preset.form === 'custom') {
				const models = seedIds
					.split(/[\n,]/)
					.map(s => s.trim())
					.filter(Boolean)
					.map(
						(modelId): SeedModel => ({
							modelId,
							displayName: modelId,
							enabled: true,
							source: 'manual'
						})
					);
				if (!name.trim() || !baseUrl.trim() || !credential.trim() || models.length < 1) return;
				await onSubmit({
					name: name.trim(),
					presetKey: customPresetKey(protocol),
					baseUrl: baseUrl.trim(),
					credential: credential.trim(),
					seedModelsJson: JSON.stringify(models),
					metaJson: JSON.stringify({
						schemaVersion: 1,
						protocol,
						modelSource: 'manual',
						enabled: true,
						defaults: {},
						imported: false
					})
				});
				return;
			}
			if (!credential.trim()) return;
			await onSubmit({
				name: name.trim() || preset.displayName,
				presetKey: preset.presetKey,
				...(baseUrl.trim() && baseUrl.trim() !== preset.baseUrl
					? {baseUrl: baseUrl.trim()}
					: preset.baseUrl
						? {baseUrl: preset.baseUrl}
						: {}),
				credential: credential.trim()
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={next => {
				if (!next) resetForm(null);
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" showCloseButton>
				<DialogHeader>
					<DialogTitle>
						{preset
							? t('settings.providers.configure', {
									name:
										preset.form === 'custom'
											? t('settings.providers.addCustom')
											: preset.displayName
								})
							: t('settings.providers.add')}
					</DialogTitle>
					<DialogDescription>
						{preset
							? t('settings.providers.configureDescription')
							: t('settings.providers.pickPreset')}
					</DialogDescription>
				</DialogHeader>

				{!preset ? (
					<div className="space-y-5">
						{PRESET_GROUPS.map(group => (
							<div key={group.id}>
								<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									{t(`settings.providers.groups.${group.id}`)}
								</p>
								<div className="grid gap-2 sm:grid-cols-2">
									{group.presets.map(card => {
										const brand = getProviderBrandStyle(card.presetKey, card.displayName);
										return (
											<button
												key={card.presetKey}
												type="button"
												disabled={card.comingSoon}
												onClick={() => pick(card)}
												className="flex items-center gap-3 rounded-xl border border-border/70 p-3 text-left transition-all duration-150 hover:bg-muted/40 hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
											>
												<div
													className={cn(
														'flex size-8 shrink-0 items-center justify-center rounded-lg font-semibold text-[10px]',
														brand.iconBg
													)}
												>
													{brand.initial}
												</div>
												<div className="min-w-0 flex-1">
													{card.presetKey === 'custom' ? (
														<>
															<p className="flex items-center gap-1.5 text-sm font-medium">
																<Plus className="size-3.5 text-primary" />
																{t('settings.providers.addCustom')}
															</p>
															<p className="truncate text-xs text-muted-foreground">
																{t('settings.providers.addCustomDescription')}
															</p>
														</>
													) : (
														<>
															<p className="truncate text-sm font-medium">{card.displayName}</p>
															{card.comingSoon ? (
																<p className="text-xs text-muted-foreground">
																	{t('settings.providers.comingSoon')}
																</p>
															) : null}
														</>
													)}
												</div>
											</button>
										);
									})}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="space-y-3">
						{preset.form === 'custom' ? (
							<>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">{t('settings.providers.name')}</span>
									<Input value={name} onChange={e => setName(e.target.value)} />
								</label>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">
										{t('settings.providers.protocol')}
									</span>
									<select
										className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
										value={protocol}
										onChange={e => setProtocol(e.target.value as CustomProtocol)}
									>
										<option value="openai-compat">
											{t('settings.providers.protocolOpenai')}
										</option>
										<option value="anthropic">
											{t('settings.providers.protocolAnthropic')}
										</option>
									</select>
								</label>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">{t('settings.providers.baseUrl')}</span>
									<Input
										placeholder="https://your-server.com/v1"
										value={baseUrl}
										onChange={e => setBaseUrl(e.target.value)}
									/>
								</label>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">{t('settings.providers.apiKey')}</span>
									<Input
										type="password"
										autoComplete="new-password"
										placeholder="sk-..."
										value={credential}
										onChange={e => setCredential(e.target.value)}
									/>
								</label>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">
										{t('settings.providers.seedModels')}
									</span>
									<textarea
										rows={3}
										className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
										placeholder={t('settings.providers.seedModelsPlaceholder')}
										value={seedIds}
										onChange={e => setSeedIds(e.target.value)}
									/>
								</label>
							</>
						) : (
							<>
								{preset.form === 'openrouter' ? (
									<label className="block space-y-1">
										<span className="text-xs text-muted-foreground">
											{t('settings.providers.name')}
										</span>
										<Input
											placeholder={preset.displayName}
											value={name}
											onChange={e => setName(e.target.value)}
										/>
									</label>
								) : null}

								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">{t('settings.providers.apiKey')}</span>
									<Input
										type="password"
										autoComplete="new-password"
										placeholder="sk-..."
										value={credential}
										onChange={e => setCredential(e.target.value)}
									/>
								</label>

								<div>
									<button
										type="button"
										className="text-xs text-primary hover:underline"
										onClick={() => setShowAdvanced(v => !v)}
									>
										{showAdvanced
											? t('settings.providers.hideAdvanced')
											: t('settings.providers.showAdvanced')}
									</button>
									{showAdvanced ? (
										<div className="mt-2 space-y-2 rounded-md border p-3">
											<label className="block space-y-1">
												<span className="text-xs text-muted-foreground">
													{t('settings.providers.customBaseUrl')}
												</span>
												<Input
													placeholder={preset.baseUrl}
													value={baseUrl}
													onChange={e => setBaseUrl(e.target.value)}
												/>
											</label>
										</div>
									) : null}
								</div>
							</>
						)}

						<DialogFooter>
							<SettingsButton variant="outline" onClick={() => onPickPreset(null)}>
								{t('settings.providers.back')}
							</SettingsButton>
							<SettingsButton
								disabled={
									saving ||
									!credential.trim() ||
									(preset.form === 'custom' &&
										(!name.trim() || !baseUrl.trim() || !seedIds.trim()))
								}
								onClick={() => void save()}
							>
								{saving ? (
									<>
										<LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
										{t('settings.common.saving')}
									</>
								) : (
									t('settings.providers.save')
								)}
							</SettingsButton>
						</DialogFooter>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function EditProviderDialog({
	provider,
	open,
	onOpenChange,
	onSave,
	onTest,
	onDelete
}: {
	provider: Provider;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (input: {name?: string; baseUrl?: string; credential?: string}) => Promise<boolean>;
	onTest: () => void;
	onDelete: () => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState(provider.name);
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
	const [credential, setCredential] = useState('');
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		setName(provider.name);
		setBaseUrl(provider.baseUrl ?? '');
		setCredential('');
	}, [provider]);

	const save = async () => {
		setSaving(true);
		try {
			await onSave({
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				...(credential.trim() ? {credential: credential.trim()} : {})
			});
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!confirm(t('settings.providers.deleteConfirm', {name: provider.name}))) return;
		setDeleting(true);
		try {
			await onDelete();
		} finally {
			setDeleting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.providers.editProvider', {name: provider.name})}</DialogTitle>
					<DialogDescription>{t('settings.providers.editProviderDescription')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.providers.name')}</span>
						<Input value={name} onChange={e => setName(e.target.value)} />
					</label>

					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.providers.baseUrl')}</span>
						<Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
					</label>

					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">
							{t('settings.providers.apiKeyOptional')}
						</span>
						<Input
							type="password"
							autoComplete="new-password"
							placeholder={
								provider.last4
									? t('settings.providers.keyLast4', {last4: provider.last4})
									: 'sk-...'
							}
							value={credential}
							onChange={e => setCredential(e.target.value)}
						/>
					</label>
				</div>

				<DialogFooter className="flex flex-row items-center justify-between">
					<SettingsButton
						variant="destructive"
						disabled={deleting || saving}
						onClick={() => void remove()}
					>
						<Trash2 className="mr-1.5 size-3.5" />
						{t('settings.providers.delete')}
					</SettingsButton>

					<div className="flex items-center gap-2">
						<SettingsButton variant="outline" onClick={onTest}>
							{t('settings.providers.test')}
						</SettingsButton>
						<SettingsButton
							disabled={saving || deleting || !name.trim()}
							onClick={() => void save()}
						>
							{saving ? (
								<>
									<LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
									{t('settings.common.saving')}
								</>
							) : (
								t('settings.providers.save')
							)}
						</SettingsButton>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
