import React from 'react';
import {Box, Text} from 'ink';
import {Command, commandLabel} from '../../input/keybindings.js';
import {useTheme} from '../../contexts/ThemeContext.js';

const SHORTCUTS: Array<{command: Command; description: string}> = [
	{command: Command.RETURN, description: 'Submit message'},
	{command: Command.NEWLINE, description: 'New line in input (Shift+Enter)'},
	{command: Command.HISTORY_UP, description: 'Previous history entry'},
	{command: Command.HISTORY_DOWN, description: 'Next history entry'},
	{command: Command.ACCEPT_SUGGESTION, description: 'Accept suggestion'},
	{command: Command.CLEAR_INPUT, description: 'Clear input'},
	{command: Command.TOGGLE_TOOL_DETAIL, description: 'Expand tool details (Ctrl+O)'},
	{command: Command.TOGGLE_HELP, description: 'Open help dialog (Ctrl+H)'},
	{command: Command.TOGGLE_FOOTER, description: 'Configure footer items (Ctrl+F)'},
	{command: Command.CANCEL_TASK, description: 'Cancel running task or exit when idle (Ctrl+C)'},
	{command: Command.ESCAPE, description: 'Dismiss suggestions / clear input / cancel run / close dialog'}
];

export function ShortcutsDialog() {
	const {theme} = useTheme();
	return (
		<Box flexDirection="column" marginY={1}>
			{SHORTCUTS.map(item => (
				<Text key={item.command}>
					<Text color={theme.text.accent}>{commandLabel(item.command).padEnd(20)}</Text>
					<Text dimColor>{item.description}</Text>
				</Text>
			))}
		</Box>
	);
}
