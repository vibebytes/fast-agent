import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	Activity,
	BookOpen,
	Boxes,
	Check,
	Code2,
	Copy,
	Cpu,
	Download,
	ExternalLink,
	HardDrive,
	Layers,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Terminal,
	Zap
} from 'lucide-react';
import {
	SettingsButton,
	SettingsSection,
	SettingsRow,
	SettingsState,
	SettingsStatusBadge,
	PulseStatusBadge,
	MonoTag,
	settingsControlClass
} from './SettingsPrimitives';
import {cn} from '@fast-ide/ui/lib/utils';

const c = (t: (key: string, options?: {defaultValue?: string}) => string, key: string, value: string) =>
	t(`settings.pages.${key}`, {defaultValue: value});

export function TasksHistorySettings() {
	const {t} = useTranslation();
	const tasks = [
		{id: 'task-1', title: 'Refactor authentication', status: 'Running', project: 'fast-ide', model: 'Claude Sonnet'},
		{id: 'task-2', title: 'Add test coverage', status: 'Completed', project: 'demo-project', model: 'GPT-5'},
		{id: 'task-3', title: 'Update dependencies', status: 'Failed', project: 'fast-ide', model: 'Qwen Local'}
	];
	const [query, setQuery] = useState('');
	const filtered = tasks.filter(task => task.title.toLowerCase().includes(query.toLowerCase()));

	return (
		<div className="space-y-4">
			<SettingsSection
				title={c(t, 'tasks.title', '任务与历史')}
				description={c(t, 'tasks.description', '查看近期智能体任务与会话生命周期')}
			>
				<div className="p-4 border-b border-border/40 flex gap-2">
					<input
						className="h-8 min-w-0 flex-1 rounded-lg border border-border/70 bg-background/80 px-3 text-[12px] shadow-none focus-visible:outline-none"
						placeholder={c(t, 'tasks.search', '搜索历史任务...')}
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
					<SettingsButton variant="outline">{c(t, 'tasks.allStatuses', '所有状态')}</SettingsButton>
				</div>
				<div className="divide-y divide-border/40">
					{filtered.map(task => (
						<SettingsRow
							key={task.id}
							title={task.title}
							description={`${task.project} · ${task.model}`}
						>
							<div className="flex items-center gap-2">
								<SettingsStatusBadge status={task.status} />
								{task.status === 'Running' ? (
									<SettingsButton variant="outline">{t('settings.common.stop')}</SettingsButton>
								) : null}
							</div>
						</SettingsRow>
					))}
				</div>
				{filtered.length === 0 ? (
					<div className="p-4">
						<SettingsState
							status="empty"
							title={c(t, 'tasks.empty', 'No tasks found')}
							description={c(t, 'tasks.emptyDescription', 'Try another search.')}
						/>
					</div>
				) : null}
			</SettingsSection>
		</div>
	);
}

export function UsageSettings() {
	const {t} = useTranslation();
	return (
		<div className="space-y-4">
			{/* Overview metrics */}
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{key: 'tokens', label: '本月 Token 消耗', value: '1.24M', icon: Zap, color: 'text-primary'},
					{key: 'cost', label: '预估费用', value: '$38.40', icon: Sparkles, color: 'text-emerald-500'},
					{key: 'calls', label: 'API 调用次数', value: '482', icon: Activity, color: 'text-sky-500'}
				].map(item => {
					const Icon = item.icon;
					return (
						<div
							key={item.key}
							className="rounded-xl border border-border/70 bg-card/40 p-3.5 shadow-xs transition-all hover:bg-muted/30"
						>
							<div className="flex items-center justify-between text-muted-foreground">
								<span className="text-[11.5px] font-medium">{item.label}</span>
								<Icon className={cn('size-4', item.color)} />
							</div>
							<p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{item.value}</p>
						</div>
					);
				})}
			</div>

			<SettingsSection
				title={c(t, 'usage.breakdown', '消耗明细')}
				description="按提供商与模型分类的调用统计"
			>
				<SettingsRow
					title="GPT-5 · OpenAI"
					description={c(t, 'usage.exactDescription', 'Exact provider usage')}
				>
					<span className="text-xs font-mono font-medium text-foreground">
						640k tokens · <span className="text-muted-foreground">{t('settings.common.exact')}</span>
					</span>
				</SettingsRow>
				<SettingsRow
					title="Claude Sonnet · Anthropic"
					description={c(t, 'usage.estimatedDescription', 'Calculated from price table')}
				>
					<span className="text-xs font-mono font-medium text-foreground">
						420k tokens · <span className="text-muted-foreground">{t('settings.common.estimated')}</span>
					</span>
				</SettingsRow>
				<SettingsRow
					title="Qwen Local · Ollama"
					description={c(t, 'usage.unknownDescription', 'No provider cost data')}
				>
					<span className="text-xs font-mono font-medium text-foreground">
						180k tokens · <span className="text-muted-foreground">{t('settings.common.unknown')}</span>
					</span>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

