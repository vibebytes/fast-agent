import type {TimelineItem} from '../timeline.js';
import type {TranscriptEntry} from '../transcript/state.js';

export const FOREIGN_ORIGIN = 'cluster_agent';

export function foreignFromKey(
	fromAgentId?: string,
	displayName?: string
): string {
	return fromAgentId?.trim() || displayName?.trim() || 'foreign';
}

export function wrapForeignFolds(items: TimelineItem[]): TimelineItem[] {
	const out: TimelineItem[] = [];
	let i = 0;
	while (i < items.length) {
		const item = items[i]!;
		if (item.kind === 'user' && item.origin === FOREIGN_ORIGIN) {
			const key = foreignFromKey(item.fromAgentId, item.displayName);
			const group: TimelineItem[] = [];
			while (i < items.length) {
				const cur = items[i]!;
				if (cur.kind === 'user') {
					if (cur.origin === FOREIGN_ORIGIN && foreignFromKey(cur.fromAgentId, cur.displayName) === key) {
						group.push(cur);
						i += 1;
						continue;
					}
					break;
				}
				group.push(cur);
				i += 1;
			}
			const displayName = item.displayName?.trim() || item.fromAgentId?.trim() || 'peer';
			out.push({
				kind: 'foreignFold',
				id: `fold-${item.id}`,
				displayName,
				...(item.fromAgentId ? {fromAgentId: item.fromAgentId} : {}),
				preview: foreignPreview(group),
				items: group
			});
		} else {
			out.push(item);
			i += 1;
		}
	}
	return out;
}

export type ForeignEntryFold = {
	kind: 'foreignFold';
	id: string;
	displayName: string;
	fromAgentId?: string;
	preview: string;
	entries: TranscriptEntry[];
};

export type ChatListRow = TranscriptEntry | ForeignEntryFold;

export function foldForeignEntries(entries: readonly TranscriptEntry[]): ChatListRow[] {
	const out: ChatListRow[] = [];
	let i = 0;
	while (i < entries.length) {
		const entry = entries[i]!;
		if (entry.role === 'user' && entry.origin === FOREIGN_ORIGIN) {
			const key = foreignFromKey(entry.fromAgentId, entry.displayName);
			const group: TranscriptEntry[] = [];
			while (i < entries.length) {
				const cur = entries[i]!;
				if (cur.role === 'user') {
					if (cur.origin === FOREIGN_ORIGIN && foreignFromKey(cur.fromAgentId, cur.displayName) === key) {
						group.push(cur);
						i += 1;
						continue;
					}
					break;
				}
				group.push(cur);
				i += 1;
			}
			out.push({
				kind: 'foreignFold',
				id: `fold-${entry.id}`,
				displayName: entry.displayName?.trim() || entry.fromAgentId?.trim() || 'peer',
				...(entry.fromAgentId ? {fromAgentId: entry.fromAgentId} : {}),
				preview: group
					.filter(e => (e.text ?? '').trim())
					.map(e => e.text.trim())
					.slice(-3)
					.join('\n'),
				entries: group
			});
		} else {
			out.push(entry);
			i += 1;
		}
	}
	return out;
}

export function flattenTimelineItems(items: readonly TimelineItem[]): TimelineItem[] {
	return items.flatMap(it => (it.kind === 'foreignFold' ? it.items : [it]));
}

export function isForeignFoldItem(
	item: TimelineItem
): item is Extract<TimelineItem, {kind: 'foreignFold'}> {
	return item.kind === 'foreignFold';
}

export function isForeignFoldRow(row: ChatListRow): row is ForeignEntryFold {
	return 'kind' in row && row.kind === 'foreignFold';
}

/** Owner river vs foreign-fold cards for the main-session split columns. */
export function splitForeignColumns(items: readonly TimelineItem[]): {
	owner: TimelineItem[];
	foreign: Extract<TimelineItem, {kind: 'foreignFold'}>[];
} {
	const owner: TimelineItem[] = [];
	const foreign: Extract<TimelineItem, {kind: 'foreignFold'}>[] = [];
	for (const item of items) {
		if (item.kind === 'foreignFold') foreign.push(item);
		else owner.push(item);
	}
	return {owner, foreign};
}

export function splitForeignEntryColumns(rows: readonly ChatListRow[]): {
	owner: TranscriptEntry[];
	foreign: ForeignEntryFold[];
} {
	const owner: TranscriptEntry[] = [];
	const foreign: ForeignEntryFold[] = [];
	for (const row of rows) {
		if (isForeignFoldRow(row)) foreign.push(row);
		else owner.push(row);
	}
	return {owner, foreign};
}

function foreignPreview(group: TimelineItem[]): string {
	const lines: string[] = [];
	for (const it of group) {
		if (it.kind === 'user' && it.text.trim()) lines.push(it.text.trim());
		if (it.kind === 'assistant' && it.text.trim()) lines.push(it.text.trim());
	}
	return lines.slice(-3).join('\n');
}
