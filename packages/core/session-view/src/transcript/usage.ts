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
export type DeltaSurfaces = Pick<TranscriptState, 'usage' | 'contextPrunes' | 'childTranscripts'>;

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

/** Latest context-prune notice — `null` when the host cannot emit `context_pruned`. */
export function contextPruneNotice(
	state: DeltaSurfaces,
	caps: DshDeltaCaps | undefined
): ContextPruneView | null {
	if (caps?.contextPrune !== true) return null;
	const notices = state.contextPrunes;
	return notices?.length ? (notices.at(-1) as ContextPruneView) : null;
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
