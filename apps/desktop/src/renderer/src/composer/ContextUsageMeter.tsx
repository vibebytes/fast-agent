import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
	formatCompactTokens,
	type ContextBreakdownCategory,
	type ContextUsageView
} from '@fast-ide/session-view';
import {InputGroupButton} from '@fast-ide/ui/components/input-group';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import { Minimize2, Sparkles } from 'lucide-react';

export type BreakdownKey = ContextBreakdownCategory;

export type BreakdownSegment = {
	key: BreakdownKey;
	tokens: number;
	windowSharePercent: number;
	usedSharePercent: number;
	dotClass: string;
	barClass: string;
};

const SEGMENT_META: Record<
	BreakdownKey,
	{
		dotClass: string;
		barClass: string;
	}
> = {
	system: {dotClass: 'bg-indigo-500', barClass: 'bg-indigo-500'},
	tools: {dotClass: 'bg-sky-500', barClass: 'bg-sky-500'},
	summary: {dotClass: 'bg-amber-500', barClass: 'bg-amber-500'},
	messages: {dotClass: 'bg-emerald-500', barClass: 'bg-emerald-500'}
};

export function buildMeterRingGeometry(
	percent: number | undefined,
	size = 14,
	strokeWidth = 2
): {
	size: number;
	strokeWidth: number;
	center: number;
	radius: number;
	circumference: number;
	dashOffset: number;
} {
	const center = size / 2;
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped =
		typeof percent === 'number' && Number.isFinite(percent)
			? Math.max(0, Math.min(100, percent))
			: 0;
	const dashOffset = circumference * (1 - clamped / 100);
	return {size, strokeWidth, center, radius, circumference, dashOffset};
}

export function buildMeterPillLabel(view: ContextUsageView): {
	percentText: string | null;
	ratioText: string;
} {
	const usedStr = formatCompactTokens(view.usedTokens);
	const winStr =
		view.contextWindow && view.contextWindow > 0
			? formatCompactTokens(view.contextWindow)
			: null;
	const percentText =
		typeof view.percent === 'number' && Number.isFinite(view.percent)
			? `${Math.round(Math.min(999, Math.max(0, view.percent)))}%`
			: null;
	const ratioText = winStr ? `${usedStr} / ${winStr}` : usedStr;
	return {percentText, ratioText};
}

export function buildBreakdownSegments(view: ContextUsageView): BreakdownSegment[] {
	const items = view.breakdown;
	if (!items || items.length === 0) return [];
	const totalEst = items.reduce((acc, item) => acc + Math.max(0, item.tokens), 0);
	if (totalEst <= 0) return [];
	const scale = view.usedTokens > 0 ? view.usedTokens / totalEst : 1;
	const denomWindow =
		view.contextWindow && view.contextWindow > 0
			? view.contextWindow
			: Math.max(1, view.usedTokens);
	const denomUsed = Math.max(1, view.usedTokens);
	const segments: BreakdownSegment[] = [];
	for (const item of items) {
		if (!item.tokens || item.tokens <= 0) continue;
		const meta = SEGMENT_META[item.key];
		if (!meta) continue;
		const scaledTokens = Math.max(1, Math.round(item.tokens * scale));
		const windowSharePercent = Math.min(100, (scaledTokens / denomWindow) * 100);
		const usedSharePercent = Math.min(100, (scaledTokens / denomUsed) * 100);
		segments.push({
			key: item.key,
			tokens: scaledTokens,
			windowSharePercent,
			usedSharePercent,
			dotClass: meta.dotClass,
			barClass: meta.barClass
		});
	}
	return segments;
}

/** `0.0042 USD` from the engine's raw cost fields (legacy `cost` wins if present). */
export function formatUsageCost(raw: Record<string, string> | undefined): string | null {
	if (!raw) return null;
	const legacy = raw.cost?.trim();
	const amount = legacy || raw.costAmount?.trim() || '';
	if (!amount) return null;
	const currency = raw.costCurrency?.trim();
	return currency ? `${amount} ${currency}` : amount;
}

