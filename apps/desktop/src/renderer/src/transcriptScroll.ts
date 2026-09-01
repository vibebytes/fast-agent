import type {TimelineItem} from '@fast-ide/session-view';
import {liveTickerOuterHeightPx} from './session/tickerTail';
import {shouldThresholdFoldFile, shouldThresholdFoldTool} from './thresholdFold';

/** Near-bottom threshold for Transcript follow scroll (px). */
export const NEAR_BOTTOM_PX = 80;

/** Near-top threshold for older-history fetch (px). */
export const NEAR_TOP_PX = 120;

/**
 * Absolute virtualization stays off until measure/sticky interaction is proven safe.
 * Variable-height MD + absolute rows caused overlap; sticky user prompts ghost-duplicated;
 * high estimates left huge empty gaps between tool cards.
 * Pass an explicit lower cap to `transcriptFlowSplitAt` only in tests / future re-enable.
 */
export const FLOW_ONLY_MAX = Number.MAX_SAFE_INTEGER;

/** Newest rows always stay in document flow so images/stream markdown cannot overlap. */
export const FLOW_TAIL = 16;

/** Default estimate when kind is unknown. */
export const DEFAULT_ROW_ESTIMATE_PX = 120;


export function remainingScrollPx(
	scrollHeight: number,
	scrollTop: number,
	clientHeight: number
): number {
	return scrollHeight - scrollTop - clientHeight;
}

export function isNearBottom(remainingPx: number, thresholdPx = NEAR_BOTTOM_PX): boolean {
	return remainingPx < thresholdPx;
}

export function isNearTop(scrollTop: number, thresholdPx = NEAR_TOP_PX): boolean {
	return scrollTop < thresholdPx;
}

/** While pinning after Jump/follow, ignore intermediate scroll positions. */
export function shouldIgnoreScrollProximity(pinUntilMs: number, nowMs: number): boolean {
	return nowMs < pinUntilMs;
}

// ── Follow-bottom state machine (message-flow-performance.md 刀 4) ──────────
// Pure decisions; VirtualTranscript owns the DOM reads/writes. Modeled on
// MiMo create-auto-scroll: precise auto-scroll marks instead of pure time
// windows, wheel intent honoring nested scrollables. No settle phase: fast-ide
// keeps following until the user leaves, so there is no turn-end unstick to
// soften.

/** Browsers may deliver the scroll event late; marks stay valid this long. */
export const AUTO_MARK_MS = 1500;

/** scrollTop tolerance when matching a programmatic follow write. */
export const AUTO_MARK_TOLERANCE_PX = 2;

/** Recent nested-scrollable wheel suppresses outer unstick this long. */
export const NESTED_WHEEL_GRACE_MS = 120;

export type AutoScrollMark = {top: number; until: number};

export type ViewportMetrics = {
	scrollHeight: number;
	scrollTop: number;
	clientHeight: number;
};

/** Expected post-write scrollTop for "scrolled to absolute bottom". */
export function bottomTop(m: ViewportMetrics): number {
	return Math.max(0, m.scrollHeight - m.clientHeight);
}

export function makeAutoMark(m: ViewportMetrics, now: number): AutoScrollMark {
	return {top: bottomTop(m), until: now + AUTO_MARK_MS};
}

/**
 * Follow write decision: skip the scrollTop write (and its forced layout)
 * when the viewport is already at the bottom — the old code wrote + rAF-verified
 * unconditionally, a per-frame forced-reflow source on large DOM.
 */
export function followWritePlan(
	m: ViewportMetrics,
	now: number
): {write: boolean; mark: AutoScrollMark} {
	const remaining = remainingScrollPx(m.scrollHeight, m.scrollTop, m.clientHeight);
	return {write: remaining > 1, mark: makeAutoMark(m, now)};
}

export type PrependAnchor = {scrollHeight: number; scrollTop: number; firstKey: string};

/**
 * Consume a near-top anchor only after the prior first row moves down. Raw row
 * growth is insufficient: an ordinary append can race an older-history pull.
 * If the user jumped back to follow, consume without writing.
 */
export function prependWritePlan(
	anchor: PrependAnchor | null,
	scrollHeight: number,
	prepended: boolean,
	isFollowing: boolean
): {consume: boolean; scrollTop?: number} {
	if (!anchor || !prepended) return {consume: false};
	if (isFollowing) return {consume: true};
	const delta = scrollHeight - anchor.scrollHeight;
	return delta > 0 ? {consume: true, scrollTop: anchor.scrollTop + delta} : {consume: true};
}

/** Does this scroll event match our own follow write (programmatic, not user)? */
export function isAutoScroll(
	mark: AutoScrollMark | null,
	scrollTop: number,
	now: number
): boolean {
	if (!mark || now > mark.until) return false;
	return Math.abs(scrollTop - mark.top) <= AUTO_MARK_TOLERANCE_PX;
}

