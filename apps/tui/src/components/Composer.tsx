import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useInputContext} from '../contexts/InputContext.js';
import {Command, matchKeybinding} from '../input/keybindings.js';
import {SuggestionsDisplay} from './SuggestionsDisplay.js';
import {
	applyMentionPick,
	buildSuggestions,
	activeSuggestion,
	mentionTokenSpan,
	moveSuggestion,
	initialSuggestionState,
	type MentionSuggestGroup
} from '../suggestions/SuggestionEngine.js';
import {useCommandRegistry} from '../contexts/CommandContext.js';
import {useUIState} from '../contexts/UIStateContext.js';
import {useSharedSpinner} from '../hooks/useSharedSpinner.js';
import {isScreenReader} from '../terminal/capabilityManager.js';
import {STR} from '../ui/strings.js';
import {TextEntry} from './TextEntry.js';
import {setComposerDraftEmpty} from '../state/composerDraft.js';
import type {Suggestion} from '../commands/types.js';

export type MentionChip = {
	kind: string;
	locator: string;
	displayName?: string;
	ref?: string;
	entity?: string;
};

type Props = {
	ready: boolean;
	mode: string;
	onClearQueue: () => void;
	onSubmit: (value: string, mentions?: MentionChip[]) => void;
	/** Debounced Bridge MentionSuggest. */
	onMentionQuery?: (prefix: string, requestId: string) => void;
	mentionGroups?: MentionSuggestGroup[];
	mentionRequestId?: string | null;
	/** Bare r/c quick keys; availability gates whether the key is claimed. */
	onQuickKey?: (ch: 'r' | 'c') => void;
	quickActions?: {retry: boolean; cont: boolean};
};

