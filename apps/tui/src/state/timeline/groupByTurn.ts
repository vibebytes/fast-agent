import type {TimelineItem} from './model.js';

export type TurnTimelineGroup = {
	turnId?: string;
	items: TimelineItem[];
};

export function groupTimelineByTurn(items: TimelineItem[]): TurnTimelineGroup[] {
	const groups: TurnTimelineGroup[] = [];
	let current: TurnTimelineGroup | undefined;

	for (const item of items) {
		if (!item.turnId) {
			if (current) {
				groups.push(current);
				current = undefined;
			}
			groups.push({items: [item]});
			continue;
		}

		if (!current || current.turnId !== item.turnId) {
			if (current) {
				groups.push(current);
			}
			current = {turnId: item.turnId, items: [item]};
			continue;
		}

		current.items.push(item);
	}

	if (current) {
		groups.push(current);
	}

	return groups;
}

export function splitTurnItems(items: TimelineItem[]): {
	left: TimelineItem[];
	right: TimelineItem[];
	rest: TimelineItem[];
} {
	const left: TimelineItem[] = [];
	const right: TimelineItem[] = [];
	const rest: TimelineItem[] = [];

	for (const item of items) {
		switch (item.kind) {
			case 'assistant_message':
				right.push(item);
				break;
			case 'user_message':
			case 'thinking_message':
			case 'tool_group':
			case 'system_message':
				left.push(item);
				break;
			default:
				rest.push(item);
		}
	}

	return {left, right, rest};
}
