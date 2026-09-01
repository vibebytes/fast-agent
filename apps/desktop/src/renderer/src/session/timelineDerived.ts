import type {ReviewFile, TimelineItem} from '@fast-ide/session-view';

/**
 * PlanIds with an in-flight PlanBuild turn (perf doc P0-4).
 * Extracted from SessionPane so the Set identity can stay stable across
 * streaming frames — a fresh Set per frame defeated TimelineRow's memo
 * comparator and re-rendered every row on every delta.
 */
export function activePlanBuildIds(items: readonly TimelineItem[]): Set<string> {
	const ids = new Set<string>();
	for (const i of items) {
		if (i.kind === 'user' && i.planBuild?.planId && i.showStop) {
			ids.add(i.planBuild.planId);
		}
	}
	return ids;
}

export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const id of a) if (!b.has(id)) return false;
	return true;
}

/** Reuse `prev` when contents match so memo'd consumers keep reference equality. */
export function stablePlanBuildIds(
	items: readonly TimelineItem[],
	prev: Set<string> | null
): Set<string> {
	const next = activePlanBuildIds(items);
	return prev && sameIdSet(prev, next) ? prev : next;
}

/** Keep DialogueComposer's stack prop stable across text-only transcript frames. */
export function stableReviewFiles(next: ReviewFile[], prev: ReviewFile[]): ReviewFile[] {
	if (next.length !== prev.length) return next;
	const same = next.every(
		(file, i) =>
			file.id === prev[i]?.id &&
			file.path === prev[i]?.path &&
			file.add === prev[i]?.add &&
			file.del === prev[i]?.del &&
			file.status === prev[i]?.status
	);
	return same ? prev : next;
}

export type DeferredTaskValue<T> = {taskId: string | null; value: T};

/**
 * Defer high-frequency frames only within one Task. React may return the old
 * deferred value during a focus switch; pairing it with Task identity prevents
 * a one-frame cross-Task Transcript leak.
 */
export function deferredValueForTask<T>(
	activeTaskId: string | null,
	current: T,
	deferred: DeferredTaskValue<T>
): T {
	return deferred.taskId === activeTaskId ? deferred.value : current;
}

function itemFingerprint(item: TimelineItem): string {
	switch (item.kind) {
		case 'assistant':
			return `a:${item.id}:${item.text.length}:${item.status}`;
		case 'tool':
			return `t:${item.id}:${item.status}:${item.output?.length ?? 0}`;
		case 'thought':
			return `th:${item.id}:${item.text.length}`;
		case 'processStack':
			return `ps:${item.id}:${item.stepCount}:${item.open ? 1 : 0}:${item.cancelled ? 1 : 0}`;
		case 'file':
			return `f:${item.id}:${item.status}:${item.lines.length}`;
		default:
			return `${item.kind}:${item.id}`;
	}
}

/** Trailing rows that can still receive streamed content in one frame. */
const SCROLL_KEY_TAIL = 4;

/**
 * Follow-bottom hint key (perf doc P0-4): length + tail fingerprints only.
 * The old key fingerprinted every row — O(n) string build per frame. Streamed
 * growth lands in the tail; mid-list height changes (collapse toggles, images)
 * are covered by VirtualTranscript's ResizeObserver, not this key.
 */
export function transcriptScrollKey(items: readonly TimelineItem[]): string {
	let key = `${items.length}`;
	const from = Math.max(0, items.length - SCROLL_KEY_TAIL);
	for (let i = from; i < items.length; i++) {
		key += `|${itemFingerprint(items[i]!)}`;
	}
	return key;
}
