import React from 'react';
import {Box, Text} from 'ink';
import type {BridgeEvent} from '../rpc/protocol.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	events: BridgeEvent[];
	title?: string;
};

/** Session replay panel — visualizes audit/event replay without owning task state. */
export function SessionReplayPanel({events, title = 'Session Replay'}: Props) {
	const {theme} = useTheme();
	if (events.length === 0) {
		return <Text dimColor color={theme.text.muted}>No events to replay. Use /task inspect or /debug-events.</Text>;
	}

	return (
		<Box flexDirection="column" borderStyle="single" borderColor={theme.border.default} paddingX={1} marginY={1}>
			<Text color={theme.text.accent} bold>{title}</Text>
			<Text dimColor>{events.length} events</Text>
			{events.slice(-20).map((event, index) => (
				<Text key={`${event.type}-${index}`} dimColor>
					{index + 1}. {event.type}
				</Text>
			))}
		</Box>
	);
}
