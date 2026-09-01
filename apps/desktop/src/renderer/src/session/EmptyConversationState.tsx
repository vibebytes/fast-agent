import {memo, useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {
	ArrowUpRight,
	Check,
	ChevronDown,
	Compass,
	Cpu,
	FileCode2,
	Folder,
	FolderOpen,
	FolderPlus,
	ShieldCheck,
	Sparkles,
	Workflow,
	Wrench
} from 'lucide-react';
import {Button} from '@fast-ide/ui/components/button';
import {openExistingFolder} from '../openExistingFolder';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@fast-ide/ui/components/dropdown-menu';
import {cn} from '@fast-ide/ui/lib/utils';
import type {ProjectSnapshot, ProjectState} from '@fast-ide/session-view';

export type EmptyConversationStateProps = {
	hasProject: boolean;
	projectReady: boolean;
	currentProject?: ProjectSnapshot | ProjectState | null;
	projects?: ProjectSnapshot[];
	projectName?: string | null;
	hasActiveTask: boolean;
	canChat: boolean;
	onOpenProject?: () => void;
	onSelectProject?: (projectId: string) => void;
	onCreateTask?: () => void;
	onSelectStarterPrompt?: (prompt: string) => void;
};

function formatPathDisplay(p: string): string {
	if (!p) return '';
	// Replace home directory prefix with ~
	return p.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\[^/\\]+/, '~');
}

