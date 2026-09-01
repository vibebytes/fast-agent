import type {OpenTab, StripItem} from './openSet';

/** Tailwind `gap-0.5` between strip chips. */
export const STRIP_ITEM_GAP_PX = 2;

/** Reserved width for the compact overflow trigger when any item is hidden. */
export const OVERFLOW_BTN_PX = 28;

export function stripItemKey(item: StripItem): string {
	return item.type === 'tab' ? `tab:${item.tab.id}` : `group:${item.groupKey}`;
}

export function stripItemContainsTab(item: StripItem, tabId: string | null): boolean {
	if (!tabId) return false;
	if (item.type === 'tab') return item.tab.id === tabId;
	return item.members.some(m => m.id === tabId);
}

export function flattenStripTabs(items: StripItem[]): OpenTab[] {
	const out: OpenTab[] = [];
	for (const item of items) {
		if (item.type === 'tab') out.push(item.tab);
		else out.push(...item.members);
	}
	return out;
}

function packFromLeft(widths: number[], avail: number, gapPx: number): Set<number> {
	const vis = new Set<number>();
	let used = 0;
	for (let i = 0; i < widths.length; i++) {
		const w = (widths[i] ?? 0) + (vis.size > 0 ? gapPx : 0);
		if (used + w > avail) break;
		used += w;
		vis.add(i);
	}
	return vis;
}

/** Prefer a window that includes `must`, filling left then right. */
function packIncluding(widths: number[], avail: number, gapPx: number, must: number): Set<number> {
	const vis = new Set<number>([must]);
	let used = widths[must] ?? 0;
	for (let i = must - 1; i >= 0; i--) {
		const w = (widths[i] ?? 0) + gapPx;
		if (used + w > avail) break;
		used += w;
		vis.add(i);
	}
	for (let i = must + 1; i < widths.length; i++) {
		const w = (widths[i] ?? 0) + gapPx;
		if (used + w > avail) break;
		used += w;
		vis.add(i);
	}
	return vis;
}

/**
 * Decide which strip items stay on the bar vs overflow menu.
 * Active item (containing the focused Open Tab) always stays visible when possible.
 */
export function partitionStripOverflow(options: {
	widths: number[];
	containerWidth: number;
	activeIndex: number;
	gapPx?: number;
	overflowBtnPx?: number;
}): {visibleIndexes: number[]; overflowIndexes: number[]} {
	const {widths, containerWidth, activeIndex} = options;
	const n = widths.length;
	if (n === 0) return {visibleIndexes: [], overflowIndexes: []};

	const gapPx = options.gapPx ?? STRIP_ITEM_GAP_PX;
	const overflowBtnPx = options.overflowBtnPx ?? OVERFLOW_BTN_PX;

	let total = 0;
	for (let i = 0; i < n; i++) {
		total += widths[i] ?? 0;
		if (i > 0) total += gapPx;
	}
	if (total <= containerWidth) {
		return {
			visibleIndexes: Array.from({length: n}, (_, i) => i),
			overflowIndexes: []
		};
	}

	const avail = Math.max(0, containerWidth - overflowBtnPx);
	const fromLeft = packFromLeft(widths, avail, gapPx);
	const vis =
		activeIndex >= 0 && !fromLeft.has(activeIndex)
			? packIncluding(widths, avail, gapPx, activeIndex)
			: fromLeft;

	const visibleIndexes = [...vis].sort((a, b) => a - b);
	const overflowIndexes = Array.from({length: n}, (_, i) => i).filter(i => !vis.has(i));
	return {visibleIndexes, overflowIndexes};
}
