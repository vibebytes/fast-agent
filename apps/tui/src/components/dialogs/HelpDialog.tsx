import React from 'react';
import {Box, Text} from 'ink';
import type {CommandInfo} from '../../state/model.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {allCommandInfo} from '../../commands/registry.js';
import {visibleCommandSpecs} from '../../commands/commandSpec.js';
import {padToWidth} from '../../utils/textWidth.js';

type Props = {commands: CommandInfo[]};

function availabilityLabel(cmd: CommandInfo): string {
	switch (cmd.availability) {
		case 'partial': return ' (partial)';
		case 'capability_unavailable': return ' (requires capability)';
		default: return cmd.available ? '' : ' (unavailable)';
	}
}

export function HelpDialog({commands}: Props) {
	const {theme} = useTheme();
	const visible = commands.length > 0 ? commands : allCommandInfo();
	const uiNames = new Set(visibleCommandSpecs().filter(spec => spec.owner === 'ui').map(spec => spec.name));
	const uiCommands = visible.filter(cmd => uiNames.has(cmd.name));
	const engineCommands = visible.filter(cmd => !uiNames.has(cmd.name));

	return (
		<Box flexDirection="column" marginY={1}>
			<Text bold color={theme.text.accent}>UI-only</Text>
			{uiCommands.map(cmd => (
				<Text key={`ui-${cmd.name}`}>
					{/* padToWidth is CJK-aware; String.padEnd misaligns wide chars. */}
					<Text color={theme.text.accent}>{padToWidth(cmd.usage, 20)}</Text>
					<Text dimColor>{cmd.description}{availabilityLabel(cmd)}</Text>
				</Text>
			))}
			<Text bold color={theme.text.accent}>Engine</Text>
			{engineCommands.map(cmd => (
				<Text key={`engine-${cmd.name}`}>
					<Text color={theme.text.accent}>{padToWidth(cmd.usage, 20)}</Text>
					<Text dimColor>{cmd.description}{availabilityLabel(cmd)}</Text>
				</Text>
			))}
		</Box>
	);
}
