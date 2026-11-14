import type {DshDeltaCaps} from '../wire/session.js';
import type {ContextPruneView, TranscriptState, UsageView} from './state.js';

/** One token/cost bucket row for the footer tooltip. */
export type UsageBucketRow = {
	key: string;
	value: number;
};

/** Footer usage view — `null` when the host cannot emit `usage_reported`. */
export type UsageFooterView = {
	runId: string;
	turnId?: string;
	/** Additive buckets in stable key order (input/output/cache_read/cache_write/total first). */
	buckets: UsageBucketRow[];
	/** Non-additive engine detail (model, reasoning, cost) — never summed. */
	raw?: Record<string, string>;
};

/** Narrow view of the delta-only surfaces (usage / prune / child tails) a renderer slice carries. */
export type DeltaSurfaces = Pick<TranscriptState, 'usage' | 'contextPrunes' | 'childTranscripts' | 'compacting'>;

/** Banner / status line for compaction: running (Stage B in flight) or the latest result. */
export type CompactionNotice = {
	runId: string;
	phase: 'running' | 'done';
	text: string;
	reason?: string;
	tokensBefore?: number;
	remainingTokens?: number;
	durationMs?: number;
	startedAt?: number;
};

function kTokens(n: number): string {
	return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** `128k → 51k` when both sides are known. */
export function tokenSpan(before?: number, after?: number): string | undefined {
	return before !== undefined && after !== undefined ? `${kTokens(before)} → ${kTokens(after)}` : undefined;
}

const BUCKET_ORDER = ['input', 'output', 'cache_read', 'cache_write', 'total'];

function orderedBuckets(buckets: Record<string, number>): UsageBucketRow[] {
	const keys = Object.keys(buckets);
	const head = BUCKET_ORDER.filter(key => key in buckets);
	const tail = keys.filter(key => !BUCKET_ORDER.includes(key)).sort();
	return [...head, ...tail].map(key => ({key, value: buckets[key] as number}));
}

/**
 * Token footer buckets for the active run. `caps.delta.usage === false` (or absent)
 * means the host never emits `usage_reported` — return `null` so the UI draws no shell.
 */
export function usageFooter(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): UsageFooterView | null {
	if (caps?.usage !== true) return null;
	const usage: UsageView | undefined = state.usage;
	if (!usage) return null;
	const buckets = orderedBuckets(usage.buckets);
	if (!buckets.length) return null;
	return {
		runId: usage.runId,
		...(usage.turnId ? {turnId: usage.turnId} : {}),
		buckets,
		...(usage.raw ? {raw: usage.raw} : {})
	};
}

/** Result text for one `context_pruned` notice (no running phase). */
export function contextPruneText(notice: ContextPruneView): string {
	const span = tokenSpan(notice.tokensBefore, notice.remainingTokens);
	const suffix = span ? `（${span}）` : '';
	switch (notice.reason) {
		case 'nothing-to-compact':
			return '当前没有可压缩的历史上下文';
		case 'summary-breaker':
			return `摘要压缩暂时熔断，已使用裁剪方式释放上下文${suffix}`;
		case 'summary-fallback':
			return `摘要压缩未成功，已回退到裁剪方式${suffix}`;
		case 'summary':
			return `历史上下文已压缩为摘要${suffix}`;
		case 'compaction':
			return `历史上下文已裁剪${suffix}`;
		default:
			return notice.prunedIds.length
				? `已裁剪 ${notice.prunedIds.length} 条历史上下文`
				: '历史上下文已调整';
	}
}

/** Latest context-prune notice — `null` when the host explicitly disabled contextPrune. */
export function contextPruneNotice(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): (ContextPruneView & {text: string}) | null {
	// Undefined caps: permissive (Fast never ships dsh_caps; bridge already gated).
	if (caps?.contextPrune === false) return null;
	const notice = state.contextPrunes?.at(-1);
	if (!notice) return null;
	return {...notice, text: contextPruneText(notice)};
}

/**
 * Compaction as a progress state: the in-flight `context_compacting` wins over the latest
 * result, so a banner shows "compacting…" while the run is blocked and the outcome after.
 * `null` when the host explicitly disabled contextPrune or nothing has happened.
 */
export function compactionNotice(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): CompactionNotice | null {
	if (caps?.contextPrune === false) return null;
	const running = state.compacting;
	if (running) {
		const before = running.tokensBefore !== undefined ? `（${kTokens(running.tokensBefore)}）` : '';
		return {
			runId: running.runId,
			phase: 'running',
			text: `正在压缩上下文${before}…`,
			startedAt: running.startedAt,
			...(running.tokensBefore !== undefined ? {tokensBefore: running.tokensBefore} : {})
		};
	}
	const done = state.contextPrunes?.at(-1);
	if (!done) return null;
	return {
		runId: done.runId,
		phase: 'done',
		text: contextPruneText(done),
		reason: done.reason,
		...(done.tokensBefore !== undefined ? {tokensBefore: done.tokensBefore} : {}),
		...(done.remainingTokens !== undefined ? {remainingTokens: done.remainingTokens} : {}),
		...(done.durationMs !== undefined ? {durationMs: done.durationMs} : {})
	};
}

/** Rolling child transcript tail — `null` when the host cannot emit `child_transcript_delta`. */
export function childTranscriptText(
	state: DeltaSurfaces,
	childSessionId: string,
	caps: DshDeltaCaps | undefined
): string | null {
	if (caps?.childTranscript !== true) return null;
	const id = childSessionId.trim();
	if (!id) return null;
	const view = state.childTranscripts?.[id];
	return view?.text ?? null;
}

export type ContextUsageLevel = 'normal' | 'warning' | 'danger';

export type ContextBreakdownCategory = 'system' | 'tools' | 'summary' | 'messages';

export type ContextBreakdownItem = {
	key: ContextBreakdownCategory;
	tokens: number;
	/** Percentage of contextWindow when known, otherwise percentage of usedTokens. */
	percent: number;
};

export type ContextUsageView = {
	runId?: string;
	turnId?: string;
	/** Current context tokens occupied by prompt/window (`context_used` or `input`). */
	usedTokens: number;
	/** Model context window size in tokens (`context_window` or catalog `contextWindow`). */
	contextWindow?: number;
	/** Auto-compaction threshold budget in tokens (`context_budget`). */
	contextBudget?: number;
	/** Rounded 0..100+ usage percentage when `contextWindow` is known. */
	percent?: number;
	level: ContextUsageLevel;
	/** Input/Output/Cache billing counters from the latest turn. */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	/** Rounded 0..100 cache hit rate (`cache_read / input`). */
	cacheHitPercent?: number;
	/** Context composition segments (system+memory, tools, summary, messages). */
	breakdown: ContextBreakdownItem[];
	/** Raw metadata (model, provider, cost). */
	raw?: Record<string, string>;
};

export type ContextUsageOptions = {
	/** Fallback contextWindow from the active ModelCatalogEntry. */
	modelContextWindow?: number;
	/** DSH delta capability bits; only explicit `usage === false` suppresses the meter. */
	caps?: DshDeltaCaps;
};

/** Format token count as compact human string (`850`, `1.2k`, `128k`, `1.0M`). */
export function formatCompactTokens(n: number): string {
	const v = Math.max(0, Math.round(n));
	if (v >= 1_000_000) {
		return `${(v / 1_000_000).toFixed(1)}M`;
	}
	if (v >= 10_000) {
		const k = v / 1000;
		const rounded1 = Math.round(k * 10) / 10;
		return Number.isInteger(rounded1) || v >= 100_000
			? `${Math.round(k)}k`
			: `${rounded1.toFixed(1)}k`;
	}
	if (v >= 1_000) {
		const k = Math.round((v / 1000) * 10) / 10;
		return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
	}
	return `${v}`;
}

/**
 * Compute unified context window & token usage view for both Fast and DSH engines.
 * Unlike `usageFooter`, this is permissive when `caps` is undefined (Fast engine)
 * and falls back to `modelContextWindow` from the model catalog.
 */
export function contextUsage(
	state: DeltaSurfaces,
	options?: ContextUsageOptions
): ContextUsageView | null {
	if (options?.caps?.usage === false) return null;
	const usage = state.usage;
	const fallbackWindow =
		typeof options?.modelContextWindow === 'number' && options.modelContextWindow > 0
			? options.modelContextWindow
			: undefined;

	if (!usage) {
		if (!fallbackWindow) return null;
		return {
			usedTokens: 0,
			contextWindow: fallbackWindow,
			percent: 0,
			level: 'normal',
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			breakdown: []
		};
	}

	const b = usage.buckets;
	const inputTokens = Math.max(0, b.input ?? 0);
	const outputTokens = Math.max(0, b.output ?? 0);
	const cacheReadTokens = Math.max(0, b.cache_read ?? 0);
	const cacheWriteTokens = Math.max(0, b.cache_write ?? 0);
	const totalTokens = Math.max(0, b.total ?? inputTokens + outputTokens);

	const usedTokens = Math.max(0, b.context_used ?? inputTokens);
	const rawWindow = b.context_window ?? fallbackWindow;
	const contextWindow = typeof rawWindow === 'number' && rawWindow > 0 ? rawWindow : undefined;
	const rawBudget = b.context_budget;
	const contextBudget = typeof rawBudget === 'number' && rawBudget > 0 ? rawBudget : undefined;

	const percent =
		contextWindow !== undefined && contextWindow > 0
			? Math.min(100, Math.max(0, Math.round((usedTokens / contextWindow) * 100)))
			: undefined;

	const level: ContextUsageLevel =
		percent === undefined
			? 'normal'
			: percent >= 85
				? 'danger'
				: percent >= 65
					? 'warning'
					: 'normal';

	const cacheHitPercent =
		inputTokens > 0 && cacheReadTokens > 0
			? Math.min(100, Math.round((cacheReadTokens / inputTokens) * 100))
			: undefined;

	const sysTokens = Math.max(0, (b.ctx_system ?? 0) + (b.ctx_memory ?? 0));
	const toolsTokens = Math.max(0, b.ctx_tools ?? 0);
	const summaryTokens = Math.max(0, b.ctx_summary ?? 0);
	const messagesTokens = Math.max(0, b.ctx_messages ?? 0);
	const breakdownSum = sysTokens + toolsTokens + summaryTokens + messagesTokens;
	const denominator = contextWindow ?? (breakdownSum > 0 ? breakdownSum : usedTokens || 1);

	const breakdown: ContextBreakdownItem[] = [];
	if (breakdownSum > 0) {
		const rawItems: Array<[ContextBreakdownCategory, number]> = [
			['system', sysTokens],
			['tools', toolsTokens],
			['summary', summaryTokens],
			['messages', messagesTokens]
		];
		for (const [key, tokens] of rawItems) {
			if (tokens > 0) {
				breakdown.push({
					key,
					tokens,
					percent: Math.min(100, Math.max(0, Math.round((tokens / denominator) * 1000) / 10))
				});
			}
		}
	}

	return {
		runId: usage.runId,
		...(usage.turnId ? {turnId: usage.turnId} : {}),
		usedTokens,
		...(contextWindow !== undefined ? {contextWindow} : {}),
		...(contextBudget !== undefined ? {contextBudget} : {}),
		...(percent !== undefined ? {percent} : {}),
		level,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
		...(cacheHitPercent !== undefined ? {cacheHitPercent} : {}),
		breakdown,
		...(usage.raw ? {raw: usage.raw} : {})
	};
}

