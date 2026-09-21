import {useMemo} from 'react';
import {PopoverContent} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	ArrowUpRight,
	BrainCircuit,
	Check,
	ChevronRight,
	Layers,
	Search,
	SearchX,
	Settings,
	SlidersHorizontal,
	Sparkles,
	X,
	Zap
} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {catalogProvider, groupCatalogEntries} from '../catalogGroup';
import type {ModelCatalogEntry} from '../env';
import {getModelCapabilityBadges} from '../modelBrand';
import {matchCatalogEntry} from '@fast-ide/session-view';

const EFFORT_LABEL: Record<string, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra',
	max: 'Max'
};

export function ModelCatalogContent({
	modelCatalog,
	modelSearch,
	setModelSearch,
	setModelPopOpen,
	effectiveModel,
	pickModel
}: {
	modelCatalog: ModelCatalogEntry[];
	modelSearch: string;
	setModelSearch: (q: string) => void;
	setModelPopOpen: (open: boolean) => void;
	effectiveModel: string;
	pickModel: (id: string) => void;
}) {
	const {t} = useTranslation();
	const filteredCatalog = useMemo(() => {
		if (!modelSearch.trim()) return modelCatalog;
		const q = modelSearch.trim().toLowerCase();
		return modelCatalog.filter(entry => {
			const {cleanName, providerLabel, brand} = catalogProvider(entry);
			return (
				cleanName.toLowerCase().includes(q) ||
				entry.display.toLowerCase().includes(q) ||
				entry.id.toLowerCase().includes(q) ||
				providerLabel.toLowerCase().includes(q) ||
				brand.name.toLowerCase().includes(q) ||
				brand.shortName.toLowerCase().includes(q) ||
				entry.aliases.some(a => a.toLowerCase().includes(q))
			);
		});
	}, [modelCatalog, modelSearch]);
	const groupedCatalog = useMemo(() => groupCatalogEntries(filteredCatalog), [filteredCatalog]);

	return (
		<PopoverContent
			className="w-[380px] max-w-[calc(100vw-24px)] p-0 shadow-2xl border border-border/80 rounded-2xl overflow-hidden bg-popover/98 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
			align="start"
			sideOffset={8}
		>
			<div className="border-b border-border/60 bg-background/60 px-3 py-2">
				<div className="relative flex items-center">
					<Search className="size-3.5 text-muted-foreground/80 shrink-0 mr-2" />
					<input
						type="text"
						placeholder={t('shell.composer.searchModelsPlaceholder', {
							defaultValue: '搜索模型名称、ID 或提供商…'
						})}
						value={modelSearch}
						onChange={e => setModelSearch(e.target.value)}
						className="h-6 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
						autoFocus
					/>
					{modelSearch.trim() && (
						<button
							type="button"
							onClick={() => setModelSearch('')}
							className="size-5 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer mr-1"
							aria-label="Clear search"
						>
							<X className="size-3" />
						</button>
					)}
					{modelSearch.trim() && (
						<span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
							{filteredCatalog.length}
						</span>
					)}
				</div>
			</div>

			<div className="max-h-[320px] overflow-y-auto p-1.5 space-y-2">
				{filteredCatalog.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
						<div className="size-10 rounded-full bg-muted/70 flex items-center justify-center text-muted-foreground mb-2.5">
							<SearchX className="size-5" />
						</div>
						<p className="text-xs font-semibold text-foreground mb-1">
							{modelCatalog.length === 0
								? t('shell.composer.loadingModels', {
										defaultValue: '正在加载模型…'
									})
								: t('shell.composer.noModelMatch', {
										defaultValue: '未找到匹配的模型'
									})}
						</p>
						<p className="text-[11px] text-muted-foreground max-w-[240px] mb-3 leading-relaxed">
							{t('shell.composer.noModelHint', {
								defaultValue: '尝试使用其他关键词，或前往设置配置新模型'
							})}
						</p>
						<button
							type="button"
							onClick={() => {
								setModelPopOpen(false);
								window.dispatchEvent(
									new CustomEvent('fast-ide:open-settings', {
										detail: {section: 'models'}
									})
								);
							}}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-background hover:bg-muted text-xs font-medium text-foreground transition-all shadow-xs cursor-pointer"
						>
							<Settings className="size-3.5 text-muted-foreground" />
							<span>
								{t('shell.composer.manageModels', {
									defaultValue: '配置模型与提供商'
								})}
							</span>
						</button>
					</div>
				) : (
					groupedCatalog.map(group => {
						const brand = catalogProvider(group.items[0]!.entry).brand;
						return (
							<div key={group.providerKey} className="space-y-1">
								<div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
									<div className="flex items-center gap-1.5 min-w-0">
										<span
											className={cn(
												'size-4 rounded text-[9.5px] font-bold flex items-center justify-center shrink-0 shadow-2xs',
												brand.iconBg
											)}
										>
											{brand.shortName}
										</span>
										<span className="truncate">{group.providerLabel}</span>
									</div>
									<span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground font-normal">
										{t('shell.composer.modelCountSimple', {
											count: group.items.length,
											defaultValue: `${group.items.length} 个模型`
										})}
									</span>
								</div>

								<div className="space-y-0.5">
									{group.items.map(({entry, cleanName}) => {
										const isSelected = matchCatalogEntry(entry, effectiveModel);
										const badges = getModelCapabilityBadges(entry, cleanName);

										return (
											<button
												key={entry.id}
												type="button"
												onClick={() => void pickModel(entry.id)}
												className={cn(
													'group relative w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer border',
													isSelected
														? 'bg-primary/10 border-primary/25 text-primary shadow-2xs'
														: 'border-transparent hover:bg-muted/70 hover:border-border/50 text-foreground'
												)}
											>
												<div className="min-w-0 flex-1 flex items-start gap-2.5">
													<div
														className={cn(
															'mt-0.5 size-7 rounded-lg flex items-center justify-center shrink-0 transition-colors border',
															isSelected
																? 'bg-primary/15 border-primary/30 text-primary'
																: 'bg-muted/50 border-border/40 text-muted-foreground group-hover:text-foreground group-hover:bg-muted'
														)}
													>
														{badges.some(b => b.key === 'thinking') ? (
															<BrainCircuit className="size-3.5" />
														) : badges.some(b => b.key === 'fast') ? (
															<Zap className="size-3.5" />
														) : (
															<Sparkles className="size-3.5" />
														)}
													</div>

													<div className="min-w-0 flex-1 space-y-0.5">
														<div className="flex items-center gap-1.5">
															<span
																className={cn(
																	'text-xs font-semibold truncate',
																	isSelected
																		? 'text-primary font-bold'
																		: 'text-foreground group-hover:text-primary transition-colors'
																)}
															>
																{cleanName}
															</span>
														</div>

														<div className="flex items-center gap-1.5 flex-wrap">
															<span
																className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[170px]"
																title={entry.id}
															>
																{entry.id}
															</span>
															{badges.map(b => (
																<span
																	key={b.key}
																	className={cn(
																		'text-[9.5px] px-1.5 py-0.2 rounded border font-medium leading-none',
																		b.className
																	)}
																>
																	{b.label}
																</span>
															))}
														</div>
													</div>
												</div>

												<div className="shrink-0 flex items-center gap-1">
													{isSelected ? (
														<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium shadow-xs animate-in fade-in-50 zoom-in-95">
															<Check className="size-3 stroke-[2.5]" />
															<span>
																{t('shell.composer.currentModel', {
																	defaultValue: '当前'
																})}
															</span>
														</div>
													) : (
														<ChevronRight className="size-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
													)}
												</div>
											</button>
										);
									})}
								</div>
							</div>
						);
					})
				)}
			</div>

			<div className="flex items-center justify-between px-3.5 py-2 bg-muted/40 dark:bg-muted/20 border-t border-border/60 text-xs">
				<span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
					<Layers className="size-3 text-muted-foreground/70" />
					{t('shell.composer.modelCount', {
						count: modelCatalog.length,
						defaultValue: `共 ${modelCatalog.length} 个可用模型`
					})}
				</span>
				<button
					type="button"
					onClick={() => {
						setModelPopOpen(false);
						window.dispatchEvent(new CustomEvent('fast-ide:open-settings', {detail: {section: 'models'}}));
					}}
					className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
				>
					<Settings className="size-3 text-muted-foreground group-hover:text-foreground transition-colors" />
					<span>
						{t('shell.composer.manageModels', {
							defaultValue: '配置模型与提供商'
						})}
					</span>
					<ArrowUpRight className="size-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
				</button>
			</div>
		</PopoverContent>
	);
}
export function ThinkingContent({
	supportsThinking,
	supportedEfforts,
	thinking,
	effort,
	toggleThinking,
	pickEffort
}: {
	supportsThinking: boolean;
	supportedEfforts: string[];
	thinking: boolean;
	effort?: string;
	toggleThinking: (next: boolean) => void;
	pickEffort: (next: string) => void;
}) {
	const {t} = useTranslation();
	const getEffortDesc = (e: string) => {
		switch (e) {
			case 'low':
				return t('shell.composer.effortLow', {defaultValue: '快速轻量，日常对话'});
			case 'medium':
				return t('shell.composer.effortMedium', {defaultValue: '均衡推荐，日常编码'});
			case 'high':
				return t('shell.composer.effortHigh', {defaultValue: '深度分析，复杂难题'});
			case 'xhigh':
			case 'max':
				return t('shell.composer.effortExtra', {defaultValue: '极限算力，复杂推理'});
			default:
				return '';
		}
	};

	return (
		<PopoverContent
			className="w-72 p-0 shadow-2xl border border-border/80 rounded-2xl overflow-hidden bg-popover/98 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
			align="start"
			sideOffset={8}
		>
			{supportsThinking && (
				<div className="p-3 border-b border-border/60 bg-muted/30 dark:bg-muted/15">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2 min-w-0">
							<BrainCircuit
								className={cn(
									'size-4 shrink-0 transition-colors',
									thinking ? 'text-primary' : 'text-muted-foreground'
								)}
							/>
							<div className="min-w-0">
								<div className="text-xs font-semibold text-foreground">
									{t('shell.composer.thinkingDeep', {defaultValue: '深度思考'})}
								</div>
								<div className="text-[10.5px] text-muted-foreground truncate">
									{t('shell.composer.thinkingDesc', {
										defaultValue: '生成回答前进行扩展思考'
									})}
								</div>
							</div>
						</div>
						<div className="inline-flex h-7 items-center rounded-lg border border-border/60 bg-background/80 dark:bg-background/40 p-0.5 shadow-2xs shrink-0">
							<button
								type="button"
								onClick={() => void toggleThinking(true)}
								className={cn(
									'h-full rounded-[6px] px-2 text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1',
									thinking
										? 'bg-primary text-primary-foreground shadow-xs font-semibold'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
								)}
							>
								{t('shell.composer.thinkingOn', {defaultValue: '开启'})}
							</button>
							<button
								type="button"
								onClick={() => void toggleThinking(false)}
								className={cn(
									'h-full rounded-[6px] px-2 text-[11px] font-medium transition-all cursor-pointer',
									!thinking
										? 'bg-muted text-foreground font-semibold shadow-2xs'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
								)}
							>
								{t('shell.composer.thinkingOff', {defaultValue: '关闭'})}
							</button>
						</div>
					</div>
				</div>
			)}

			{supportedEfforts.length > 0 && (
				<div className="p-2 space-y-1">
					<div className="px-2 pt-1 pb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<SlidersHorizontal className="size-3" />
							{t('shell.composer.effortLevel', {defaultValue: '思考力度'})}
						</span>
						{!thinking && (
							<span className="text-[10px] text-muted-foreground/70 font-normal">
								{t('shell.composer.thinkingDisabledHint', {
									defaultValue: '开启后生效'
								})}
							</span>
						)}
					</div>

					<div className="space-y-1">
						{supportedEfforts.map(e => {
							const isSelected = effort === e;
							return (
								<button
									key={e}
									type="button"
									disabled={!thinking}
									onClick={() => {
										void pickEffort(e);
									}}
									className={cn(
										'group w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 border',
										!thinking
											? 'opacity-40 cursor-not-allowed border-transparent'
											: isSelected
												? 'bg-primary/10 border-primary/25 text-primary shadow-2xs cursor-pointer'
												: 'border-transparent hover:bg-muted/70 hover:border-border/50 text-foreground cursor-pointer'
									)}
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<span
												className={cn(
													'text-xs font-semibold',
													isSelected && thinking ? 'text-primary font-bold' : 'text-foreground'
												)}
											>
												{EFFORT_LABEL[e] ?? e}
											</span>
										</div>
										<p className="text-[10.5px] text-muted-foreground truncate leading-tight mt-0.5">
											{getEffortDesc(e)}
										</p>
									</div>

									{isSelected && thinking && (
										<div className="size-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
											<Check className="size-3 stroke-[2.5]" />
										</div>
									)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</PopoverContent>
	);
}
export const MODEL_EFFORT_LABEL = EFFORT_LABEL;