/**
 * D10 regenerate: hiding victim rows shrinks the transcript mid-stream; the
 * browser clamps scrollTop and the reading position jumps. Keep the distance
 * from the bottom edge constant across a shrink (correct when the removed
 * block sits above the viewport — the regenerate geometry). Best effort:
 * skipped while following, on growth, and on sub-pixel noise.
 */
export function shrinkWritePlan(
	before: ViewportMetrics | null,
	after: ViewportMetrics,
	isFollowing: boolean
): {write: boolean; scrollTop?: number} {
	if (!before || isFollowing) return {write: false};
	const delta = after.scrollHeight - before.scrollHeight;
	if (delta >= -2) return {write: false};
	const bottomGap = before.scrollHeight - before.scrollTop - before.clientHeight;
	const maxScroll = Math.max(0, after.scrollHeight - after.clientHeight);
	const target = Math.max(0, Math.min(after.scrollHeight - after.clientHeight - bottomGap, maxScroll));
	return Math.abs(target - after.scrollTop) > 1 ? {write: true, scrollTop: target} : {write: false};
}

export type WheelIntent = 'leave-follow' | 'nested' | 'none';

export type ScrollRegionMetrics = {
	scrollHeight: number;
	scrollTop: number;
	clientHeight: number;
};

/** A nested output only owns the wheel while it has room in that direction. */
export function nestedScrollableConsumesWheel(
	m: ScrollRegionMetrics,
	deltaY: number
): boolean {
	if (deltaY < 0) return m.scrollTop > 0.5;
	if (deltaY > 0) return m.scrollTop + m.clientHeight < m.scrollHeight - 0.5;
	return false;
}

/**
 * Wheel-up = explicit user intent to read history — unstick immediately instead
 * of waiting for the scroll event to cross the proximity threshold. A
 * `[data-scrollable]` region owns it only while that region can still scroll;
 * at its boundary the wheel belongs to the Transcript.
 */
export function wheelIntent(deltaY: number, nestedConsumes: boolean): WheelIntent {
	if (deltaY >= 0) return 'none';
	return nestedConsumes ? 'nested' : 'leave-follow';
}

/** Outer scroll shortly after a nested wheel is bubbling artifact, not user intent. */
export function isNestedWheelArtifact(lastNestedWheelAt: number, now: number): boolean {
	return now - lastNestedWheelAt <= NESTED_WHEEL_GRACE_MS;
}

/** Index where virtualized head ends; tail is always document-flow. */
export function transcriptFlowSplitAt(
	itemCount: number,
	flowOnlyMax = FLOW_ONLY_MAX,
	flowTail = FLOW_TAIL
): number {
	if (itemCount <= flowOnlyMax) return 0;
	return Math.max(0, itemCount - flowTail);
}

/**
 * Initial height guess for a virtual row (only used if absolute virtual is re-enabled).
 * Prefer median guesses; remount measureElement must correct — extreme bias causes
 * overlap (low) or empty gaps (high).
 */
export function estimateTimelineRowPx(item: {
	kind: string;
	text?: string;
	open?: boolean;
	output?: string | null;
}): number {
	switch (item.kind) {
		case 'assistant': {
			const len = item.text?.length ?? 0;
			return Math.min(480, Math.max(96, 64 + Math.ceil(len / 80) * 16));
		}
		case 'user':
			return Math.min(200, Math.max(64, 40 + Math.ceil((item.text?.length ?? 0) / 80) * 14));
		case 'thought':
			return item.open ? liveTickerOuterHeightPx() : 32;
		case 'tool':
			return item.output ? 96 : 56;
		case 'file':
			return 140;
		case 'exploring':
			return item.open ? liveTickerOuterHeightPx() : 48;
		case 'activity':
			return 48;
		case 'processStack':
			// Collapsed summary ~32px; expanded capped near 8 label rows + trigger.
			return item.open ? 220 : 32;
		case 'approval':
		case 'question':
			return 120;
		case 'system':
			return 40;
		default:
			return DEFAULT_ROW_ESTIMATE_PX;
	}
}

type FlowContentMetrics = {
	kind: string;
	text?: string;
	status?: string;
	open?: boolean;
	output?: string | null;
	tool?: string;
	command?: string | null;
	lines?: readonly unknown[];
	hidden?: number;
};

/**
 * Initial block-size placeholder for `content-visibility:auto` (刀 7).
 * This is intentionally separate from the capped absolute-virtualizer estimate:
 * a 480px cap badly under-reserves a multi-thousand-pixel assistant answer and
 * makes the scrollbar jump as skipped rows are revealed.
 */
