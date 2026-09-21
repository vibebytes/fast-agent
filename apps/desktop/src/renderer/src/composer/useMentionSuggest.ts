import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {
	atSuggestPrefix,
	groupAtItems,
	groupsToAtItems,
	type AtItem,
	type MentionSuggestGroup
} from '../atCatalog';
import type {MentionChip} from '../env';
import type {MentionRichInputHandle} from '../MentionRichInput';
import type {SlashItem} from '../slashCatalog';

type DraftStore = {setDraft: (text: string) => void};

export function useMentionSuggest(args: {
	pendingMentionInsert: AtItem | null;
	onPendingMentionConsumed?: () => void;
	selectedSlash: SlashItem | null;
	setSelectedSlash: (item: SlashItem | null) => void;
	store: DraftStore;
	richRef: RefObject<MentionRichInputHandle | null>;
	composerDisabled: boolean;
	mentionBeforeCaret: string;
	draft: string;
	atMenuOpen: boolean;
	setMentionChips: (chips: MentionChip[]) => void;
	setMentionBeforeCaret: (text: string) => void;
}): {
	mentionGroups: MentionSuggestGroup[];
	setMentionGroups: (groups: MentionSuggestGroup[]) => void;
	mentionsWarming: boolean;
	flatAtMenu: AtItem[];
	atMenuByKind: {kind: string; items: AtItem[]}[];
} {
	const {
		pendingMentionInsert,
		onPendingMentionConsumed,
		selectedSlash,
		setSelectedSlash,
		store,
		richRef,
		composerDisabled,
		mentionBeforeCaret,
		draft,
		atMenuOpen,
		setMentionChips,
		setMentionBeforeCaret
	} = args;
	const [mentionGroups, setMentionGroups] = useState<MentionSuggestGroup[]>([]);
	const [mentionRequestId, setMentionRequestId] = useState<string | null>(null);
	const [mentionsWarming, setMentionsWarming] = useState(false);
	const pendingMentionId = useRef<string | null>(null);
	const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!pendingMentionInsert) return;
		let cancelled = false;
		let attempts = 0;
		const item = pendingMentionInsert;
		const tryInsert = () => {
			if (cancelled) return;
			if (selectedSlash) {
				setSelectedSlash(null);
				store.setDraft('');
				requestAnimationFrame(tryInsert);
				return;
			}
			const snap = richRef.current?.insertChip(item);
			const ok = Boolean(
				snap && (snap.chips.length > 0 || /@[A-Za-z0-9_./:-]+/.test(snap.text))
			);
			if (ok && snap) {
				store.setDraft(snap.text);
				setMentionChips(snap.chips);
				setMentionBeforeCaret(snap.beforeCaret);
				onPendingMentionConsumed?.();
				return;
			}
			if (attempts < 8) {
				attempts += 1;
				requestAnimationFrame(tryInsert);
				return;
			}
			// Keep pending — do not clear; next mount / effect can retry.
		};
		tryInsert();
		return () => {
			cancelled = true;
		};
	}, [pendingMentionInsert, onPendingMentionConsumed, store, selectedSlash]);

	useEffect(() => {
		if (!atMenuOpen || composerDisabled) {
			setMentionGroups([]);
			setMentionsWarming(false);
			return;
		}
		const prefix = atSuggestPrefix(mentionBeforeCaret || draft);
		if (prefix == null) return;
		if (mentionTimer.current) clearTimeout(mentionTimer.current);
		setMentionsWarming(true);
		mentionTimer.current = setTimeout(() => {
			const requestId = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			pendingMentionId.current = requestId;
			void window.fastIde.mentionSuggest(prefix, requestId);
		}, 120);
		return () => {
			if (mentionTimer.current) clearTimeout(mentionTimer.current);
		};
	}, [atMenuOpen, composerDisabled, mentionBeforeCaret, draft]);

	useEffect(() => {
		return window.fastIde.onBridgeEvent(payload => {
			const event = payload.event as {
				type?: string;
				requestId?: string;
				groups?: MentionSuggestGroup[];
			};
			if (event.type !== 'mention_suggestions' || !event.requestId) return;
			if (
				pendingMentionId.current != null &&
				event.requestId !== pendingMentionId.current
			) {
				return;
			}
			setMentionRequestId(event.requestId);
			setMentionGroups(event.groups ?? []);
			setMentionsWarming(false);
		});
	}, []);

	const flatAtMenu = useMemo(() => {
		if (!atMenuOpen) return [] as AtItem[];
		if (mentionRequestId != null && pendingMentionId.current != null
			&& mentionRequestId !== pendingMentionId.current) {
			return [] as AtItem[];
		}
		return groupsToAtItems(mentionGroups);
	}, [atMenuOpen, mentionGroups, mentionRequestId]);
	const atMenuByKind = useMemo(() => groupAtItems(flatAtMenu), [flatAtMenu]);

	return {mentionGroups, setMentionGroups, mentionsWarming, flatAtMenu, atMenuByKind};
}
