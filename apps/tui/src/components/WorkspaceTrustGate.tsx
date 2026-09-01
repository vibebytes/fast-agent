import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';

type Props = {
	workspace: string;
	onTrust: () => void;
	onExit: () => void;
};

export function WorkspaceTrustGate({workspace, onTrust, onExit}: Props) {
	const {theme} = useTheme();
	const {columns} = useTerminalSize();
	const [selected, setSelected] = useState<0 | 1>(0);

	useInput((input, key) => {
		if (key.upArrow || key.downArrow || key.tab) {
			setSelected(current => current === 0 ? 1 : 0);
			return;
		}

		if (input === '1' || input.toLowerCase() === 'y') {
			onTrust();
			return;
		}

		if (key.escape || input === '2' || input.toLowerCase() === 'n') {
			onExit();
			return;
		}

		if (key.return) {
			if (selected === 0) {
				onTrust();
			} else {
				onExit();
			}
		}
	});

	// Fits narrow terminals — a fixed 80-dash literal used to wrap onto two rows.
	const separator = '─'.repeat(Math.max(10, Math.min(columns - 1, 80)));

	return (
		<Box flexDirection="column" gap={1}>
			<Text color={theme.text.muted}>{separator}</Text>
			<Box flexDirection="column">
				<Text bold> Accessing workspace:</Text>
				<Text> </Text>
				<Text> {workspace}</Text>
			</Box>
			<Box flexDirection="column">
				<Text> Quick safety check: Is this a project you created or one you trust? (Like your own code,</Text>
				<Text> a well-known open source project, or work from your team). If not, take a moment to review</Text>
				<Text> what's in this folder first.</Text>
			</Box>
			<Text> FAST CLI will be able to read, edit, and execute files here.</Text>
			<Text color={theme.text.accent}> Security guide</Text>
			<Box flexDirection="column">
				<Text color={selected === 0 ? theme.status.success : undefined}> {selected === 0 ? '❯' : ' '} 1. Yes, I trust this folder</Text>
				<Text color={selected === 1 ? theme.status.danger : undefined}> {selected === 1 ? '❯' : ' '} 2. No, exit</Text>
			</Box>
			<Text color={theme.text.muted}> ↑/↓ to switch · Enter to confirm · Esc to cancel</Text>
		</Box>
	);
}
