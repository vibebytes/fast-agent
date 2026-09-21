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

/** Latest context-prune notice — `null` when the host cannot emit `context_pruned`. */
export function contextPruneNotice(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): (ContextPruneView & {text: string}) | null {
	if (caps?.contextPrune !== true) return null;
	const notice = state.contextPrunes?.at(-1);
	if (!notice) return null;
	return {...notice, text: contextPruneText(notice)};
}

/**
 * Compaction as a progress state: the in-flight `context_compacting` wins over the latest
 * result, so a banner shows "compacting…" while the run is blocked and the outcome after.
 * `null` when the host cannot emit the compaction river or nothing has happened.
 */
export function compactionNotice(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): CompactionNotice | null {
	if (caps?.contextPrune !== true) return null;
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
