import type {TranscriptEntry, TranscriptState} from './transcriptProjection.js';
import type {PlanView} from './plan.js';
import {
	projectEntryToTimelineItems,
	toTimelineItems,
	type TimelineItem,
	type TimelineOptions,
	type TimelineSource
} from './timeline.js';

function entryFingerprint(
	entry: TranscriptEntry,
	planViews: Map<string, PlanView>
): string {
	const externalPlan =
		entry.role === 'user' && entry.planId ? planViews.get(entry.planId) : undefined;
	// Slow path only (IPC clones / settled entry replacement): encode content,
	// not lengths. Length-only keys served stale same-size tool output, Plan
	// metadata, and card fields while appearing to hit the cache.
	return JSON.stringify([entry, externalPlan]);
}

/**
 * External-dependency key for the diff-sensitive part of an entry's projection.
 * Only computed on the slow path (the `fileDiffs` object changed identity);
 * the fast path relies on `fileDiffs` reference equality instead (刀 5a).
 */
function diffFpOf(
	entry: TranscriptEntry,
	fileDiffs: Record<string, string | undefined>
): string {
	const tools = entry.tools;
	if (!tools || tools.length === 0) return '';
	return JSON.stringify(
		tools.map(t => {
			const path = t.args?.path ?? '';
			return fileDiffs[t.id] ?? fileDiffs[path] ?? '';
		})
	);
}

/** Per-entry plan extraction memo — projection immutability makes entry refs stable. */
const entryPlans = new WeakMap<TranscriptEntry, PlanView[]>();

function plansOf(entry: TranscriptEntry): PlanView[] {
	const hit = entryPlans.get(entry);
	if (hit) return hit;
	const plans: PlanView[] = [];
	if (entry.role === 'assistant') {
		for (const seg of entry.segments ?? []) {
			if (seg.kind === 'plan') plans.push(seg.plan);
		}
	}
	entryPlans.set(entry, plans);
	return plans;
}

/** Reference-memoized `plansById` — avoids re-scanning every segment per frame. */
function plansByIdCached(entries: TranscriptEntry[]): Map<string, PlanView> {
	const map = new Map<string, PlanView>();
	for (const entry of entries) {
		for (const plan of plansOf(entry)) map.set(plan.planId, plan);
	}
	return map;
}

function approvalsFingerprint(
	state: Pick<TranscriptState, 'approvals' | 'questions'> &
		Pick<TimelineSource, 'questionBatches' | 'subagents'>
): string {
	return JSON.stringify([state.approvals, state.questions, state.questionBatches, state.subagents]);
}

type EntryCacheRecord = {
	/** Reference fast path: same object + same external refs → no string work at all. */
	entryRef: TranscriptEntry;
	/**
	 * Referenced PlanView at projection time (刀 5a: reference compare replaces the
	 * old per-frame todos-string fingerprint). Plan updates arrive via segment
	 * changes on some entry → that entry ref changes → `plansOf` yields a new
	 * PlanView object → this comparison catches it.
	 */
	planViewRef: PlanView | undefined;
	/** Diff key, maintained lazily — only consulted when `fileDiffs` identity changed. */
	diffFp: string;
	/** Content fingerprint fallback for reference-unstable histories (IPC clones). */
	fingerprint: string;
	items: TimelineItem[];
};

/**
 * Cache per-turn timeline projection so streaming the latest entry does not
 * rebuild historical turn items (conversation-perf H / perf doc P0-2 / 刀 5a).
 *
 * Frozen-head discipline: for an unchanged head entry the per-frame cost is
 * three pointer comparisons — entry ref, referenced PlanView ref, and the
 * `fileDiffs` container ref (callers must only swap that object when its
 * contents changed; `createSessionViewProjector` guarantees this by caching it
 * per `codeChanges` reference). No fingerprint strings are built on this path.
 * Streaming entries skip the full-text fingerprint too: their content changes
 * every frame, so they re-project directly (they are the live tail).
 */
