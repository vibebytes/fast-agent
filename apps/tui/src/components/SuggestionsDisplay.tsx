import React from 'react';
import {Box, Text} from 'ink';
import type {SuggestionState} from '../suggestions/SuggestionEngine.js';
import {flattenSuggestions} from '../suggestions/SuggestionEngine.js';
import type {Suggestion} from '../commands/types.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	state: SuggestionState;
	maxVisible?: number;
};

export function SuggestionsDisplay({state, maxVisible = 8}: Props) {
	const {theme} = useTheme();
	const flat = flattenSuggestions(state.groups);
	if (flat.length === 0) return null;

	// Window the list around the active item. Rendering everything used to
	// blow the dynamic frame past the terminal height, which flips Ink into
	// its fullscreen fallback (clearTerminal + full static replay) — the
	// root cause of duplicated transcript history in scrollback.
	const start = Math.max(0, Math.min(state.activeIndex - Math.floor(maxVisible / 2), flat.length - maxVisible));
	const visible = flat.slice(start, start + maxVisible);
	const groupTitleOf = (item: Suggestion): string | undefined =>
		state.groups.find(group => group.items.includes(item))?.title;

	return (
		<Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={theme.border.focus} paddingX={1}>
			{visible.map((item, index) => {
				const globalIndex = start + index;
				const active = globalIndex === state.activeIndex;
				const title = groupTitleOf(item);
				const previousTitle = index > 0 ? groupTitleOf(visible[index - 1]!) : undefined;
				const showTitle = title !== undefined && title !== previousTitle;
				return (
					<Box key={`${item.value}-${globalIndex}`} flexDirection="column">
						{showTitle && <Text color={theme.text.muted} dimColor>-- {title} --</Text>}
						<Text>
							<Text color={active ? theme.text.accent : undefined}>{active ? '❯ ' : '  '}</Text>
							<Text bold={active}>{item.label}</Text>
							{item.description && <Text dimColor>  {item.description}</Text>}
						</Text>
					</Box>
				);
			})}
			{flat.length > maxVisible && (
				<Text dimColor>{state.activeIndex + 1}/{flat.length} • ↑↓ navigate • Tab accept</Text>
			)}
		</Box>
	);
}