export function Composer({
	ready,
	mode,
	onClearQueue,
	onSubmit,
	onMentionQuery,
	mentionGroups = [],
	mentionRequestId,
	onQuickKey,
	quickActions
}: Props) {
	const {theme} = useTheme();
	const {history, historyEnabled} = useInputContext();
	const registry = useCommandRegistry();
	const {state} = useUIState();
	const [value, setValue] = useState('');
	const frame = useSharedSpinner(!ready);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [draft, setDraft] = useState('');
	const [suggestions, setSuggestions] = useState(initialSuggestionState);
	const [suggestionDraft, setSuggestionDraft] = useState<string | null>(null);
	const [chips, setChips] = useState<MentionChip[]>([]);
	const pendingMentionId = useRef<string | null>(null);
	const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const valueRef = useRef(value);
	valueRef.current = value;
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const historyIndexRef = useRef(historyIndex);
	historyIndexRef.current = historyIndex;
	const suggestionDraftRef = useRef(suggestionDraft);
	suggestionDraftRef.current = suggestionDraft;
	const suggestionsRef = useRef(suggestions);
	suggestionsRef.current = suggestions;

	useEffect(() => {
		setComposerDraftEmpty(value.length === 0);
	}, [value]);

	useEffect(() => {
		if (!onMentionQuery) return;
		const span = mentionTokenSpan(value);
		if (!span) return;
		if (mentionTimer.current) clearTimeout(mentionTimer.current);
		mentionTimer.current = setTimeout(() => {
			const requestId = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			pendingMentionId.current = requestId;
			onMentionQuery(span.prefix, requestId);
		}, 120);
		return () => {
			if (mentionTimer.current) clearTimeout(mentionTimer.current);
		};
	}, [value, onMentionQuery]);

	useEffect(() => {
		if (suggestionDraft !== null) return;
		const mentionSpan = mentionTokenSpan(value);
		const mentionActive = mentionSpan != null;
		const slashActive = value.startsWith('/');
		const groups = buildSuggestions({
			partial: slashActive ? value : (mentionSpan?.prefix ?? value),
			commands: registry.commands,
			history,
			cwd: state.cwd,
			model: state.model,
			mentionGroups:
				mentionActive &&
				(mentionRequestId == null || mentionRequestId === pendingMentionId.current)
					? mentionGroups
					: []
		});
		setSuggestions({
			groups,
			activeIndex: 0,
			visible: groups.length > 0 && (slashActive || mentionActive)
		});
	}, [
		value,
		suggestionDraft,
		registry.commands,
		history,
		state.cwd,
		state.model,
		mentionGroups,
		mentionRequestId
	]);

	useEffect(() => {
		if (suggestionDraft === null || !suggestions.visible) return;
		const sel = activeSuggestion(suggestions);
		if (!sel) return;
		if (suggestionDraft.startsWith('/')) {
			setValue(sel.value);
			return;
		}
		setValue(applyMentionPick(suggestionDraft, sel.value));
	}, [suggestions, suggestionDraft]);

	useInput((input, key) => {
		const cmd = matchKeybinding({input, key});
		const suggestions = suggestionsRef.current;
		const suggestionDraft = suggestionDraftRef.current;
		const value = valueRef.current;
		if (suggestions.visible && (cmd === Command.MOVE_UP || cmd === Command.COMPLETION_UP)) {
			if (suggestionDraft === null) setSuggestionDraft(value);
			setSuggestions(current => moveSuggestion(current, 'up'));
			return;
		}
		if (suggestions.visible && (cmd === Command.MOVE_DOWN || cmd === Command.COMPLETION_DOWN)) {
			if (suggestionDraft === null) setSuggestionDraft(value);
			setSuggestions(current => moveSuggestion(current, 'down'));
			return;
		}
		if (suggestions.visible && cmd === Command.ACCEPT_SUGGESTION) {
			const selected = activeSuggestion(suggestions);
			if (selected) {
				const base = suggestionDraft ?? value;
				setValue(
					base.startsWith('/')
						? selected.value
						: applyMentionPick(base, selected.value)
				);
				const chip = chipFromSuggestion(selected);
				if (chip) setChips(prev => [...prev.filter(c => c.ref !== chip.ref), chip]);
			}
			setSuggestions(initialSuggestionState);
			setSuggestionDraft(null);
			return;
		}
		if (cmd === Command.ESCAPE) {
			if (suggestions.visible) {
				if (suggestionDraft !== null) {
					setValue(suggestionDraft);
					setSuggestionDraft(null);
				}
				setSuggestions(current => ({...current, visible: false}));
			} else if (value.length > 0) {
				setValue('');
				setHistoryIndex(null);
				setDraft('');
			}
			return;
		}
		if (cmd === Command.CLEAR_INPUT) {
			if (value.length > 0) {
				setValue('');
				setHistoryIndex(null);
				setDraft('');
				setChips([]);
			} else {
				onClearQueue();
			}
			return;
		}
		// Multiline buffer: ↑/↓ move the caret inside TextEntry — skip history.
		if (value.includes('\n')) return;
		if (historyEnabled && cmd === Command.MOVE_UP && history.length > 0) {
			const currentIndex = historyIndexRef.current;
			const nextIndex = currentIndex === null ? history.length - 1 : Math.max(0, currentIndex - 1);
			if (currentIndex === null) setDraft(value);
			setHistoryIndex(nextIndex);
			setValue(history[nextIndex] ?? '');
			return;
		}
		if (historyEnabled && cmd === Command.MOVE_DOWN && historyIndexRef.current !== null) {
			const nextIndex = historyIndexRef.current + 1;
			if (nextIndex >= history.length) {
				setHistoryIndex(null);
				setValue(draftRef.current);
			} else {
				setHistoryIndex(nextIndex);
				setValue(history[nextIndex] ?? '');
			}
		}
	}, {isActive: mode !== 'approval'});

	const plain = isScreenReader();
	const prefix = ready ? `${promptPrefix(mode)} ` : '';

	return (
		<Box flexDirection="column">
			{suggestions.visible && <SuggestionsDisplay state={suggestions} />}
			{mode === 'queued' && (
				<Text color={theme.text.muted} dimColor wrap="wrap">{STR.queuedNotice}</Text>
			)}
			<Box
				width="100%"
				borderStyle={plain ? undefined : 'round'}
				borderColor={plain ? undefined : borderColorFor(mode, theme)}
				paddingX={plain ? 0 : 1}
			>
				{ready ? (
					<Text color={theme.text.accent}>{prefix}</Text>
				) : (
					<Text color={theme.text.accent}>{frame} {STR.engineStarting}  </Text>
				)}
				{ready && (
					<TextEntry
						value={value}
						focus={mode !== 'approval'}
						placeholder={placeholderFor(mode)}
						onBareKey={
							onQuickKey && quickActions
								? ch => {
										if (ch === 'r' && quickActions.retry) {
											onQuickKey('r');
											return true;
										}
										if (ch === 'c' && quickActions.cont) {
											onQuickKey('c');
											return true;
										}
										return false;
									}
								: undefined
						}
						onChange={next => {
							if (mode === 'approval' || mode === 'question') return;
							setValue(next);
							setHistoryIndex(null);
						}}
						onSubmit={trimmed => {
							if (trimmed.length === 0) return;
							const outgoing = chips.length > 0 ? chips : undefined;
							setValue('');
							setHistoryIndex(null);
							setDraft('');
							setChips([]);
							setSuggestions(initialSuggestionState);
							setSuggestionDraft(null);
							onSubmit(trimmed, outgoing);
						}}
					/>
				)}
			</Box>
		</Box>
	);
}

function chipFromSuggestion(sel: Suggestion): MentionChip | null {
	if (!sel.payload) return null;
	return {
		kind: sel.payload.kind,
		locator: sel.payload.locator,
		entity: sel.payload.entity,
		displayName: sel.label,
		ref: sel.ref ?? sel.value
	};
}

function borderColorFor(mode: string, theme: ReturnType<typeof useTheme>['theme']): string {
	if (mode === 'approval') return theme.status.warning;
	if (mode === 'question' || mode === 'clarify') return theme.text.accent;
	if (mode === 'queued') return theme.status.info;
	return theme.border.default;
}

function promptPrefix(mode: string): string {
	if (mode === 'clarify') return '答:';
	if (mode === 'question') return 'choice>';
	if (mode === 'approval') return 'confirm>';
	if (mode === 'queued') return 'queue>';
	return '>';
}

function placeholderFor(mode: string): string {
	if (mode === 'approval') return STR.approvalPlaceholder;
	if (mode === 'question') return STR.questionPlaceholder;
	return STR.readyHint;
}
