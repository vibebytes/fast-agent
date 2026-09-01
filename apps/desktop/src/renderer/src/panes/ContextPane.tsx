import {shellT as t} from '../i18n/t';
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {AmbientRule} from '@fast-ide/session-view';
import {Button} from '@fast-ide/ui/components/button';
import {Switch} from '@fast-ide/ui/components/switch';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	AlertCircle,
	BookOpen,
	ChevronDown,
	Copy,
	FolderOpen,
	Globe2,
	MapPin,
	Pin,
	Plus,
	RefreshCw,
	ScrollText,
	Trash2
} from 'lucide-react';
import type {ProjectState} from '../env';
import {shortPath} from '../railTabs';
import {basename} from '../session/path';

const RULES_PER_SCOPE = 10;
const RULE_TEXT_MAX = 1024;

export function ContextPane({project}: {project: ProjectState | null}) {
	const [rules, setRules] = useState<AmbientRule[]>([]);
	const [draft, setDraft] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [globalOpen, setGlobalOpen] = useState(false);
	const [projectOpen, setProjectOpen] = useState(true);
	const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
	const [copied, setCopied] = useState(false);

	const reload = useCallback(async () => {
		if (!project?.id) {
			setRules([]);
			return;
		}
		setBusy(true);
		setNotice(null);
		try {
			const res = await window.fastIde.listRules(project.id);
			if (res.ok) setRules(res.rules);
			else setNotice(res.notice);
		} finally {
			setBusy(false);
		}
	}, [project?.id]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const globalRules = useMemo(() => rules.filter(r => r.scope === 'global'), [rules]);
	const projectRules = useMemo(() => rules.filter(r => r.scope === 'project'), [rules]);

	useEffect(() => {
		setGlobalOpen(globalRules.length > 0);
	}, [project?.id, globalRules.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- seed open when project/global presence changes

	const enabledCount = rules.filter(r => r.enabled).length;
	const draftLen = draft.length;
	const projectFull = projectRules.length >= RULES_PER_SCOPE;
	const draftOver = draftLen > RULE_TEXT_MAX;
	const canAdd =
		Boolean(project?.id) && Boolean(draft.trim()) && !busy && !projectFull && !draftOver;

	async function addProjectRule() {
		if (!project?.id || !draft.trim() || projectFull || draftOver) return;
		setBusy(true);
		setNotice(null);
		try {
			const res = await window.fastIde.addProjectRule(project.id, draft);
			if (res.ok) {
				// replace=false: Add persisted but List refresh failed — merge so draft clears
				// and the user does not re-submit a duplicate.
				if (res.replace) setRules(res.rules);
				else
					setRules(prev => {
						const ids = new Set(res.rules.map(r => r.id));
						return [...prev.filter(r => !ids.has(r.id)), ...res.rules];
					});
				setDraft('');
			} else setNotice(res.notice);
		} finally {
			setBusy(false);
		}
	}

	async function removeRule(id: string) {
		if (!project?.id) return;
		if (!window.confirm(t('shell.context.deleteRuleConfirm'))) return;
		setBusy(true);
		setNotice(null);
		try {
			const res = await window.fastIde.removeRule(project.id, id);
			if (res.ok) await reload();
			else setNotice(res.notice ?? t('shell.context.removeFailed'));
		} finally {
			setBusy(false);
		}
	}

	async function toggleRule(id: string, enabled: boolean) {
		if (!project?.id) return;
		setBusy(true);
		setNotice(null);
		try {
			const res = await window.fastIde.setRuleEnabled(project.id, id, enabled);
			if (res.ok) await reload();
			else setNotice(res.notice ?? t('shell.context.toggleFailed'));
		} finally {
			setBusy(false);
		}
	}

	async function copyPath() {
		if (!project) return;
		const path = project.cwd ?? project.path;
		try {
			await navigator.clipboard.writeText(path);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			setNotice(t('shell.context.copyPathFailed'));
		}
	}

	const workspacePath = project ? (project.cwd ?? project.path) : '';
	const workspaceName = project
		? project.displayName?.trim() || basename(project.path)
		: '';

	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-xs font-semibold tracking-tight">Context</span>
					{project && rules.length > 0 ? (
						<span className="truncate font-mono text-[10px] text-muted-foreground">
							{enabledCount}/{rules.length} rules
						</span>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="size-6 shrink-0"
					disabled={busy || !project}
					aria-label={t('shell.context.refresh')}
					title={t('shell.context.refresh')}
					onClick={() => void reload()}
				>
					<RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<section className="border-b border-border/60 px-2 py-2">
					<SectionHead
						icon={<ScrollText className="size-3" />}
						title={t('shell.context.rules')}
						count={rules.length}
						suffix={
							project ? (
								<span className="font-mono text-[10px] text-muted-foreground/80">
									{t('shell.context.projectCount', {
										used: projectRules.length,
										max: RULES_PER_SCOPE
									})}
								</span>
							) : null
						}
					/>
					{!project ? (
						<EmptyHint>{t('shell.context.selectProject')}</EmptyHint>
					) : (
						<>
							{notice ? (
								<NoticeBanner text={notice} onRetry={() => void reload()} />
							) : null}

							<div className="mt-1 space-y-2">
								<ScopeBlock
									icon={<Globe2 className="size-3" />}
									title={t('shell.context.global')}
									hint={t('shell.context.readonlyCli')}
									count={globalRules.length}
									open={globalOpen}
									onToggle={() => setGlobalOpen(v => !v)}
								>
									{globalRules.length === 0 ? (
										<EmptyHint>{t('shell.context.noGlobalRules')}</EmptyHint>
									) : (
										<ul className="mt-0.5 space-y-1.5">
											{globalRules.map(r => (
												<RuleRow
													key={r.id}
													rule={r}
													readOnly
													busy={busy}
													expanded={Boolean(expandedIds[r.id])}
													onToggleExpand={() =>
														setExpandedIds(prev => ({
															...prev,
															[r.id]: !prev[r.id]
														}))
													}
												/>
											))}
										</ul>
									)}
								</ScopeBlock>

								<ScopeBlock
									icon={<BookOpen className="size-3" />}
									title={t('shell.context.project')}
									count={projectRules.length}
									badge={`${projectRules.length}/${RULES_PER_SCOPE}`}
									open={projectOpen}
									onToggle={() => setProjectOpen(v => !v)}
								>
									{projectRules.length === 0 ? (
										<EmptyHint>{t('shell.context.noProjectRules')}</EmptyHint>
									) : (
										<ul className="mt-0.5 space-y-1.5">
											{projectRules.map(r => (
												<RuleRow
													key={r.id}
													rule={r}
													busy={busy}
													expanded={Boolean(expandedIds[r.id])}
													onToggleExpand={() =>
														setExpandedIds(prev => ({
															...prev,
															[r.id]: !prev[r.id]
														}))
													}
													onToggleEnabled={enabled => void toggleRule(r.id, enabled)}
													onRemove={() => void removeRule(r.id)}
												/>
											))}
										</ul>
									)}

									<div className="mt-1.5 space-y-1 px-1">
										<textarea
											className={cn(
												'min-h-[4.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none',
												'placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
												'disabled:cursor-not-allowed disabled:opacity-50',
												draftOver && 'border-amber-600/60'
											)}
											placeholder={
												projectFull
													? t('shell.context.limitReached', {used: RULES_PER_SCOPE, max: RULES_PER_SCOPE})
													: t('shell.context.addProjectRule')
											}
											value={draft}
											disabled={busy || projectFull}
											maxLength={RULE_TEXT_MAX + 64}
											onChange={e => setDraft(e.target.value)}
											onKeyDown={e => {
												if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
													e.preventDefault();
													void addProjectRule();
													return;
												}
												if (e.key === 'Enter' && !e.shiftKey) {
													e.preventDefault();
													void addProjectRule();
												}
											}}
										/>
										<div className="flex items-center justify-between gap-2">
											<span
												className={cn(
													'font-mono text-[10px] text-muted-foreground',
													draftOver && 'text-amber-600 dark:text-amber-400'
												)}
											>
												{draftLen}/{RULE_TEXT_MAX}
												{projectFull ? t('shell.context.full') : null}
											</span>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="h-7 gap-1 px-2 text-[11px]"
												disabled={!canAdd}
												onClick={() => void addProjectRule()}
											>
												<Plus className="size-3" />
												{t('shell.context.add')}
											</Button>
										</div>
									</div>
								</ScopeBlock>
							</div>
						</>
					)}
				</section>

				<section className="border-b border-border/60 px-2 py-2">
					<SectionHead icon={<MapPin className="size-3" />} title={t('shell.context.workspace')} />
					{project ? (
						<div className="mt-1 flex items-start gap-2 rounded-md border bg-muted/25 px-2 py-1.5">
							<div className="min-w-0 flex-1">
								<div className="truncate text-[12px] font-medium leading-snug">
									{workspaceName}
								</div>
								<div
									className="truncate font-mono text-[10px] text-muted-foreground"
									title={workspacePath}
								>
									{shortPath(workspacePath)}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-0.5">
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-6"
									aria-label={t('shell.context.copyPath')}
									title={copied ? t('shell.context.copied') : t('shell.context.copyPath')}
									onClick={() => void copyPath()}
								>
									<Copy className="size-3" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-6"
									aria-label={t('shell.context.revealInFinder')}
									title={t('shell.context.revealInFinder')}
									onClick={() => {
										if (!project.id) return;
										void window.fastIde.showProjectInFolder(project.id);
									}}
								>
									<FolderOpen className="size-3" />
								</Button>
							</div>
						</div>
					) : (
						<EmptyHint>{t('shell.context.noProjectOpen')}</EmptyHint>
					)}
				</section>

				<section className="px-2 py-2">
					<SectionHead icon={<Pin className="size-3" />} title={t('shell.context.pinned')} />
					<div className="mt-1 flex flex-col items-start gap-1 rounded-md border border-dashed border-border/70 px-2.5 py-3">
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							{t('shell.context.pinsHint')}
						</p>
					</div>
				</section>
			</div>
		</div>
	);
}

function SectionHead({
	icon,
	title,
	count,
	suffix
}: {
	icon: React.ReactNode;
	title: string;
	count?: number;
	suffix?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-1.5 px-1.5 py-0.5">
			<span className="text-muted-foreground">{icon}</span>
			<span className="text-[11px] font-semibold tracking-wide text-foreground/90">{title}</span>
			{count != null && count > 0 ? (
				<span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
					{count}
				</span>
			) : null}
			{suffix ? <span className="min-w-0 truncate">{suffix}</span> : null}
		</div>
	);
}

function ScopeBlock({
	icon,
	title,
	hint,
	count,
	badge,
	open,
	onToggle,
	children
}: {
	icon: React.ReactNode;
	title: string;
	hint?: string;
	count: number;
	badge?: string;
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<div>
			<button
				type="button"
				className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
				onClick={onToggle}
			>
				<ChevronDown
					className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
				/>
				<span className="text-muted-foreground">{icon}</span>
				<span className="text-foreground/90">{title}</span>
				{hint ? (
					<span className="truncate text-[10px] font-normal text-muted-foreground/70">
						{hint}
					</span>
				) : null}
				<span className="ml-auto shrink-0 font-mono text-[10px] opacity-70">
					{badge ?? (count > 0 ? String(count) : null)}
				</span>
			</button>
			{open ? children : null}
		</div>
	);
}

function RuleRow({
	rule,
	readOnly,
	busy,
	expanded,
	onToggleExpand,
	onToggleEnabled,
	onRemove
}: {
	rule: AmbientRule;
	readOnly?: boolean;
	busy: boolean;
	expanded: boolean;
	onToggleExpand: () => void;
	onToggleEnabled?: (enabled: boolean) => void;
	onRemove?: () => void;
}) {
	const long = rule.text.length > 120 || rule.text.includes('\n');
	const hasFooter = !rule.enabled || long;
	// Single-line compact: center switch with text. Multi-line / footer: pin switch to first line (h-5).
	const compact = !hasFooter && !rule.text.includes('\n');

	return (
		<li
			className={cn(
				'group rounded-md border border-border/50 bg-background/70 px-2.5 py-2 transition-colors',
				'hover:border-border hover:bg-muted/35',
				!rule.enabled && 'bg-muted/15'
			)}
		>
			<div className={cn('flex gap-2.5', compact ? 'items-center' : 'items-start')}>
				<div className="flex h-5 shrink-0 items-center">
					<Switch
						size="sm"
						checked={rule.enabled}
						disabled={busy || readOnly || !onToggleEnabled}
						aria-label={
							rule.enabled ? t('shell.context.disableRule') : t('shell.context.enableRule')
						}
						title={
							readOnly
								? rule.enabled
									? t('shell.context.enabledCli')
									: t('shell.context.disabledCli')
								: rule.enabled
									? t('shell.context.disable')
									: t('shell.context.enable')
						}
						onCheckedChange={v => onToggleEnabled?.(v)}
					/>
				</div>
				<button
					type="button"
					className="min-w-0 flex-1 text-left"
					onClick={() => {
						if (long) onToggleExpand();
					}}
					disabled={!long}
				>
					<p
						className={cn(
							'text-[12px] leading-5 whitespace-pre-wrap break-words',
							!rule.enabled && 'text-muted-foreground',
							!expanded && long && 'line-clamp-3'
						)}
					>
						{rule.text}
					</p>
					{hasFooter ? (
						<div className="mt-1 flex flex-wrap items-center gap-1.5">
							{!rule.enabled ? (
								<span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
									{t('shell.context.notInjected')}
								</span>
							) : null}
							{long ? (
								<span className="text-[10px] text-muted-foreground underline-offset-2 group-hover:underline">
									{expanded ? t('shell.context.collapse') : t('shell.context.expand')}
								</span>
							) : null}
						</div>
					) : null}
				</button>
				{onRemove ? (
					<div className={cn('flex shrink-0', compact ? 'items-center' : 'h-5 items-center')}>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
							disabled={busy}
							aria-label={t('shell.context.deleteRule')}
							title={t('shell.context.delete')}
							onClick={onRemove}
						>
							<Trash2 className="size-3" />
						</Button>
					</div>
				) : null}
			</div>
		</li>
	);
}

function EmptyHint({children}: {children: React.ReactNode}) {
	return (
		<p className="px-1.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground/80">{children}</p>
	);
}

function NoticeBanner({text, onRetry}: {text: string; onRetry: () => void}) {
	return (
		<div className="mt-1 flex items-start gap-2 rounded-md border border-border/80 bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
			<AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
			<p className="min-w-0 flex-1 leading-snug">{text}</p>
			<button
				type="button"
				className="shrink-0 text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
				onClick={onRetry}
			>
				{t('shell.context.retry')}
			</button>
		</div>
	);
}
