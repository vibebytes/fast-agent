import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {SessionReplayPanel} from '../SessionReplayPanel.js';
import type {BridgeEvent} from '../../rpc/protocol.js';

type Props = {
	runId?: string;
	events: string[];
};

export function TaskInspectorDialog({runId, events}: Props) {
	const {theme} = useTheme();
	const bridgeEvents: BridgeEvent[] = events.map(line => ({
		type: 'engine_status' as const,
		stage: 'replay',
		message: line
	}));

	// Single event surface: a plain-text tail on top of SessionReplayPanel
	// duplicated the same events and doubled the dialog height.
	return (
		<Box flexDirection="column" marginY={1}>
			<Text color={theme.text.accent}>Run: {runId ?? 'current'} <Text dimColor>({events.length} events)</Text></Text>
			{events.length === 0 && <Text dimColor>No debug events recorded.</Text>}
			<SessionReplayPanel events={bridgeEvents} title="Event Timeline" />
		</Box>
	);
}
