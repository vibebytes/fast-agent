import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {ConfigurableTool, ConfigurableToolField, PutConfigurableToolInput} from '@fast-ide/session-view';
import {Input} from '@fast-ide/ui/components/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@fast-ide/ui/components/dialog';
import {Switch} from '@fast-ide/ui/components/switch';
import {SettingsButton, SettingsSection, SettingsState} from './SettingsPrimitives';
import {draftsFrom, submitToolForm, toolsSurface} from './toolForm';
import type {useConfigurableTools} from './useConfigurableTools';

type ToolsModel = ReturnType<typeof useConfigurableTools>;

export function ToolsPane({tools}: {tools: ToolsModel}) {
	const {t} = useTranslation();
	const [editing, setEditing] = useState<ConfigurableTool | null>(null);

	useEffect(() => {
		setEditing(current => {
			if (!current) return null;
			return tools.tools.find(tool => tool.name === current.name) ?? null;
		});
	}, [tools.tools]);

	const surface = toolsSurface(tools);
	if (surface === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.plugins.engineUnavailable')}
				description={t('settings.plugins.engineUnavailableDescription')}
			/>
		);
	}
	if (surface === 'loading') {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (surface === 'error') {
		return (
			<SettingsState
				status="error"
				title={t('settings.plugins.tools.loadFailed')}
				description={tools.notice ?? t('settings.plugins.tools.loadFailedDescription')}
				onRetry={() => void tools.retry()}
			/>
		);
	}
	return (
		<>
			{surface === 'empty' ? (
				<SettingsSection>
					<SettingsState status="empty" title={t('settings.plugins.tools.emptyTitle')} />
				</SettingsSection>
			) : (
				<SettingsSection>
					<div className="divide-y divide-border/40">
						{tools.tools.map(tool => (
							<ToolCard
								key={tool.name}
								tool={tool}
								onEnable={() => setEditing(tool)}
								onDisable={() =>
									void tools.save({name: tool.name, enabled: false, values: {}, secrets: {}, clearSecrets: []})
								}
								onConfigure={() => setEditing(tool)}
							/>
						))}
					</div>
				</SettingsSection>
			)}
			<ToolForm
				tool={editing}
				onOpenChange={open => {
					if (!open) setEditing(null);
				}}
				onSave={async input => {
					const ok = await tools.save(input);
					if (ok) setEditing(null);
					return ok;
				}}
			/>
		</>
	);
}

function ToolCard({
	tool,
	onEnable,
	onDisable,
	onConfigure
}: {
	tool: ConfigurableTool;
	onEnable: () => void;
	onDisable: () => void;
	onConfigure: () => void;
}) {
	const {t} = useTranslation();
	const enabled = tool.status === 'active';
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="text-[13px] font-medium">{t(tool.titleKey)}</div>
				<div className="truncate text-[12px] text-muted-foreground">{t(tool.summaryKey)}</div>
			</div>
			{enabled ? (
				<SettingsButton variant="outline" className="h-7 px-2 text-[12px]" onClick={onConfigure}>
					{t('settings.plugins.tools.configure')}
				</SettingsButton>
			) : null}
			<Switch
				checked={enabled}
				onCheckedChange={next => {
					if (next) onEnable();
					else onDisable();
				}}
				aria-label={t(tool.titleKey)}
			/>
		</div>
	);
}

function ToolForm({
	tool,
	onOpenChange,
	onSave
}: {
	tool: ConfigurableTool | null;
	onOpenChange: (open: boolean) => void;
	onSave: (input: PutConfigurableToolInput) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [cleared, setCleared] = useState<Record<string, boolean>>({});
	const [blocked, setBlocked] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setDrafts(tool ? draftsFrom(tool) : {});
		setCleared({});
		setBlocked(false);
	}, [tool]);

	const open = tool != null;
	return (
		<Dialog
			open={open}
			onOpenChange={next => {
				onOpenChange(next);
			}}
		>
			<DialogContent>
				{tool ? (
					<>
						<DialogHeader>
							<DialogTitle>{t(tool.titleKey)}</DialogTitle>
							<DialogDescription>{t(tool.summaryKey)}</DialogDescription>
						</DialogHeader>
						<div className="space-y-3">
							{tool.fields.map(field => (
								<FieldControl
									key={field.key}
									field={field}
									tool={tool}
									draft={drafts[field.key] ?? ''}
									cleared={Boolean(cleared[field.key])}
									onDraft={value => {
										setDrafts(prev => ({...prev, [field.key]: value}));
										if (value.trim()) setCleared(prev => ({...prev, [field.key]: false}));
									}}
									onClear={() => setCleared(prev => ({...prev, [field.key]: true}))}
								/>
							))}
							{blocked ? (
								<p className="text-[12px] text-destructive">{t('settings.plugins.tools.secretRequired')}</p>
							) : null}
						</div>
						<DialogFooter>
							<SettingsButton variant="outline" onClick={() => onOpenChange(false)}>
								{t('settings.plugins.tools.cancel')}
							</SettingsButton>
							<SettingsButton
								disabled={busy}
								onClick={() => {
									const submitted = submitToolForm(tool, drafts, cleared);
									if (submitted.kind === 'hold') {
										setBlocked(true);
										return;
									}
									setBusy(true);
									void onSave(submitted.input).finally(() => setBusy(false));
								}}
							>
								{t('settings.plugins.tools.save')}
							</SettingsButton>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function FieldControl({
	field,
	tool,
	draft,
	cleared,
	onDraft,
	onClear
}: {
	field: ConfigurableToolField;
	tool: ConfigurableTool;
	draft: string;
	cleared: boolean;
	onDraft: (value: string) => void;
	onClear: () => void;
}) {
	const {t} = useTranslation();
	const labelKey = `settings.plugins.tools.field.${field.key}`;
	const translated = t(labelKey);
	const label = translated === labelKey ? field.key : translated;
	const secret = tool.secrets[field.key];
	const last4 = !cleared && secret?.present ? secret.last4 : null;
	return (
		<label className="block space-y-1">
			<span className="text-[12px] font-medium">{label}</span>
			{field.type === 'secret' ? (
				<div className="flex gap-2">
					<Input
						type="password"
						autoComplete="off"
						value={draft}
						placeholder={last4 ? t('settings.plugins.tools.secretKeep', {last4}) : label}
						onChange={e => onDraft(e.target.value)}
					/>
					{secret?.present && !cleared ? (
						<SettingsButton type="button" variant="outline" onClick={onClear}>
							{t('settings.plugins.tools.secretClear')}
						</SettingsButton>
					) : null}
				</div>
			) : field.type === 'toggle' ? (
				<Switch checked={draft === 'true'} onCheckedChange={next => onDraft(next ? 'true' : 'false')} />
			) : field.type === 'choice' ? (
				<select
					className="h-8 w-full rounded-lg border border-border/70 bg-background px-2 text-[12px]"
					value={draft}
					onChange={e => onDraft(e.target.value)}
				>
					<option value="" />
					{(field.options ?? []).map(option => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			) : (
				<Input
					type={field.type === 'number' ? 'number' : 'text'}
					value={draft}
					onChange={e => onDraft(e.target.value)}
				/>
			)}
		</label>
	);
}
