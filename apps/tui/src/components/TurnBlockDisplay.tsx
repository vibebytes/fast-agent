import React from 'react';
import {Box} from 'ink';
import type {TimelineItem} from '../state/timeline/model.js';
import {HistoryItemDisplay} from './HistoryItemDisplay.js';

type Props = {
	items: TimelineItem[];
	onQuestionAnswer?: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
};

export function TurnBlockDisplay({items, onQuestionAnswer}: Props) {
	if (items.length === 1 && !items[0]?.turnId) {
		const item = items[0];
		if (!item) return null;
		return <HistoryItemDisplay item={item} onQuestionAnswer={onQuestionAnswer} />;
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			{items.map(item => (
				<HistoryItemDisplay key={item.id} item={item} onQuestionAnswer={onQuestionAnswer} />
			))}
		</Box>
	);
}
