import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Boxes,
	Code2,
	Download,
	Globe,
	Layers,
	Plus,
	Puzzle,
	Search,
	Sparkles,
	Terminal,
	Trash2,
	Wrench
} from 'lucide-react';
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
import {Switch} from '@fast-ide/ui/components/switch';
import {
	SettingsButton,
	SettingsSection,
	SettingsState,
	MonoTag,
	settingsControlClass
} from './SettingsPrimitives';
import {useSkills, type MarketSkill, type Skill} from './useSkills';
import {noticeKind, useExtensions, type ExtsView} from './useExtensions';
import type {ExtNote, ExtRow} from '@fastllm/bridge-client';
import {cn} from '@fast-ide/ui/lib/utils';

type Props = {
	engineReady: boolean;
};

type TabId = 'skills' | 'mcp' | 'cli' | 'extensions';
type TemplateId = 'blank' | 'commit' | 'review';
type ScopeId = 'project' | 'global';

export function PluginsSettings({engineReady}: Props) {
	const {t} = useTranslation();
	const skills = useSkills(engineReady);
	const ext = useExtensions(engineReady);
	const [tab, setTab] = useState<TabId>('skills');
	const [filter, setFilter] = useState('');
	const [createOpen, setCreateOpen] = useState(false);
	const [marketOpen, setMarketOpen] = useState(false);

	const totalCount = skills.skills.length;
	const extCount = ext.extensions.filter(row => row.phase !== 'Uninstalled').length;
	const filtered = skills.skills.filter(skill => {
		const q = filter.trim().toLowerCase();
		if (!q) return true;
		return (
			skill.name.toLowerCase().includes(q) ||
			skill.description.toLowerCase().includes(q) ||
			skill.source.toLowerCase().includes(q)
		);
	});

	return (
		<div className="space-y-4">
			{tab === 'skills' && skills.notice ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{t('settings.plugins.actionFailed')}: {skills.notice}
				</div>
			) : null}
			{tab === 'extensions' && ext.notice ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
					{extNoticeCopy(ext.notice, t)}
				</div>
			) : null}

			{/* Top Segment Tabs */}
			<div className="inline-flex h-9 items-center rounded-xl border border-border/70 bg-muted/60 p-1">
				{(
					[
						{id: 'skills' as const, label: t('settings.plugins.tab.skills'), count: totalCount, icon: Terminal},
						{id: 'mcp' as const, label: t('settings.plugins.tab.mcp'), icon: Boxes, hidden: true},
						{id: 'cli' as const, label: t('settings.plugins.tab.cli'), icon: Code2, hidden: true},
						{
							id: 'extensions' as const,
							label: t('settings.plugins.tab.extensions'),
							count: extCount,
							icon: Puzzle
						}
					] as const
				)
					.filter(item => !('hidden' in item && item.hidden))
					.map(item => {
						const Icon = item.icon;
						const active = tab === item.id;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => setTab(item.id)}
								className={cn(
									'flex items-center gap-2 rounded-lg px-3 py-1 text-[12.5px] font-medium transition-all duration-150',
									active
										? 'bg-background text-foreground shadow-2xs font-semibold'
										: 'text-muted-foreground hover:text-foreground'
								)}
							>
								<Icon className="size-3.5" />
								<span>{item.label}</span>
								{'count' in item ? (
									<span
										className={cn(
											'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
											active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
										)}
									>
										{item.count}
									</span>
								) : null}
							</button>
						);
					})}
			</div>

			{tab === 'skills' ? (
				<SkillsPane
					skills={skills}
					filtered={filtered}
					totalCount={totalCount}
					filter={filter}
					onFilterChange={setFilter}
					onCreate={() => setCreateOpen(true)}
					onOpenMarket={() => setMarketOpen(true)}
				/>
			) : tab === 'mcp' ? (
				<McpPlaceholder />
			) : tab === 'cli' ? (
				<CliPlaceholder />
			) : (
				<ExtensionsTab ext={ext} />
			)}

			<CreateSkillDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSubmit={async input => {
					const created = await skills.create(input);
					if (created) setCreateOpen(false);
					return Boolean(created);
				}}
			/>

			<MarketDialog
				open={marketOpen}
				onOpenChange={setMarketOpen}
				searchMarket={skills.searchMarket}
				installMarket={skills.installMarket}
				uninstallMarket={skills.uninstallMarket}
			/>
		</div>
	);
}