export function createTimelineProjectionCache() {
	const entryCache = new Map<string, EntryCacheRecord>();
	let lastApprovalFp = '';
	let lastApprovalItems: TimelineItem[] = [];
	let lastApprovalsRef: TranscriptState['approvals'] | null = null;
	let lastQuestionsRef: TranscriptState['questions'] | null = null;
	let lastBatchesRef: TranscriptState['questionBatches'] | null = null;
	let lastSubagentsRef: TranscriptState['subagents'] | null = null;
	let lastFileDiffs: Record<string, string | undefined> | null = null;
	let lastRerunMarkers: Record<string, string> | undefined;
	let lastRerunFailed: Record<string, true> | undefined;
	let lastHiddenRuns: ReadonlySet<string> | undefined;

	return function projectCached(
		state: TimelineSource,
		options: TimelineOptions = {}
	): TimelineItem[] {
		const fileDiffs = options.fileDiffs ?? {};
		const fileDiffsUnchanged = fileDiffs === lastFileDiffs;
		lastFileDiffs = fileDiffs;
		if (options.rerunMarkers !== lastRerunMarkers) {
			lastRerunMarkers = options.rerunMarkers;
			entryCache.clear();
		}
		if (options.hiddenRuns !== lastHiddenRuns) {
			lastHiddenRuns = options.hiddenRuns;
			entryCache.clear();
		}
		const markers = options.rerunMarkers ?? {};
		const items: TimelineItem[] = [];
		const seen = new Set<string>();
		let prevUser: TranscriptEntry | undefined;
		const entries = Array.isArray(state.entries) ? state.entries : [];
		const planViews = plansByIdCached(entries);

		for (const entry of entries) {
			seen.add(entry.id);
			// Mirrors toTimelineItems: D4 keeps a superseded FAILED run's error card
			// visible; regenerate hides only the victim's answer rows.
			if (
				entry.role !== 'user' &&
				entry.turnId &&
				markers[entry.turnId] &&
				entry.status !== 'error'
			)
				continue;
			if (
				entry.role !== 'user' &&
				entry.turnId &&
				entry.status !== 'error' &&
				options.hiddenRuns?.has(entry.turnId)
			)
				continue;
			const planViewRef =
				entry.role === 'user' && entry.planId ? planViews.get(entry.planId) : undefined;
			const cached = entryCache.get(entry.id);

			if (cached && cached.entryRef === entry && cached.planViewRef === planViewRef) {
				// Reference fast path: diff key only re-checked when the diffs
				// container itself changed identity.
				if (fileDiffsUnchanged || diffFpOf(entry, fileDiffs) === cached.diffFp) {
					items.push(...cached.items);
					if (entry.role === 'user') {
						prevUser = entry;
					}
					continue;
				}
			}

			// Slow path. Streaming entries change every frame — re-project without
			// building the full-text fingerprint (it would always miss).
			const fp =
				entry.status === 'streaming' ? '' : entryFingerprint(entry, planViews);
			const diffFp = diffFpOf(entry, fileDiffs);
			if (
				fp !== '' &&
				cached &&
				cached.fingerprint === fp &&
				cached.diffFp === diffFp
			) {
				// Same content under a new object (e.g. IPC clone) — refresh refs.
				cached.entryRef = entry;
				cached.planViewRef = planViewRef;
				items.push(...cached.items);
			} else {
				const projected = projectEntryToTimelineItems(entry, prevUser, {
					...options,
					planViews
				});
				entryCache.set(entry.id, {
					entryRef: entry,
					planViewRef,
					diffFp,
					fingerprint: fp,
					items: projected
				});
				items.push(...projected);
			}
			if (entry.role === 'user') {
				prevUser = entry;
			}
		}

		for (const id of [...entryCache.keys()]) {
			if (!seen.has(id)) entryCache.delete(id);
		}

		if (
			state.approvals !== lastApprovalsRef ||
			state.questions !== lastQuestionsRef ||
			state.questionBatches !== lastBatchesRef ||
			state.subagents !== lastSubagentsRef
		) {
			lastApprovalsRef = state.approvals;
			lastQuestionsRef = state.questions;
			lastBatchesRef = state.questionBatches ?? null;
			lastSubagentsRef = state.subagents ?? null;
			const approvalFp = approvalsFingerprint(state);
			if (approvalFp !== lastApprovalFp) {
				lastApprovalFp = approvalFp;
				lastApprovalItems = toTimelineItems(
					{
						entries: [],
						approvals: state.approvals ?? [],
						questions: state.questions ?? [],
						questionBatches: state.questionBatches ?? [],
						subagents: state.subagents ?? []
					},
					options
				);
			}
		}
		items.push(...lastApprovalItems);
		return items;
	};
}

export type TimelineProjectionCache = ReturnType<typeof createTimelineProjectionCache>;