export function TracingSettings() {
	const {t} = useTranslation();
	const [enabled, setEnabled] = useState(false);
	const [level, setLevel] = useState('errorsOnly');
	const [message, setMessage] = useState('');
	const levels = [
		{id: 'errorsOnly', label: '仅错误 (Errors only)'},
		{id: 'requests', label: '请求链路 (Requests)'},
		{id: 'verbose', label: '完整追踪 (Verbose)'}
	];

	return (
		<div className="space-y-4">
			<SettingsSection
				title={c(t, 'tracing.state', '链路追踪与日志')}
				description={c(t, 'tracing.stateDescription', '本地捕获智能体执行轨迹与调试 Span')}
			>
				<SettingsRow
					title={c(t, 'tracing.enable', '启用追踪')}
					description={c(t, 'tracing.enableDescription', '记录工具执行、模型交互与任务流程')}
				>
					<input
						type="checkbox"
						className="size-4 rounded"
						checked={enabled}
						onChange={event => setEnabled(event.target.checked)}
					/>
				</SettingsRow>
				<SettingsRow
					title={c(t, 'tracing.level', '追踪详细度')}
					description={c(t, 'tracing.levelDescription', '选择本地诊断数据的采样粒度')}
				>
					<select
						className={`${settingsControlClass} min-w-44`}
						value={level}
						onChange={event => setLevel(event.target.value)}
					>
						{levels.map(item => (
							<option key={item.id} value={item.id}>
								{item.label}
							</option>
						))}
					</select>
				</SettingsRow>
				<SettingsRow
					title={c(t, 'tracing.sensitive', '敏感信息脱敏')}
					description={c(t, 'tracing.sensitiveDescription', '密钥与鉴权 Token 默认始终脱敏处理')}
				>
					<PulseStatusBadge status="healthy" label="始终脱敏" />
				</SettingsRow>
			</SettingsSection>

			<SettingsSection
				title={c(t, 'tracing.retention', '数据留存与导出')}
				description="本地 Trace 文件的生命周期"
			>
				<SettingsRow
					title={c(t, 'tracing.retentionPeriod', '留存周期')}
					description={c(t, 'tracing.retentionDescription', '超期追踪记录将自动清理释放磁盘空间')}
				>
					<select className={`${settingsControlClass} min-w-32`}>
						<option>7 天</option>
						<option>30 天</option>
						<option>90 天</option>
					</select>
				</SettingsRow>
				<div className="flex items-center justify-between p-4 border-t border-border/40">
					{message ? <p className="text-xs text-muted-foreground">{message}</p> : <div />}
					<div className="flex gap-2">
						<SettingsButton
							variant="outline"
							onClick={() => setMessage(c(t, 'tracing.exported', '追踪数据已准备就绪并导出。'))}
						>
							<Download className="mr-1.5 size-3.5" />
							{c(t, 'tracing.export', '导出最新 Trace')}
						</SettingsButton>
						<SettingsButton
							variant="destructive"
							onClick={() => setMessage(c(t, 'tracing.cleared', '本地追踪记录已清除。'))}
						>
							{c(t, 'tracing.clear', '清空记录')}
						</SettingsButton>
					</div>
				</div>
			</SettingsSection>
		</div>
	);
}

