import React from 'react';
import {Box, Text} from 'ink';
import {truncateMiddle} from '../theme.js';

type Props = {
	/** Queued inputs — `id` keys the rows so a dequeue does not remount the rest. */
	items: ReadonlyArray<{id: string; text: string}>;
};

export function QueuePanel({items}: Props) {
	if (items.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column" marginTop={1} width="100%">
			<Text dimColor wrap="wrap">queued messages</Text>
			{items.map(item => (
				<Text key={item.id} dimColor wrap="wrap">
					› {truncateMiddle(item.text, 120)}
				</Text>
			))}
			<Text dimColor wrap="wrap">Esc/Ctrl+U clears queued messages</Text>
		</Box>
	);
}
