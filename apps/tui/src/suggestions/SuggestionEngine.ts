import type {Suggestion, SuggestionGroup} from '../commands/types.js';
import type {SlashCommand} from '../commands/types.js';

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

export type SuggestionEngineContext = {
	partial: string;
	commands: SlashCommand[];
	history: string[];
	cwd: string;
	model: string;
	runIds?: string[];
	sessionIds?: string[];
	/** Mentions groups from Bridge `mention_suggestions` (replaces local fake paths). */
	mentionGroups?: MentionSuggestGroup[];
};

/** In-progress `@…` token at caret (start/mid-sentence). */
export type MentionTokenSpan = {
	prefix: string;
	start: number;
	end: number;
};

export function mentionTokenSpan(draft: string, caret = draft.length): MentionTokenSpan | null {
	const end = Math.max(0, Math.min(caret, draft.length));
	const before = draft.slice(0, end);
	const m = /(?:^|[\s])@([^\s@]*)$/.exec(before);
	if (!m) return null;
	const atIdx = before.lastIndexOf('@');
	if (atIdx < 0) return null;
	return {prefix: draft.slice(atIdx, end), start: atIdx, end};
}

/** Replace active `@partial` with insert (canonical ref); whole-line @ when span covers start. */
export function applyMentionPick(draft: string, insert: string, caret = draft.length): string {
	const span = mentionTokenSpan(draft, caret);
	if (!span) return insert;
	return `${draft.slice(0, span.start)}${insert}${draft.slice(span.end)}`;
}

export function buildSuggestions(ctx: SuggestionEngineContext): SuggestionGroup[] {
	const groups: SuggestionGroup[] = [];

	if (ctx.partial.startsWith('/')) {
		const query = ctx.partial.slice(1).split(/\s+/)[0] ?? '';
		const slashItems = ctx.commands
			.filter(cmd => !cmd.hidden && cmd.name.startsWith(query))
			.map(cmd => ({
				value: `/${cmd.name}`,
				label: `/${cmd.name}`,
				description: cmd.description,
				group: cmd.kind === 'ui' ? 'Built-in UI' : 'Engine',
				kind: cmd.kind
			}));
		if (slashItems.length > 0) {
			groups.push({title: 'Commands', items: slashItems});
		}
		return groups;
	}

	if (ctx.partial.startsWith('@')) {
		return mentionGroupsToSuggestions(ctx.mentionGroups ?? []);
	}

	if (ctx.partial.length === 0) {
		return groups;
	}

	const historyItems = ctx.history
		.filter(entry => entry.toLowerCase().includes(ctx.partial.toLowerCase()))
		.slice(-5)
		.map(entry => ({value: entry, label: entry, group: 'History'}));

	if (historyItems.length > 0) {
		groups.push({title: 'History', items: historyItems});
	}

	return groups;
}

export function mentionGroupsToSuggestions(groups: MentionSuggestGroup[]): SuggestionGroup[] {
	return groups
		.map(g => ({
			title: kindTitle(g.kind),
			items: g.items.map(item => ({
				value: item.ref,
				label: item.displayName,
				description: item.description ?? item.ref,
				group: kindTitle(g.kind),
				payload: item.payload,
				ref: item.ref
			}))
		}))
		.filter(g => g.items.length > 0);
}

function kindTitle(kind: string): string {
	if (!kind) return 'Mentions';
	return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function flattenSuggestions(groups: SuggestionGroup[]): Suggestion[] {
	return groups.flatMap(group => group.items);
}

export function filterSuggestions(groups: SuggestionGroup[], query: string): SuggestionGroup[] {
	if (query.length === 0) return groups;
	const lower = query.toLowerCase();
	return groups
		.map(group => ({
			...group,
			items: group.items.filter(item =>
				item.label.toLowerCase().includes(lower) ||
				item.description?.toLowerCase().includes(lower)
			)
		}))
		.filter(group => group.items.length > 0);
}

export type SuggestionState = {
	groups: SuggestionGroup[];
	activeIndex: number;
	visible: boolean;
};

export const initialSuggestionState: SuggestionState = {
	groups: [],
	activeIndex: 0,
	visible: false
};

export function moveSuggestion(state: SuggestionState, direction: 'up' | 'down'): SuggestionState {
	const flat = flattenSuggestions(state.groups);
	if (flat.length === 0) return state;
	const delta = direction === 'up' ? -1 : 1;
	const next = (state.activeIndex + delta + flat.length) % flat.length;
	return {...state, activeIndex: next};
}

export function activeSuggestion(state: SuggestionState): Suggestion | undefined {
	return flattenSuggestions(state.groups)[state.activeIndex];
}