export function AboutSettings() {
	const {t} = useTranslation();
	const [copied, setCopied] = useState(false);

	const copyDiag = () => {
		const diag = `Fast: 0.0.1 (mock-build-2026.08)\nElectron: 36.3.1\nPlatform: ${navigator.platform}\nEngine: Connected`;
		void navigator.clipboard.writeText(diag);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="space-y-4">
			{/* Brand Hero Spotlight */}
			<div className="relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-r from-primary/10 via-primary/5 to-card/40 p-5 shadow-xs">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="flex items-center gap-3.5">
						<div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
							<Sparkles className="size-6" />
						</div>
						<div>
							<div className="flex items-center gap-2">
								<h2 className="text-lg font-bold tracking-tight text-foreground">Fast</h2>
								<span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-primary border border-primary/25">
									v0.0.1 Development
								</span>
							</div>
							<p className="mt-0.5 text-xs text-muted-foreground">
								极速、模块化、原生集成的下一代 AI 辅助量化与工程开发环境
							</p>
						</div>
					</div>

					<SettingsButton variant="outline" className="shrink-0 gap-1.5 font-medium shadow-2xs">
						<RefreshCw className="size-3.5" />
						检查更新
					</SettingsButton>
				</div>
			</div>

			{/* Bento Runtime Metrics Grid */}
			<div className="space-y-2">
				<p className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
					运行环境与服务状态
				</p>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-3.5 shadow-xs">
						<div className="flex items-center gap-2.5">
							<div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/25">
								<Cpu className="size-4" />
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">桌面运行时 (Electron)</p>
								<p className="font-mono text-sm font-semibold text-foreground">36.3.1</p>
							</div>
						</div>
						<MonoTag>ARM64</MonoTag>
					</div>

					<div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-3.5 shadow-xs">
						<div className="flex items-center gap-2.5">
							<div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
								<HardDrive className="size-4" />
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">核心计算引擎 (Engine)</p>
								<p className="font-mono text-sm font-semibold text-foreground">FastLLM v2</p>
							</div>
						</div>
						<PulseStatusBadge status="healthy" label="已连接" />
					</div>
				</div>
			</div>

			{/* Actionable Resource Tiles */}
			<div className="space-y-2">
				<p className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
					支持与资源
				</p>
				<div className="grid gap-3 sm:grid-cols-2">
					<button
						type="button"
						onClick={() => window.open('https://github.com', '_blank')}
						className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-3.5 text-left transition-all duration-150 hover:bg-muted/40 hover:border-primary/40 shadow-xs group"
					>
						<div className="flex items-center gap-3">
							<div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
								<BookOpen className="size-4" />
							</div>
							<div>
								<p className="text-[13px] font-medium text-foreground">使用文档与指南</p>
								<p className="text-[11px] text-muted-foreground">查看配置教程、快捷键与技能开发</p>
							</div>
						</div>
						<ExternalLink className="size-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
					</button>

					<button
						type="button"
						onClick={copyDiag}
						className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 p-3.5 text-left transition-all duration-150 hover:bg-muted/40 hover:border-primary/40 shadow-xs group"
					>
						<div className="flex items-center gap-3">
							<div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
								<Copy className="size-4" />
							</div>
							<div>
								<p className="text-[13px] font-medium text-foreground">复制系统诊断信息</p>
								<p className="text-[11px] text-muted-foreground">用于排查故障或提交 Issue 报告</p>
							</div>
						</div>
						{copied ? (
							<span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
								<Check className="size-3.5" /> 已复制
							</span>
						) : (
							<Copy className="size-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
