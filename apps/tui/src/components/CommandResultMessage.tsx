import React from 'react';
import {Box, Text} from 'ink';
import type {SystemTimelineItem} from '../state/timeline/model.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	item: SystemTimelineItem;
};

export function CommandResultMessage({item}: Props) {
	const {theme} = useTheme();
	const status = item.commandStatus ?? 'success';
	const color = status === 'error'
		? theme.status.danger
		: status === 'unavailable' || status === 'rejected' || status === 'cancelled'
			? theme.status.warning
			: theme.status.success;
	const command = item.commandName ? `/${item.commandName}` : 'command';
	const lines = item.text.split(/\r?\n/);
	const summary = lines.find(line => line.trim().length > 0);
	const rawDetails = summary ? lines.slice(lines.indexOf(summary) + 1) : [];
	// Strip trailing empty lines to avoid a blank row at the card bottom.
	while (rawDetails.length > 0 && rawDetails.at(-1)!.trim().length === 0) rawDetails.pop();
	const detailLines = rawDetails;
	const collapsed = item.collapsed === true && detailLines.length > 0;
	const hiddenCount = detailLines.filter(line => line.trim().length > 0).length;

	return (
		<Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1} marginY={1}>
			<Text wrap="wrap">
				<Text color={color}>◆ </Text>
				<Text color={theme.text.accent} bold>{command}</Text>
				<Text dimColor> command result</Text>
				<Text dimColor> · {status}</Text>
			</Text>
			{summary && <Text color={color} wrap="wrap">{summary}</Text>}
			{collapsed ? (
				<Text dimColor wrap="wrap">  … {hiddenCount} lines folded</Text>
			) : detailLines.length > 0 ? (
				<Box flexDirection="column" marginTop={1}>
					{detailLines.map((line, index) => (
						<Text key={`${index}-${line}`} color={theme.text.secondary} wrap="wrap">
							{line.trim().length === 0 ? ' ' : `  ${line}`}
						</Text>
					))}
				</Box>
			) : null}
			{item.capability && <Text dimColor wrap="wrap">capability: {item.capability}</Text>}
		</Box>
	);
}
