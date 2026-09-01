/**
 * Composer @-mention palette — Bridge Mentions (MentionSuggest).
 * Selecting inserts canonical `@kind/locator` and accumulates MentionChip for Submit.
 */

import type {MentionChip} from '@fast-ide/session-view';

export type MentionSuggestItem = {
	ref: string;
	displayName: string;
	description?: string | null;
	payload: {kind: string; locator: string; entity?: string};
};

export type MentionSuggestGroup = {
	kind: string;
	tier: string;
	items: MentionSuggestItem[];
};

/** Menu row derived from Bridge mention_suggestions. */
export type AtItem = {
	ref: string;
	label: string;
	description: string;
	kind: string;
	locator: string;
	entity?: string;
};

/** In-progress @ token span: `@` or `@partial` at start or after whitespace. */
export type AtQuerySpan = {
	query: string;
	start: number;
	end: number;
};

/**
 * Detect in-progress @ query at caret (defaults to end of draft).
 * Supports mid-sentence: `please @sk` → query `sk`.
 */
export function atQuerySpan(draft: string, caret = draft.length): AtQuerySpan | null {
	const end = Math.max(0, Math.min(caret, draft.length));
	const before = draft.slice(0, end);
	const m = /(?:^|[\s])@([^\s@]*)$/.exec(before);
	if (!m) return null;
	const atIdx = before.lastIndexOf('@');
	if (atIdx < 0) return null;
	return {query: m[1] ?? '', start: atIdx, end};
}

/** Detect in-progress @ query text (null when menu should stay closed). */
export function atQuery(draft: string, caret = draft.length): string | null {
	return atQuerySpan(draft, caret)?.query ?? null;
}

/** Prefix for Bridge MentionSuggest — includes leading `@`. */
export function atSuggestPrefix(draft: string, caret = draft.length): string | null {
	const span = atQuerySpan(draft, caret);
	if (!span) return null;
	return draft.slice(span.start, span.end);
}

export function groupsToAtItems(groups: MentionSuggestGroup[]): AtItem[] {
	return groups.flatMap(g =>
		g.items.map(item => ({
			ref: item.ref,
			label: item.displayName,
			description: item.description ?? item.ref,
			kind: item.payload.kind,
			locator: item.payload.locator,
			...(item.payload.entity ? {entity: item.payload.entity} : {})
		}))
	);
}

/** Group AtItems by kind for CommandGroup headings. */
export function groupAtItems(items: AtItem[]): Array<{kind: string; items: AtItem[]}> {
	const order: string[] = [];
	const map = new Map<string, AtItem[]>();
	for (const item of items) {
		const k = item.kind || 'other';
		if (!map.has(k)) {
			order.push(k);
			map.set(k, []);
		}
		map.get(k)!.push(item);
	}
	return order.map(kind => ({kind, items: map.get(kind)!}));
}

export function kindTitle(kind: string): string {
	if (!kind) return 'Mentions';
	return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function chipFromAtItem(item: AtItem): MentionChip {
	return {
		kind: item.kind,
		locator: item.locator,
		displayName: item.label,
		ref: item.ref,
		...(item.entity ? {entity: item.entity} : {})
	};
}

/** Canonical insert text: `@kind/locator` (+ trailing space). */
export function formatAtPayload(item: AtItem): string {
	return item.ref || `@${item.kind}/${item.locator}`;
}

/** Replace the active `@partial` token with canonical ref (+ trailing space). */
export function applyAtPick(draft: string, item: AtItem, caret = draft.length): string {
	const span = atQuerySpan(draft, caret);
	const payload = `${formatAtPayload(item)} `;
	if (!span) return `${draft}${payload}`;
	return `${draft.slice(0, span.start)}${payload}${draft.slice(span.end)}`;
}

/**
 * Slash-chip style: drop the active `@partial` from the textarea.
 * The pick becomes a real chip; refs are recomposed on Submit.
 */
export function clearAtToken(draft: string, caret = draft.length): string {
	const span = atQuerySpan(draft, caret);
	if (!span) return draft;
	return `${draft.slice(0, span.start)}${draft.slice(span.end)}`;
}

/** Rebuild Submit text: chip refs + free-text body (slash chip ↔ formatSlashSubmit). */
export function composeMentionSubmit(draft: string, chips: MentionChip[]): string {
	const body = draft.trim();
	const refs = chips.map(c => c.ref || `@${c.kind}/${c.locator}`);
	if (refs.length === 0) return body;
	if (!body) return refs.join(' ');
	return `${refs.join(' ')} ${body}`;
}

export function exactAtMatch(query: string, items: AtItem[]): AtItem | undefined {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	return items.find(
		i =>
			i.locator.toLowerCase() === q ||
			i.label.toLowerCase() === q ||
			i.ref.toLowerCase() === q ||
			i.ref.toLowerCase() === `@${q}` ||
			i.ref.toLowerCase().endsWith(`/${q}`)
	);
}

/** Merge chip by ref (latest wins). */
export function mergeChip(chips: MentionChip[], chip: MentionChip): MentionChip[] {
	const key = chip.ref ?? `${chip.kind}/${chip.locator}`;
	return [...chips.filter(c => (c.ref ?? `${c.kind}/${c.locator}`) !== key), chip];
}

/** Canonical `@kind/locator` (locator may contain `/`, e.g. team/member). */
const MENTION_REF_RE = /@[a-z][a-z0-9_-]*\/[^\s@]+/gi;

export type MentionDraftSegment =
	| {type: 'text'; text: string}
	| {type: 'mention'; text: string; ref: string};

/**
 * Split draft for display-only tag chrome. Segment text equals source substrings
 * (same glyphs / width as the textarea) so caret alignment stays correct.
 */
export function mentionDraftSegments(draft: string): MentionDraftSegment[] {
	if (!draft) return [{type: 'text', text: ''}];
	const out: MentionDraftSegment[] = [];
	let last = 0;
	const re = new RegExp(MENTION_REF_RE.source, MENTION_REF_RE.flags);
	for (const m of draft.matchAll(re)) {
		const start = m.index ?? 0;
		const text = m[0] ?? '';
		if (start > last) out.push({type: 'text', text: draft.slice(last, start)});
		out.push({type: 'mention', text, ref: text});
		last = start + text.length;
	}
	if (last < draft.length) out.push({type: 'text', text: draft.slice(last)});
	if (out.length === 0) out.push({type: 'text', text: draft});
	return out;
}

export function draftHasMentionTags(draft: string): boolean {
	return new RegExp(MENTION_REF_RE.source, MENTION_REF_RE.flags).test(draft);
}