function SkillsPane({
	skills,
	filtered,
	totalCount,
	filter,
	onFilterChange,
	onCreate,
	onOpenMarket
}: {
	skills: ReturnType<typeof useSkills>;
	filtered: Skill[];
	totalCount: number;
	filter: string;
	onFilterChange: (value: string) => void;
	onCreate: () => void;
	onOpenMarket: () => void;
}) {
	const {t} = useTranslation();
	if (skills.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.plugins.engineUnavailable')}
				description={t('settings.plugins.engineUnavailableDescription')}
			/>
		);
	}
	if (skills.status === 'loading' && skills.skills.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (skills.status === 'error' && skills.skills.length === 0) {
		return (
			<SettingsState
				status="error"
				title={t('settings.plugins.loadFailed')}
				description={skills.notice ?? t('settings.plugins.loadFailedDescription')}
				onRetry={skills.retry}
			/>
		);
	}
	return (
		<SkillsTab
			skills={filtered}
			totalCount={totalCount}
			filter={filter}
			busy={skills.status === 'loading'}
			onFilterChange={onFilterChange}
			onCreate={onCreate}
			onOpenMarket={onOpenMarket}
			onToggle={(skill, enabled) => void skills.setEnabled(skill.name, skill.scope, enabled)}
			onDelete={skill => {
				if (skill.source === 'market') {
					void skills.uninstallMarket(skill.name, skill.scope);
				} else {
					void skills.remove(skill.name, skill.scope);
				}
			}}
		/>
	);
}

