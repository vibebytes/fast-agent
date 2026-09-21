import {classifyToolActivity, formatActivitySummary, type ActivityCounts} from '../diff.js';
import type {ProcessStackStep, TimelineItem} from '../timeline.js';

export const PROCESS_STACK_MIN_STEPS = 2;

export function isSealedProcessStep(item: TimelineItem): item is ProcessStackStep {
	if (item.kind === 'thought' || item.kind === 'exploring') return !item.open;
	if (item.kind === 'tool') {
		// Successful/completed tools stack into process steps; running/failed/error tools stay visible
		return item.status === 'success';
	}
	return false;
}

export function mergeAdjacentExploring(items: TimelineItem[]): TimelineItem[] {
	const result: TimelineItem[] = [];
	for (const item of items) {
		if (item.kind !== 'exploring') {
			result.push(item);
			continue;
		}
		const prev = result[result.length - 1];
		if (prev && prev.kind === 'exploring') {
			const combinedTools = [...prev.tools, ...item.tools];
			const counts: ActivityCounts = {explored: 0, searched: 0, fetched: 0, edited: 0};
			for (const t of combinedTools) {
				const kind = classifyToolActivity(t.tool);
				if (kind !== 'other') counts[kind] += 1;
			}
			const summary = formatActivitySummary(counts) || `Explored ${combinedTools.length}`;
			result[result.length - 1] = {
				kind: 'exploring',
				id: prev.id,
				summary,
				toolIds: [...prev.toolIds, ...item.toolIds],
				tools: combinedTools,
				open: prev.open || item.open
			};
		} else {
			result.push(item);
		}
	}
	return result;
}

/**
 * While the turn is still streaming, keep shimmer on the latest activity tip —
 * even after its tools have finished (e.g. "Explored 1 file, 2 searches").
 * Earlier process stacks collapse so only the tip signals live work.
 */
export function pinLiveActivityTip(items: TimelineItem[], turnActive: boolean): TimelineItem[] {
	if (!turnActive || items.length === 0) return items;

	let tip = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (
			item.kind === 'exploring' ||
			item.kind === 'thought' ||
			item.kind === 'processStack'
		) {
			tip = i;
			break;
		}
		if (
			(item.kind === 'tool' || item.kind === 'file') &&
			item.status === 'running'
		) {
			tip = i;
			break;
		}
		// Skip prose / chrome; keep scanning for the latest process tip.
		if (
			item.kind === 'assistant' ||
			item.kind === 'user' ||
			item.kind === 'system' ||
			item.kind === 'activity' ||
			item.kind === 'approval' ||
			item.kind === 'question' ||
			item.kind === 'plan' ||
			item.kind === 'tool' ||
			item.kind === 'file'
		) {
			continue;
		}
	}
	if (tip < 0) return items;

	return items.map((item, i) => {
		if (i === tip) {
			if (
				(item.kind === 'exploring' ||
					item.kind === 'thought' ||
					item.kind === 'processStack') &&
				!item.open
			) {
				return {...item, open: true};
			}
			return item;
		}
		// Only the tip should shimmer / default-expand while the turn is live.
		if (item.kind === 'processStack' && item.open) {
			return {...item, open: false};
		}
		return item;
	});
}
export function wrapProcessStacks(
	items: TimelineItem[],
	options: {turnActive: boolean; entryId: string}
): TimelineItem[] {
	const merged = mergeAdjacentExploring(items);
	const out: TimelineItem[] = [];
	let buf: ProcessStackStep[] = [];
	let stackIndex = 0;

	const flush = () => {
		if (buf.length >= PROCESS_STACK_MIN_STEPS) {
			out.push({
				kind: 'processStack',
				id: `${options.entryId}-process-${stackIndex}`,
				steps: buf,
				stepCount: buf.length,
				open: options.turnActive
			});
			stackIndex += 1;
		} else {
			out.push(...buf);
		}
		buf = [];
	};

	for (const item of merged) {
		if (isSealedProcessStep(item)) {
			buf.push(item);
			continue;
		}
		flush();
		out.push(item);
	}
	flush();
	return absorbCancelledMarkers(pinLiveActivityTip(out, options.turnActive));
}

/**
 * Fold standalone `Cancelled` system rows into the preceding process stack tip
 * (same turn — stop at user). Always drop the system row so the dialog never
 * shows a lone Cancelled line.
 */
export function absorbCancelledMarkers(items: TimelineItem[]): TimelineItem[] {
	const out: TimelineItem[] = [];
	for (const item of items) {
		if (item.kind === 'system' && item.tone === 'cancelled') {
			for (let i = out.length - 1; i >= 0; i--) {
				const prev = out[i]!;
				if (prev.kind === 'processStack') {
					out[i] = {...prev, cancelled: true};
					break;
				}
				if (prev.kind === 'user') break;
			}
			continue;
		}
		out.push(item);
	}
	return out;
}