export function flowContainIntrinsicBlockPx(item: FlowContentMetrics): number {
	switch (item.kind) {
		case 'assistant': {
			const text = item.text ?? '';
			const wrappedLines = Math.max(1, Math.ceil(text.length / 88));
			// This runs on every token frame. Scanning all accumulated text while
			// streaming makes N deltas O(N²); reserve by length until the row seals.
			const explicitLines =
				item.status === 'streaming'
					? 1
					: text.length > 0
						? text.split('\n').length
						: 1;
			return Math.max(96, 56 + Math.max(explicitLines, wrappedLines) * 20);
		}
		case 'thought':
			return item.open ? liveTickerOuterHeightPx() : 48;
		case 'exploring':
			return item.open ? liveTickerOuterHeightPx() : 48;
		case 'tool':
			if (shouldThresholdFoldTool(item)) return 48;
			return item.output ? 288 : 72;
		case 'file':
			if (shouldThresholdFoldFile(item)) return 48;
			return 180;
		case 'approval':
		case 'question':
			return 160;
		case 'processStack':
			return item.open ? 260 : 48;
		default:
			return estimateTimelineRowPx(item);
	}
}

export type FlowContentVisibilityStyle = {
	contentVisibility: 'auto';
	containIntrinsicBlockSize: string;
};

/**
 * Sticky user rows must stay outside layout containment. Keeping this decision
 * pure makes the CSS performance contract testable without a DOM test runtime.
 */
export function flowContentVisibilityStyle(
	item: FlowContentMetrics
): FlowContentVisibilityStyle | undefined {
	if (item.kind === 'user') return undefined;
	return {
		contentVisibility: 'auto',
		containIntrinsicBlockSize: `auto ${flowContainIntrinsicBlockPx(item)}px`
	};
}

/**
 * Detect absolute-row Y overlap from starts + measured/estimated sizes.
 * Used to assert the invariant that stale undersized estimates must not produce
 * stacked ranges (the visible “对话错位” failure mode).
 */
export function virtualRowRangesOverlap(starts: number[], sizes: number[]): boolean {
	if (starts.length !== sizes.length || starts.length < 2) return false;
	for (let i = 1; i < starts.length; i++) {
		const prevEnd = starts[i - 1]! + sizes[i - 1]!;
		if (starts[i]! < prevEnd - 0.5) return true;
	}
	return false;
}

/** Cumulative starts from sizes (what a correct virtualizer layout must satisfy). */
export function virtualRowStartsFromSizes(sizes: number[]): number[] {
	const starts: number[] = [];
	let y = 0;
	for (const h of sizes) {
		starts.push(y);
		y += h;
	}
	return starts;
}

/**
 * Group a user prompt with the following reply rows until the next user message.
 * Sticky user chrome needs this containing block — sticky on a short user-only row
 * unsticks as soon as that row itself leaves the viewport.
 */
export type TranscriptSection = {
	id: string;
	user: Extract<TimelineItem, {kind: 'user'}> | null;
	items: TimelineItem[];
};

export function groupTranscriptSections(items: TimelineItem[]): TranscriptSection[] {
	const sections: TranscriptSection[] = [];
	let current: TranscriptSection | null = null;

	for (const item of items) {
		if (item.kind === 'user') {
			current = {id: item.id, user: item, items: []};
			sections.push(current);
			continue;
		}
		if (!current) {
			current = {id: `lead-${item.id}`, user: null, items: []};
			sections.push(current);
		}
		current.items.push(item);
	}

	return sections;
}

export type SectionsSnapshot = {sections: TranscriptSection[]};

/**
 * Frozen-head sections (刀 5b): regroup, then swap unchanged prefix sections
 * back to their previous object identity so a memo'd section component skips
 * the whole subtree. "Unchanged" = same id, same user ref, same item refs —
 * upstream item identity is guaranteed by the projection cache, so during
 * streaming only the live turn's section gets a fresh object.
 */
export function stableTranscriptSections(
	items: TimelineItem[],
	prev: SectionsSnapshot | null
): SectionsSnapshot {
	const fresh = groupTranscriptSections(items);
	if (!prev) return {sections: fresh};
	const prevSections = prev.sections;
	const out: TranscriptSection[] = [];
	const shared = Math.min(fresh.length, prevSections.length);
	let i = 0;
	outer: for (; i < shared; i++) {
		const next = fresh[i]!;
		const old = prevSections[i]!;
		if (next.id !== old.id || next.user !== old.user) break;
		if (next.items.length !== old.items.length) break;
		for (let j = 0; j < next.items.length; j++) {
			if (next.items[j] !== old.items[j]) break outer;
		}
		out.push(old);
	}
	for (; i < fresh.length; i++) out.push(fresh[i]!);
	return {sections: out};
}