export function ContextUsageMeter(props: {
	usage: ContextUsageView | null;
	compacting?: boolean;
	canCompact?: boolean;
	onCompact?: () => void;
}) {
	const {usage, compacting = false, canCompact = false, onCompact} = props;
	const {t} = useTranslation();
	const [open, setOpen] = useState(false);

	if (!usage && !compacting) return null;

	const effectiveLevel = usage?.level ?? 'normal';
	const ring = buildMeterRingGeometry(usage?.percent ?? 0, 14, 2);
	const pill = usage ? buildMeterPillLabel(usage) : null;
	const segments = usage ? buildBreakdownSegments(usage) : [];
	const costLabel = usage ? formatUsageCost(usage.raw) : null;

	const ringColorClass =
		effectiveLevel === 'danger'
			? 'text-rose-500 dark:text-rose-400'
			: effectiveLevel === 'warning'
				? 'text-amber-500 dark:text-amber-400'
				: 'text-emerald-500 dark:text-emerald-400';

	const pillToneClass =
		effectiveLevel === 'danger'
			? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/25 hover:bg-rose-500/15'
			: effectiveLevel === 'warning'
				? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/15'
				: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground border-transparent';

	const breakdownLabel = (key: BreakdownKey): string => {
		switch (key) {
			case 'system':
				return t('shell.composer.contextSystem', {defaultValue: '系统指令'});
			case 'tools':
				return t('shell.composer.contextTools', {defaultValue: '工具定义'});
			case 'summary':
				return t('shell.composer.contextSummary', {defaultValue: '历史摘要'});
			case 'messages':
				return t('shell.composer.contextMessages', {defaultValue: '对话消息'});
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<InputGroupButton
					type="button"
					size="sm"
					variant="ghost"
					data-slot="context-usage-meter"
					data-level={effectiveLevel}
					aria-label={t('shell.composer.contextUsageTitle', {defaultValue: '上下文用量'})}
					title={
						pill
							? `${t('shell.composer.contextUsageTitle', {defaultValue: '上下文用量'})}: ${pill.ratioText}${pill.percentText ? ` (${pill.percentText})` : ''}`
							: t('shell.composer.contextCompacting', {defaultValue: '正在压缩上下文…'})
					}
					className={cn(
						'h-7 shrink-0 gap-1.5 rounded-full px-2 text-[11px] font-medium tabular-nums transition-all duration-150 border',
						open
							? 'bg-muted text-foreground border-border/70 shadow-xs'
							: pillToneClass
					)}
				>
					<svg
						width={ring.size}
						height={ring.size}
						viewBox={`0 0 ${ring.size} ${ring.size}`}
						className={cn('shrink-0 -rotate-90', compacting && 'animate-spin')}
						aria-hidden="true"
					>
						<circle
							cx={ring.center}
							cy={ring.center}
							r={ring.radius}
							fill="none"
							stroke="currentColor"
							strokeWidth={ring.strokeWidth}
							className="opacity-20"
						/>
						<circle
							cx={ring.center}
							cy={ring.center}
							r={ring.radius}
							fill="none"
							stroke="currentColor"
							strokeWidth={ring.strokeWidth}
							strokeDasharray={ring.circumference}
							strokeDashoffset={compacting ? ring.circumference * 0.65 : ring.dashOffset}
							strokeLinecap="round"
							className={cn('transition-all duration-300', ringColorClass)}
						/>
					</svg>
					{compacting ? (
						<span className="truncate max-w-28">
							{t('shell.composer.contextCompactingShort', {defaultValue: '压缩中…'})}
						</span>
					) : pill ? (
						<span className="flex items-center gap-1">
							{pill.percentText ? (
								<span className="font-semibold">{pill.percentText}</span>
							) : (
								<span>{pill.ratioText}</span>
							)}
						</span>
					) : null}
				</InputGroupButton>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				sideOffset={8}
				className="w-72 rounded-2xl border border-border/70 bg-popover/95 p-3.5 text-xs shadow-lg backdrop-blur-md"
			>
				{usage ? (
					<div className="space-y-3">
						{/* Header: Title + Used / Window + Percent badge */}
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium text-foreground">
								{t('shell.composer.contextUsageTitle', {defaultValue: '上下文窗口'})}
							</span>
							<div className="flex items-center gap-1.5 tabular-nums">
								<span className="text-muted-foreground">
									{pill?.ratioText}
								</span>
								{pill?.percentText ? (
									<span
										className={cn(
											'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
											effectiveLevel === 'danger'
												? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
												: effectiveLevel === 'warning'
													? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
													: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
										)}
									>
										{pill.percentText}
									</span>
								) : null}
							</div>
						</div>

						{/* Multi-segment progress bar */}
						<div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
							{segments.length > 0 ? (
								<div className="flex h-full w-full">
									{segments.map(seg => (
										<div
											key={seg.key}
											style={{width: `${Math.max(1.5, seg.windowSharePercent)}%`}}
											className={cn('h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full', seg.barClass)}
										/>
									))}
								</div>
							) : (
								<div
									style={{width: `${Math.min(100, Math.max(2, usage.percent ?? 10))}%`}}
									className={cn(
										'h-full rounded-full transition-all duration-300',
										effectiveLevel === 'danger'
											? 'bg-rose-500'
											: effectiveLevel === 'warning'
												? 'bg-amber-500'
												: 'bg-emerald-500'
									)}
								/>
							)}
						</div>

						{/* Context Breakdown rows */}
						{segments.length > 0 ? (
							<div className="space-y-1.5 pt-0.5">
								<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
									{t('shell.composer.contextBreakdown', {defaultValue: '上下文构成'})}
								</div>
								<div className="space-y-1">
									{segments.map(seg => (
										<div
											key={seg.key}
											className="flex items-center justify-between text-[11px] tabular-nums"
										>
											<span className="flex items-center gap-1.5 text-muted-foreground">
												<span className={cn('size-2 rounded-full shrink-0', seg.dotClass)} />
												<span>{breakdownLabel(seg.key)}</span>
											</span>
											<span className="font-medium text-foreground/90">
												{formatCompactTokens(seg.tokens)}
												<span className="ml-1 text-[10px] text-muted-foreground">
													({Math.round(seg.usedSharePercent)}%)
												</span>
											</span>
										</div>
									))}
								</div>
							</div>
						) : null}

						{/* Token Accounting & Cache Hit */}
						<div className="space-y-1 border-t border-border/60 pt-2.5 text-[11px] tabular-nums">
							<div className="flex items-center justify-between text-muted-foreground">
								<span>{t('shell.composer.contextInputTokens', {defaultValue: '输入 / 输出 Tokens'})}</span>
								<span className="font-medium text-foreground/90">
									{formatCompactTokens(usage.inputTokens)} / {formatCompactTokens(usage.outputTokens)}
								</span>
							</div>
							{usage.cacheReadTokens > 0 ? (
								<div className="flex items-center justify-between text-muted-foreground">
									<span className="flex items-center gap-1">
										<Sparkles className="size-3 text-emerald-500" />
										<span>{t('shell.composer.contextCacheHit', {defaultValue: '缓存命中'})}</span>
									</span>
									<span className="font-medium text-emerald-600 dark:text-emerald-400">
										{formatCompactTokens(usage.cacheReadTokens)}
										{typeof usage.cacheHitPercent === 'number'
											? ` (${Math.round(usage.cacheHitPercent)}%)`
											: ''}
									</span>
								</div>
							) : null}
							{usage.contextBudget && usage.contextBudget > 0 ? (
								<div className="flex items-center justify-between text-muted-foreground">
									<span>{t('shell.composer.contextAutoCompactThreshold', {defaultValue: '自动压缩阈值'})}</span>
									<span className="font-medium text-foreground/90">
										{formatCompactTokens(usage.contextBudget)}
									</span>
								</div>
							) : null}
							{costLabel ? (
								<div className="flex items-center justify-between text-muted-foreground">
									<span>{t('shell.composer.contextCost', {defaultValue: '本轮费用'})}</span>
									<span className="font-medium text-foreground/90">{costLabel}</span>
								</div>
							) : null}
						</div>

						{/* Manual Compact Action */}
						{onCompact ? (
							<div className="border-t border-border/60 pt-2">
								<button
									type="button"
									disabled={!canCompact || compacting}
									onClick={() => {
										setOpen(false);
										onCompact();
									}}
									className={cn(
										'flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
										canCompact && !compacting
											? 'bg-muted/80 text-foreground hover:bg-muted cursor-pointer'
											: 'bg-muted/40 text-muted-foreground/50 cursor-not-allowed'
									)}
								>
									<Minimize2 className="size-3" />
									<span>
										{compacting
											? t('shell.composer.contextCompacting', {defaultValue: '正在压缩上下文…'})
											: t('shell.composer.contextCompactNow', {defaultValue: '立即压缩上下文 (/compact)'})}
									</span>
								</button>
							</div>
						) : null}
					</div>
				) : (
					<div className="py-1 text-center text-muted-foreground">
						{t('shell.composer.contextCompacting', {defaultValue: '正在压缩上下文…'})}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
