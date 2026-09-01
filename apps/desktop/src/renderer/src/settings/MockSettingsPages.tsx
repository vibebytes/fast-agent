import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	AlertTriangle,
	ArrowRight,
	Check,
	Code2,
	FileCode2,
	Globe,
	Layers,
	Lock,
	RotateCcw,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Terminal,
	Zap
} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	SettingsButton,
	SettingsSection,
	SettingsRow,
	SettingsSourceBadge,
	SettingsStatusBadge,
	MonoTag,
	settingsControlClass
} from './SettingsPrimitives';
import {settingsMockStore} from './mock/settingsMockStore';
import {useSettingsMockState} from './SettingsShell';

const copy = (
	t: (key: string, options?: {defaultValue?: string}) => string,
	key: string,
	value: string
) => t(`settings.pages.${key}`, {defaultValue: value});

export function ProjectsSettings() {
	const {t} = useTranslation();
	const state = useSettingsMockState();

	return (
		<div className="space-y-4">
			<SettingsSection
				title={copy(t, 'projects.title', 'Projects')}
				description={copy(t, 'projects.description', 'Project context and overrides.')}
			>
				<div className="p-4 grid gap-3 sm:grid-cols-2">
					{state.projects.map(project => (
						<button
							key={project.id}
							type="button"
							onClick={() => void settingsMockStore.selectProject(project.id)}
							className="rounded-xl border border-border/70 bg-background/60 p-3.5 text-left transition-all duration-150 hover:bg-muted/40 hover:border-primary/40 shadow-xs"
						>
							<div className="flex items-center justify-between">
								<p className="text-[13.5px] font-semibold text-foreground">{project.name}</p>
								<SettingsStatusBadge status={project.status} />
							</div>
							<p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">{project.path}</p>
							<p className="mt-2 text-[11px] text-muted-foreground/80">
								{project.server} · {project.rules} {copy(t, 'projects.rules', 'rules')}
							</p>
						</button>
					))}
				</div>
			</SettingsSection>

			<SettingsSection title={copy(t, 'projects.selected', 'Selected project')}>
				<SettingsRow
					icon={Layers}
					title={copy(t, 'projects.overrides', 'Project overrides')}
					description={copy(
						t,
						'projects.overridesDescription',
						'Values that replace global defaults'
					)}
				>
					<span className="flex items-center gap-2 text-sm font-medium">
						Claude Sonnet <SettingsSourceBadge source="Project override" />
					</span>
				</SettingsRow>
				<SettingsRow
					icon={FileCode2}
					title="Rules and AGENTS.md"
					description={copy(
						t,
						'projects.rulesDescription',
						'Project instructions loaded for tasks'
					)}
				>
					<span className="text-xs text-muted-foreground font-medium">
						4 {copy(t, 'projects.rules', 'rules')} · {copy(t, 'projects.present', 'present')}
					</span>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

export function PermissionsSettings() {
	const {t} = useTranslation();
	const [preset, setPreset] = useState<'strict' | 'workspace' | 'auto'>('workspace');

	const presets = [
		{
			id: 'strict' as const,
			icon: ShieldAlert,
			label: '严格模式',
			english: 'Strict',
			desc: '所有读写操作、命令执行及网络请求均需每次人工手动审批',
			color: 'border-amber-500/30'
		},
		{
			id: 'workspace' as const,
			icon: ShieldCheck,
			label: '工作区沙箱 (推荐)',
			english: 'Workspace',
			desc: '仅限当前项目目录内自由读写，越界操作和危险 Shell 触发询问',
			color: 'border-primary/40 ring-1 ring-primary/20'
		},
		{
			id: 'auto' as const,
			icon: Zap,
			label: '全自动流转',
			english: 'Auto',
			desc: '沙箱内自动执行所有常规工具，仅高危越权指令拦截',
			color: 'border-sky-500/30'
		}
	];

	return (
		<div className="space-y-4">
			{/* Visual 3-Column Policy Cards */}
			<div className="space-y-2">
				<div className="px-1">
					<h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">
						{copy(t, 'permissions.policy', '审批策略')}
					</h3>
					<p className="text-[12px] text-muted-foreground">
						{copy(t, 'permissions.policyDescription', '选择 Agent 操作的默认安全边界')}
					</p>
				</div>

				<div className="grid gap-3 sm:grid-cols-3">
					{presets.map(item => {
						const active = preset === item.id;
						const Icon = item.icon;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => setPreset(item.id)}
								className={cn(
									'relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all duration-150',
									active
										? 'border-primary bg-primary/10 shadow-xs ring-2 ring-primary/30'
										: 'border-border/70 bg-card/40 hover:bg-muted/30 hover:border-border'
								)}
							>
								<div>
									<div className="flex items-center justify-between mb-2">
										<div
											className={cn(
												'flex size-7 items-center justify-center rounded-lg border',
												active
													? 'bg-primary text-primary-foreground border-transparent'
													: 'bg-muted/60 text-muted-foreground border-border/40'
											)}
										>
											<Icon className="size-4" />
										</div>
										{active ? (
											<span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
												<Check className="size-2.5 stroke-[3]" />
											</span>
										) : null}
									</div>

									<p className="text-[13px] font-semibold text-foreground">{item.label}</p>
									<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.desc}</p>
								</div>
							</button>
						);
					})}
				</div>
			</div>

			{/* Permission Groups Matrix */}
			<SettingsSection
				title={copy(t, 'permissions.groups', '权限细则')}
				description="针对不同操作类别的具体管控行为"
			>
				<SettingsRow
					icon={FileCode2}
					title={copy(t, 'permissions.fileAccess', '文件访问')}
					description={copy(
						t,
						'permissions.fileDescription',
						'读取、写入与删除工作区文件'
					)}
				>
					<select className={`${settingsControlClass} min-w-36 font-medium`}>
						<option value="workspace">{copy(t, 'permissions.workspaceOnly', '仅工作区')}</option>
						<option value="ask">操作前询问</option>
						<option value="allow">完全允许</option>
					</select>
				</SettingsRow>

				<SettingsRow
					icon={Terminal}
					title={copy(t, 'permissions.shell', 'Shell 命令')}
					description={copy(
						t,
						'permissions.shellDescription',
						'命令执行与外部软件包安装'
					)}
				>
					<select className={`${settingsControlClass} min-w-36 font-medium`}>
						<option value="ask">{copy(t, 'permissions.ask', '运行前询问')}</option>
						<option value="allow">自动允许</option>
						<option value="deny">完全禁止</option>
					</select>
				</SettingsRow>

				<SettingsRow
					icon={Globe}
					title={copy(t, 'permissions.git', 'Git 和网络')}
					description={copy(
						t,
						'permissions.gitDescription',
						'代码提交、远程推送与外部网络请求'
					)}
				>
					<select className={`${settingsControlClass} min-w-36 font-medium`}>
						<option value="ask">{copy(t, 'permissions.ask', '运行前询问')}</option>
						<option value="allow">自动允许</option>
					</select>
				</SettingsRow>
			</SettingsSection>

			{/* Danger Zone */}
			<SettingsSection
				title={copy(t, 'permissions.danger', '危险区域')}
				description="重置或清除所有临时权限授权"
				tone="danger"
			>
				<div className="flex items-center justify-between px-4 py-3">
					<div>
						<p className="text-[13px] font-medium text-destructive">
							{copy(t, 'permissions.resetOverrides', '重置权限覆盖')}
						</p>
						<p className="mt-0.5 text-[12px] text-muted-foreground">
							{copy(t, 'permissions.resetDescription', '清除所有任务临时放行，恢复为全局推荐沙箱策略。')}
						</p>
					</div>
					<SettingsButton
						variant="destructive"
						className="shadow-2xs font-medium"
						onClick={() => setPreset('workspace')}
					>
						<RotateCcw className="mr-1.5 size-3.5" />
						{t('settings.common.reset', {defaultValue: '重置'})}
					</SettingsButton>
				</div>
			</SettingsSection>
		</div>
	);
}
