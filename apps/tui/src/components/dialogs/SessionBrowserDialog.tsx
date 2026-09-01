import React from 'react';
import {Box, Text} from 'ink';
import type {SessionInfo} from '../../state/model.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type Props = {
	sessions: SessionInfo[];
	selected: number;
	currentSessionId?: string;
};

function formatRelativeTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
	const diffMs = Date.now() - date.getTime();
	const minutes = Math.floor(diffMs / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function SessionBrowserDialog({sessions, selected, currentSessionId}: Props) {
	const {theme} = useTheme();

	if (sessions.length === 0) {
		return <Text dimColor wrap="wrap">Loading sessions…</Text>;
	}

	return (
		<Box flexDirection="column" width="100%">
			{sessions.map((session, index) => {
				const active = index === selected;
				const isCurrent = session.isCurrent || session.id === currentSessionId;
				const label = session.title ?? session.summary ?? session.id.slice(0, 8);
				return (
					<Text key={session.id} wrap="wrap">
						<Text color={active ? theme.text.accent : undefined}>
							{active ? '❯ ' : '  '}
							{index + 1}. {label}
						</Text>
						<Text dimColor>
							{' '}({formatRelativeTime(session.lastModified)} · {session.messageCount} msgs{isCurrent ? ' · current' : ''})
						</Text>
					</Text>
				);
			})}
			<Box marginTop={1}>
				<Text dimColor wrap="wrap">Enter resume · x delete · /search (soon) · Esc cancel</Text>
			</Box>
		</Box>
	);
}