export const EmptyConversationState = memo(function EmptyConversationState({
	hasProject,
	projectReady,
	currentProject,
	projects = [],
	projectName,
	hasActiveTask,
	onOpenProject,
	onSelectProject,
	onCreateTask,
	onSelectStarterPrompt
}: EmptyConversationStateProps) {
	const {t} = useTranslation();

	const greeting = useMemo(() => {
		const hour = new Date().getHours();
		if (hour < 12) return t('session.empty.greetingMorning', {defaultValue: '早上好'});
		if (hour < 18) return t('session.empty.greetingAfternoon', {defaultValue: '下午好'});
		return t('session.empty.greetingEvening', {defaultValue: '晚上好'});
	}, [t]);

	const handleOpenProject = useCallback(() => {
		if (onOpenProject) {
			onOpenProject();
		} else {
			void openExistingFolder();
		}
	}, [onOpenProject]);

	const handleSelectProject = useCallback(
		async (projectId: string) => {
			if (onSelectProject) {
				onSelectProject(projectId);
			} else if (window.fastIde?.focusProject) {
				await window.fastIde.focusProject(projectId);
			}
		},
		[onSelectProject]
	);

	const handleStarterClick = useCallback(
		async (prompt: string) => {
			if (!hasActiveTask) {
				if (onCreateTask) {
					onCreateTask();
				} else if (window.fastIde?.createTask) {
					await window.fastIde.createTask('New task');
				}
			}
			if (onSelectStarterPrompt) {
				onSelectStarterPrompt(prompt);
			}
			window.dispatchEvent(
				new CustomEvent('fast-ide:insert-composer-text', {
					detail: {text: prompt}
				})
			);
		},
		[hasActiveTask, onCreateTask, onSelectStarterPrompt]
	);

	const selectableProjects = useMemo(() => {
		return projects.filter(p => !p.isDefault || Boolean(p.path));
	}, [projects]);

	const activeDisplayName =
		projectName ||
		currentProject?.displayName ||
		(currentProject?.path ? currentProject.path.split(/[/\\]/).filter(Boolean).pop() : null) ||
		t('session.empty.unnamedProject', {defaultValue: '当前项目'});

	const starterCards = useMemo(
		() => [
			{
				id: 'explore',
				title: t('session.empty.starters.exploreTitle', {defaultValue: '代码库概览与探索'}),
				desc: t('session.empty.starters.exploreDesc', {
					defaultValue: '分析当前项目的核心架构设计、关键模块划分与代码入口'
				}),
				prompt: t('session.empty.starters.explorePrompt', {
					defaultValue: '请帮我梳理并分析当前项目的核心架构设计、关键模块划分与代码入口点。'
				}),
				icon: Compass,
				iconColor: 'text-sky-500 dark:text-sky-400',
				iconBg: 'bg-sky-500/10 border-sky-500/25',
				hoverBorder: 'hover:border-sky-500/40 hover:shadow-sky-500/5'
			},
			{
				id: 'feature',
				title: t('session.empty.starters.featureTitle', {defaultValue: '设计与构建新功能'}),
				desc: t('session.empty.starters.featureDesc', {
					defaultValue: '描述业务需求，让 AI 规划执行步骤并编写代码'
				}),
				prompt: t('session.empty.starters.featurePrompt', {
					defaultValue: '我想为当前项目新增一个功能：'
				}),
				icon: Sparkles,
				iconColor: 'text-purple-500 dark:text-purple-400',
				iconBg: 'bg-purple-500/10 border-purple-500/25',
				hoverBorder: 'hover:border-purple-500/40 hover:shadow-purple-500/5'
			},
			{
				id: 'diagnose',
				title: t('session.empty.starters.diagnoseTitle', {defaultValue: '诊断与重构优化'}),
				desc: t('session.empty.starters.diagnoseDesc', {
					defaultValue: '审查现有逻辑，查找潜在性能瓶颈并提出重构方案'
				}),
				prompt: t('session.empty.starters.diagnosePrompt', {
					defaultValue:
						'请检查当前项目中的代码质量，指出潜在的性能隐患或可优化的架构设计，并给出重构建议。'
				}),
				icon: Wrench,
				iconColor: 'text-amber-500 dark:text-amber-400',
				iconBg: 'bg-amber-500/10 border-amber-500/25',
				hoverBorder: 'hover:border-amber-500/40 hover:shadow-amber-500/5'
			},
			{
				id: 'test',
				title: t('session.empty.starters.testTitle', {defaultValue: '编写单元测试与说明'}),
				desc: t('session.empty.starters.testDesc', {
					defaultValue: '为核心函数和流程补全高质量单元测试与关键说明'
				}),
				prompt: t('session.empty.starters.testPrompt', {
					defaultValue: '请为当前项目的核心模块设计并生成单元测试用例与关键文档。'
				}),
				icon: FileCode2,
				iconColor: 'text-emerald-500 dark:text-emerald-400',
				iconBg: 'bg-emerald-500/10 border-emerald-500/25',
				hoverBorder: 'hover:border-emerald-500/40 hover:shadow-emerald-500/5'
			}
		],
		[t]
	);

	const featureCards = useMemo(
		() => [
			{
				icon: Cpu,
				title: t('session.empty.features.context', {defaultValue: '全局代码感知'}),
				desc: t('session.empty.features.contextDesc', {
					defaultValue: '深度索引项目文件树、符号引用与跨模块调用'
				})
			},
			{
				icon: Workflow,
				title: t('session.empty.features.agent', {defaultValue: '自主智能体协作'}),
				desc: t('session.empty.features.agentDesc', {
					defaultValue: '集成 Goal 架构，支持复杂任务自动拆解与安全执行'
				})
			},
			{
				icon: ShieldCheck,
				title: t('session.empty.features.review', {defaultValue: '可逆代码审查'}),
				desc: t('session.empty.features.reviewDesc', {
					defaultValue: '所有变更以差异比对呈现，支持一键撤销与修改'
				})
			}
		],
		[t]
	);

	return (
		<div className="relative mx-auto my-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-6 text-center animate-in fade-in-50 duration-300">
			{/* Ambient Aurora Glow Background */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -top-16 left-1/2 -z-10 h-80 w-[440px] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/20 via-primary/5 to-transparent blur-3xl opacity-80 dark:opacity-45"
			/>

			{!hasProject ? (
				/* State A: No project opened */
				<div className="flex w-full flex-col items-center">
					{/* Brand Hero Icon */}
					<div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-card/60 p-3 shadow-lg shadow-primary/5 ring-1 ring-primary/20 backdrop-blur-xs">
						<div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
							<Sparkles className="size-5" />
						</div>
					</div>

					{/* Title & Subtitle */}
					<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/95 to-foreground/80 bg-clip-text text-transparent">
						{t('session.empty.welcomeTitle', {defaultValue: '欢迎使用 Fast'})}
					</h1>
					<p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground/90">
						{t('session.empty.welcomeSubtitle', {
							defaultValue: '极速、自主协作的下一代 AI 辅助工程与量化开发环境'
						})}
					</p>

					{/* Primary Call to Action */}
					<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
						<Button
							type="button"
							size="lg"
							className="group gap-2 rounded-xl font-semibold shadow-sm transition-all hover:shadow-md hover:scale-[1.01] active:scale-[0.99]"
							onClick={handleOpenProject}
						>
							<FolderOpen className="size-4 transition-transform group-hover:scale-110" />
							<span>
								{t('session.empty.openProject', {defaultValue: '打开项目文件夹…'})}
							</span>
						</Button>
					</div>

					<p className="mt-2.5 text-[11.5px] text-muted-foreground/80">
						{t('session.empty.noProjectHint', {
							defaultValue:
								'选择本地代码仓库作为工作区，智能体将具备全局代码感知与改写能力'
						})}
					</p>

					{/* 3 Features Bento Strip */}
					<div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
						{featureCards.map((feat, idx) => {
							const Icon = feat.icon;
							return (
								<div
									key={idx}
									className="flex flex-col items-start rounded-xl border border-border/70 bg-card/40 p-3.5 text-left shadow-2xs backdrop-blur-xs transition-colors hover:border-border hover:bg-card/70"
								>
									<div className="mb-2 flex size-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
										<Icon className="size-3.5" />
									</div>
									<h2 className="text-[12.5px] font-semibold text-foreground">
										{feat.title}
									</h2>
									<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
										{feat.desc}
									</p>
								</div>
							);
						})}
					</div>
				</div>
			) : (
				/* State B: Project opened, ready for tasks or prompt starters */
				<div className="flex w-full flex-col items-center">
					{/* Interactive Workspace Switcher Dropdown Pill */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className={cn(
									'group mb-4 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/60 px-3.5 py-1.2 shadow-2xs backdrop-blur-md',
									'cursor-pointer transition-all duration-200 hover:border-primary/40 hover:bg-card/90 hover:shadow-xs',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
								)}
							>
								<span className="flex size-2 items-center justify-center">
									<span
										className={cn(
											'size-1.5 rounded-full',
											projectReady
												? 'bg-emerald-500 animate-pulse'
												: 'bg-amber-500 animate-pulse'
										)}
									/>
								</span>
								<span className="text-[11.5px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
									{projectReady
										? t('session.empty.readyBadge', {defaultValue: '工作区就绪'})
										: t('session.empty.loadingBadge', {defaultValue: '工作区准备中'})}
								</span>
								<span className="text-border/80">·</span>
								<span className="max-w-[190px] truncate text-[11.5px] font-semibold text-foreground tracking-tight">
									{activeDisplayName}
								</span>
								<ChevronDown className="size-3 text-muted-foreground/60 transition-transform duration-200 group-data-[state=open]:rotate-180 group-hover:text-foreground" />
							</button>
						</DropdownMenuTrigger>

						<DropdownMenuContent
							align="center"
							sideOffset={6}
							className="w-72 sm:w-80 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md"
						>
							<div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
								<span>{t('session.empty.workspaceMenuTitle', {defaultValue: '切换工作区'})}</span>
								<span className="text-[10px] font-mono font-normal opacity-70">
									{selectableProjects.length}{' '}
									{t('session.empty.projectsCount', {defaultValue: '个项目'})}
								</span>
							</div>

							<div className="max-h-56 overflow-y-auto space-y-0.5 my-0.5">
								{selectableProjects.map(p => {
									const isCurrent =
										p.id === currentProject?.id ||
										(currentProject?.path && p.path === currentProject.path);
									const pName =
										p.displayName ||
										(p.path ? p.path.split(/[/\\]/).filter(Boolean).pop() : null) ||
										p.id;

									return (
										<DropdownMenuItem
											key={p.id}
											onClick={() => void handleSelectProject(p.id)}
											className={cn(
												'flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
												isCurrent
													? 'bg-primary/10 text-primary font-medium focus:bg-primary/15'
													: 'focus:bg-muted/70 text-foreground'
											)}
										>
											<div className="flex items-center gap-2.5 min-w-0 flex-1">
												<div
													className={cn(
														'flex size-7 shrink-0 items-center justify-center rounded-md border',
														isCurrent
															? 'bg-primary/20 text-primary border-primary/30'
															: 'bg-muted/60 text-muted-foreground border-border/50'
													)}
												>
													<Folder className="size-3.5" />
												</div>
												<div className="min-w-0 flex-1 text-left">
													<div className="flex items-center gap-1.5">
														<span className="text-[12.5px] font-semibold truncate">
															{pName}
														</span>
														{p.status === 'ready' ? (
															<span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
														) : null}
													</div>
													{p.path ? (
														<p className="text-[10.5px] font-mono text-muted-foreground/75 truncate mt-0.5" title={p.path}>
															{formatPathDisplay(p.path)}
														</p>
													) : null}
												</div>
											</div>

											{isCurrent ? (
												<Check className="size-4 text-primary shrink-0 stroke-[2.5]" />
											) : null}
										</DropdownMenuItem>
									);
								})}
							</div>

							<DropdownMenuSeparator className="my-1 bg-border/60" />

							<DropdownMenuItem
								onClick={handleOpenProject}
								className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium text-primary cursor-pointer hover:bg-primary/10 focus:bg-primary/10 focus:text-primary transition-colors"
							>
								<FolderPlus className="size-3.5 shrink-0" />
								<span>
									{t('session.empty.openOtherProject', {defaultValue: '打开其他项目文件夹…'})}
								</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Title & Greeting with Gradient Elegance */}
					<h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/95 to-foreground/80 bg-clip-text text-transparent leading-tight">
						{greeting}
						{t('session.empty.readyPromptTitle', {defaultValue: '，今天想构建什么？'})}
					</h1>
					<p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground/85">
						{t('session.empty.readyPromptSubtitle', {
							defaultValue: '选择下方常用场景快速开始，或在底部直接输入你的需求'
						})}
					</p>

					{/* 4 Starter Action Cards Grid */}
					<div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
						{starterCards.map(card => {
							const Icon = card.icon;
							return (
								<button
									key={card.id}
									type="button"
									onClick={() => void handleStarterClick(card.prompt)}
									className={cn(
										'group relative flex items-start gap-3 rounded-2xl border border-border/70 dark:border-border/60',
										'bg-gradient-to-b from-card/80 via-card/50 to-muted/20 dark:from-card/60 dark:to-muted/10',
										'p-4 text-left shadow-2xs backdrop-blur-md',
										'transition-all duration-200 hover:-translate-y-0.5 hover:bg-card/90',
										'hover:shadow-[0_6px_24px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_6px_28px_rgba(0,0,0,0.35)]',
										'active:scale-[0.985] active:translate-y-0',
										card.hoverBorder
									)}
								>
									<div
										className={cn(
											'flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
											'transition-all duration-300 group-hover:scale-110 group-hover:rotate-3',
											card.iconBg,
											card.iconColor
										)}
									>
										<Icon className="size-4.5" />
									</div>

									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-1">
											<span className="text-[13.5px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
												{card.title}
											</span>
											<ArrowUpRight className="size-3.5 text-muted-foreground/40 opacity-0 -translate-x-1 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-primary" />
										</div>
										<p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
											{card.desc}
										</p>
									</div>
								</button>
							);
						})}
					</div>

					{/* Keyboard Cheatsheet Badges */}
					<div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground/80">
						<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 shadow-2xs">
							<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-background/90 px-1 font-mono text-[10px] font-semibold text-foreground shadow-2xs">
								@
							</kbd>
							<span>{t('session.empty.cheatsheet.mention', {defaultValue: '引用文件/符号'})}</span>
						</div>

						<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 shadow-2xs">
							<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-background/90 px-1 font-mono text-[10px] font-semibold text-foreground shadow-2xs">
								/
							</kbd>
							<span>{t('session.empty.cheatsheet.slash', {defaultValue: '技能与命令'})}</span>
						</div>

						<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 shadow-2xs">
							<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-background/90 px-1 font-mono text-[10px] font-semibold text-foreground shadow-2xs">
								⏎
							</kbd>
							<span>{t('session.empty.cheatsheet.send', {defaultValue: '发送'})}</span>
						</div>

						<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 shadow-2xs">
							<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-background/90 px-1 font-mono text-[10px] font-semibold text-foreground shadow-2xs">
								⇧⏎
							</kbd>
							<span>{t('session.empty.cheatsheet.newline', {defaultValue: '换行'})}</span>
						</div>

						<div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 shadow-2xs">
							<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-background/90 px-1 font-mono text-[10px] font-semibold text-foreground shadow-2xs">
								⌘K
							</kbd>
							<span>{t('session.empty.cheatsheet.newTask', {defaultValue: '新建任务'})}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
});