function SkillsTab({
	skills,
	totalCount,
	filter,
	busy,
	onFilterChange,
	onCreate,
	onOpenMarket,
	onToggle,
	onDelete
}: {
	skills: Skill[];
	totalCount: number;
	filter: string;
	busy: boolean;
	onFilterChange: (value: string) => void;
	onCreate: () => void;
	onOpenMarket: () => void;
	onToggle: (skill: Skill, enabled: boolean) => void;
	onDelete: (skill: Skill) => void;
}) {
	const {t} = useTranslation();

	return (
		<div className="space-y-4">
			{/* Action Toolbar */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-48">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
					<Input
						className="h-8 pl-8 rounded-lg border-border/70 bg-background/80 text-[12px] shadow-none"
						value={filter}
						onChange={e => onFilterChange(e.target.value)}
						placeholder={t('settings.plugins.searchSkills')}
					/>
				</div>
				<SettingsButton className="shadow-2xs font-medium" onClick={onCreate}>
					<Plus className="mr-1 size-3.5" />
					{t('settings.plugins.createSkill')}
				</SettingsButton>
				<SettingsButton variant="outline" className="shadow-2xs font-medium" onClick={onOpenMarket}>
					<Sparkles className="mr-1 size-3.5 text-primary" />
					{t('settings.plugins.market')}
				</SettingsButton>
			</div>

			{totalCount === 0 ? (
				<SettingsSection title={t('settings.plugins.emptyTitle')}>
					<SettingsState
						status="empty"
						title={t('settings.plugins.emptyTitle')}
						description={t('settings.plugins.emptyDescription')}
					/>
					<div className="flex justify-center pb-4">
						<SettingsButton onClick={onOpenMarket}>
							{t('settings.plugins.openMarket')}
						</SettingsButton>
					</div>
				</SettingsSection>
			) : skills.length === 0 ? (
				<SettingsSection>
					<SettingsState
						status="empty"
						title={t('settings.plugins.emptyTitle')}
						description={t('settings.plugins.emptyDescription')}
					/>
				</SettingsSection>
			) : (
				<SettingsSection>
					<div className="divide-y divide-border/40">
						{skills.map(skill => (
							<SkillCard
								key={`${skill.scope}:${skill.name}`}
								skill={skill}
								busy={busy}
								onToggle={enabled => onToggle(skill, enabled)}
								onDelete={() => onDelete(skill)}
							/>
						))}
					</div>
				</SettingsSection>
			)}
		</div>
	);
}

function SkillCard({
	skill,
	busy,
	onToggle,
	onDelete
}: {
	skill: Skill;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onDelete: () => void;
}) {
	const {t} = useTranslation();
	const canDelete = skill.source === 'local' || skill.source === 'market';
	const sourceKey =
		skill.source === 'builtin' || skill.source === 'local' || skill.source === 'market'
			? skill.source
			: 'local';
	const scopeKey =
		skill.scope === 'global' || skill.scope === 'project' || skill.scope === 'builtin'
			? skill.scope
			: 'global';

	const scopeColors = {
		project: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
		global: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
		builtin: 'bg-muted text-muted-foreground border-border/60'
	}[scopeKey] || 'bg-muted text-muted-foreground';

	return (
		<div
			className={cn(
				'group flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 transition-all duration-150 hover:bg-muted/20',
				!skill.enabled && 'opacity-60 grayscale-[25%]'
			)}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 flex-wrap">
					{/* Terminal Slash Command Badge */}
					<span className="font-mono font-semibold text-[13px] text-primary bg-primary/10 border border-primary/25 px-2 py-0.5 rounded-md leading-none shadow-2xs">
						/{skill.name}
					</span>

					{/* Scope Chip */}
					<span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none border', scopeColors)}>
						{t(`settings.plugins.scope.${scopeKey}`)}
					</span>

					{/* Source Chip */}
					<span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground leading-none border border-border/40">
						{t(`settings.plugins.source.${sourceKey}`)}
					</span>
				</div>

				<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground/90">
					{skill.description || '—'}
				</p>
			</div>

			<div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
				{/* Hover ghost actions */}
				{canDelete ? (
					<SettingsButton
						variant="ghost"
						size="icon-xs"
						disabled={busy}
						className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"
						onClick={onDelete}
						title={skill.source === 'market' ? t('settings.plugins.uninstall') : t('settings.plugins.delete')}
					>
						<Trash2 className="size-3.5" />
					</SettingsButton>
				) : null}

				{/* Smooth Toggle Switch */}
				<Switch
					size="sm"
					checked={skill.enabled}
					disabled={busy}
					onCheckedChange={onToggle}
					aria-label={`Toggle /${skill.name}`}
				/>
			</div>
		</div>
	);
}

function CreateSkillDialog({
	open,
	onOpenChange,
	onSubmit
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: {name: string; scope: string; template?: string}) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [name, setName] = useState('');
	const [scope, setScope] = useState<ScopeId>('project');
	const [template, setTemplate] = useState<TemplateId>('blank');
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) {
			setName('');
			setScope('project');
			setTemplate('blank');
			setSaving(false);
		}
	}, [open]);

	const save = async () => {
		const trimmed = name.trim().replace(/^\/+/, '');
		if (!trimmed) return;
		setSaving(true);
		try {
			await onSubmit({
				name: trimmed,
				scope,
				...(template === 'blank' ? {} : {template})
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.plugins.createTitle')}</DialogTitle>
					<DialogDescription>{t('settings.plugins.createDescription')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.plugins.name')}</span>
						<div className="flex items-center gap-1">
							<span className="text-sm font-mono text-muted-foreground">/</span>
							<Input
								value={name}
								onChange={e => setName(e.target.value)}
								placeholder={t('settings.plugins.namePlaceholder')}
							/>
						</div>
					</label>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.plugins.scopeLabel')}</span>
						<select
							className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							value={scope}
							onChange={e => setScope(e.target.value as ScopeId)}
						>
							<option value="project">{t('settings.plugins.scope.project')}</option>
							<option value="global">{t('settings.plugins.scope.global')}</option>
						</select>
					</label>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('settings.plugins.template.label')}</span>
						<select
							className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
							value={template}
							onChange={e => setTemplate(e.target.value as TemplateId)}
						>
							<option value="blank">{t('settings.plugins.template.blank')}</option>
							<option value="commit">{t('settings.plugins.template.commit')}</option>
							<option value="review">{t('settings.plugins.template.review')}</option>
						</select>
					</label>
				</div>
				<DialogFooter className="gap-2">
					<SettingsButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t('shell.common.cancel')}
					</SettingsButton>
					<SettingsButton type="button" disabled={saving || !name.trim()} onClick={() => void save()}>
						{saving ? t('shell.common.saving') : t('shell.common.create')}
					</SettingsButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MarketDialog({
	open,
	onOpenChange,
	searchMarket,
	installMarket,
	uninstallMarket
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	searchMarket: (
		query: string
	) => Promise<{marketSkills: MarketSkill[]; message?: string} | null>;
	installMarket: (source: string, scope: string) => Promise<boolean>;
	uninstallMarket: (name: string, scope: string) => Promise<boolean>;
}) {
	const {t} = useTranslation();
	const [query, setQuery] = useState('');
	const [rows, setRows] = useState<MarketSkill[]>([]);
	const [recommended, setRecommended] = useState(false);
	const [loading, setLoading] = useState(false);
	const [busySource, setBusySource] = useState<string | null>(null);
	const [scope, setScope] = useState<ScopeId>('global');

	const runSearch = async (q: string) => {
		setLoading(true);
		try {
			const res = await searchMarket(q);
			if (!res) {
				setRows([]);
				setRecommended(false);
				return;
			}
			setRows(res.marketSkills);
			setRecommended(res.message === 'recommended');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (!open) {
			setQuery('');
			setRows([]);
			setRecommended(false);
			setBusySource(null);
			setScope('global');
			return;
		}
		const handle = window.setTimeout(() => {
			void runSearch(query);
		}, query === '' ? 0 : 300);
		return () => window.clearTimeout(handle);
	}, [query, open]);

	const install = async (row: MarketSkill) => {
		setBusySource(row.source);
		try {
			const ok = await installMarket(row.source, scope);
			if (ok) {
				setRows(prev =>
					prev.map(r => (r.id === row.id ? {...r, isInstalled: true} : r))
				);
			}
		} finally {
			setBusySource(null);
		}
	};

	const uninstall = async (row: MarketSkill) => {
		setBusySource(row.source);
		try {
			const ok = await uninstallMarket(row.skillId || row.name, scope);
			if (ok) {
				setRows(prev =>
					prev.map(r => (r.id === row.id ? {...r, isInstalled: false} : r))
				);
			}
		} finally {
			setBusySource(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" showCloseButton>
				<DialogHeader>
					<DialogTitle>{t('settings.plugins.marketTitle')}</DialogTitle>
					<DialogDescription>{t('settings.plugins.marketDescription')}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Input
							className="min-w-48 flex-1"
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder={t('settings.plugins.marketSearch')}
						/>
						<select
							className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							value={scope}
							onChange={e => setScope(e.target.value as ScopeId)}
						>
							<option value="global">{t('settings.plugins.scope.global')}</option>
							<option value="project">{t('settings.plugins.scope.project')}</option>
						</select>
					</div>
					{recommended ? (
						<p className="text-xs font-medium text-muted-foreground">
							{t('settings.plugins.marketRecommended')}
						</p>
					) : null}
					{loading && rows.length === 0 ? (
						<SettingsState status="loading" title={t('settings.common.loading')} />
					) : rows.length === 0 ? (
						<p className="py-6 text-center text-xs text-muted-foreground">
							{t('settings.plugins.marketEmpty')}
						</p>
					) : (
						<div className="divide-y rounded-md border">
							{rows.map(row => {
								const busy = busySource === row.source;
								return (
									<div
										key={row.id}
										className="flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/50"
									>
										<div className="min-w-0">
											<p className="font-mono text-sm font-medium">/{row.name}</p>
											<p className="text-xs text-muted-foreground">{row.description}</p>
											{row.author ? (
												<p className="mt-1 text-[11px] text-muted-foreground">
													{t('settings.plugins.author')}: {row.author}
												</p>
											) : null}
										</div>
										<SettingsButton
											variant={row.isInstalled ? 'destructive' : 'default'}
											disabled={busy}
											onClick={() =>
												void (row.isInstalled ? uninstall(row) : install(row))
											}
										>
											{row.isInstalled
												? t('settings.plugins.uninstall')
												: t('settings.plugins.install')}
										</SettingsButton>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function McpPlaceholder() {
	const {t} = useTranslation();
	return (
		<SettingsSection
			title={t('settings.plugins.tab.mcp')}
			description={t('settings.plugins.mcpSubtitle')}
		>
			<SettingsState
				status="empty"
				title={t('settings.plugins.mcpPlaceholderTitle')}
				description={t('settings.plugins.mcpPlaceholderDescription')}
			/>
		</SettingsSection>
	);
}

function CliPlaceholder() {
	const {t} = useTranslation();
	return (
		<SettingsSection
			title={t('settings.plugins.tab.cli')}
			description={t('settings.plugins.cliSubtitle')}
		>
			<SettingsState
				status="empty"
				title={t('settings.plugins.cliPlaceholderTitle')}
				description={t('settings.plugins.cliPlaceholderDescription')}
			/>
		</SettingsSection>
	);
}

function extNoticeCopy(notice: string, t: (key: string, options?: {defaultValue?: string}) => string): string {
	const kind = noticeKind(notice);
	if (kind === 'NeedsRestart') return t('settings.plugins.ext.restartHint');
	if (kind === 'Busy') return t('settings.plugins.ext.faultBusy', {defaultValue: notice});
	if (kind === 'DescFault') {
		return `${t('settings.plugins.ext.faultDesc')}: ${notice}`;
	}
	if (kind === 'RemoteUrl') return t('settings.plugins.ext.faultRemote', {defaultValue: notice});
	if (kind === 'Denied') return t('settings.plugins.ext.faultDenied', {defaultValue: notice});
	if (kind === 'EngineDown') return t('settings.plugins.ext.faultEngine', {defaultValue: notice});
	return notice;
}

function ExtensionsTab({
	ext
}: {
	ext: ExtsView & {
		retry: () => void;
		install: (dir?: string) => Promise<boolean>;
		uninstall: (id: string) => Promise<boolean>;
		upgrade: (id: string) => Promise<boolean>;
		reinstall: (id: string) => Promise<boolean>;
	};
}) {
	const {t} = useTranslation();
	if (ext.status === 'disabled') {
		return (
			<SettingsState
				status="disabled"
				title={t('settings.plugins.ext.engineUnavailable')}
				description={t('settings.plugins.ext.engineUnavailablePrep')}
			/>
		);
	}
	if (ext.status === 'loading' && ext.extensions.length === 0) {
		return <SettingsState status="loading" title={t('settings.common.loading')} />;
	}
	if (ext.status === 'error' && ext.extensions.length === 0) {
		return (
			<SettingsState
				status="error"
				title={t('settings.plugins.ext.loadFailed')}
				description={ext.notice ?? t('settings.plugins.ext.loadFailedDescription')}
				onRetry={ext.retry}
			/>
		);
	}

	const visible = ext.extensions.filter(row => row.phase !== 'Uninstalled' || ext.failed?.id === row.id);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<SettingsButton
					className="shadow-2xs font-medium"
					onClick={() => void ext.install()}
					disabled={ext.status === 'loading'}
				>
					<Download className="mr-1 size-3.5" />
					{t('settings.plugins.ext.installLocal')}
				</SettingsButton>
			</div>

			{visible.length === 0 ? (
				<SettingsSection title={t('settings.plugins.ext.emptyTitle')}>
					<SettingsState
						status="empty"
						title={t('settings.plugins.ext.emptyTitle')}
						description={t('settings.plugins.ext.emptyDescription')}
					/>
				</SettingsSection>
			) : (
				<SettingsSection title={t('settings.plugins.tab.extensions')}>
					<div className="divide-y divide-border/40">
						{visible.map(row => (
							<ExtensionCard
								key={row.id}
								row={row}
								failed={ext.failed?.id === row.id}
								busy={ext.status === 'loading'}
								onUninstall={() => void ext.uninstall(row.id)}
								onUpgrade={() => void ext.upgrade(row.id)}
								onReinstall={() => void ext.reinstall(row.id)}
							/>
						))}
					</div>
				</SettingsSection>
			)}

			<LedgerTrail notes={ext.ledger} />
		</div>
	);
}

function ExtensionCard({
	row,
	failed,
	busy,
	onUninstall,
	onUpgrade,
	onReinstall
}: {
	row: ExtRow;
	failed: boolean;
	busy: boolean;
	onUninstall: () => void;
	onUpgrade: () => void;
	onReinstall: () => void;
}) {
	const {t} = useTranslation();
	const phaseLabel = t(`settings.plugins.ext.phase.${row.phase}`, {defaultValue: row.phase});
	const hint = row.restartHint ?? (!row.hotUnload ? t('settings.plugins.ext.restartHint') : undefined);
	return (
		<div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-mono text-[13px] font-semibold">{row.id}</span>
					<Badge variant={failed || row.phase === 'Failed' ? 'destructive' : 'secondary'}>
						{failed ? t('settings.plugins.ext.phase.Failed') : phaseLabel}
					</Badge>
					{row.hotUnload ? (
						<MonoTag>{t('settings.plugins.ext.hotUnload')}</MonoTag>
					) : null}
					{hint ? <MonoTag>{hint}</MonoTag> : null}
				</div>
				{row.fault ? (
					<p className="mt-1.5 text-[12px] text-destructive">{extNoticeCopy(row.fault, t)}</p>
				) : null}
				{failed ? (
					<p className="mt-1 text-[12px] text-muted-foreground">
						{t('settings.plugins.ext.canReinstall')}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{failed ? (
					<SettingsButton size="xs" onClick={onReinstall} disabled={busy}>
						{t('settings.plugins.ext.reinstall')}
					</SettingsButton>
				) : (
					<>
						<SettingsButton size="xs" variant="outline" onClick={onUpgrade} disabled={busy}>
							{t('settings.plugins.ext.upgrade')}
						</SettingsButton>
						<SettingsButton size="xs" variant="outline" onClick={onUninstall} disabled={busy}>
							<Trash2 className="mr-1 size-3" />
							{t('settings.plugins.ext.uninstall')}
						</SettingsButton>
					</>
				)}
			</div>
		</div>
	);
}

function LedgerTrail({notes}: {notes: ExtNote[]}) {
	const {t} = useTranslation();
	if (notes.length === 0) return null;
	return (
		<SettingsSection title={t('settings.plugins.ext.ledgerTitle')}>
			<ul className="space-y-1 px-4 py-3 font-mono text-[12px] text-muted-foreground">
				{notes.map((note, i) => (
					<li key={`${note.id}-${note.mark}-${i}`}>
						{note.id}
						<span className="mx-1.5 text-border">·</span>
						{note.mark === 'drop'
							? t('settings.plugins.ext.markDrop')
							: t('settings.plugins.ext.markPut')}
					</li>
				))}
			</ul>
		</SettingsSection>
	);
}
