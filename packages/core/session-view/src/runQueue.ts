import type {BridgeCommand} from '@fastllm/bridge-protocol';
import type {DshCaps, DshQueueItem, QueueItem} from './wire.js';

export type QueueSource = {
	queue: QueueItem[];
	dshCaps?: DshCaps;
	dshQueue?: DshQueueItem[];
};

const dshQueueable = (src: QueueSource): boolean => src.dshCaps?.queue === true;
const dshHas = (src: QueueSource, itemId: string): boolean =>
	(src.dshQueue ?? []).some(q => q.id === itemId);
const hostHas = (src: QueueSource, itemId: string): boolean =>
	src.queue.some(q => q.id === itemId);

export function queueRemoveCommands(src: QueueSource, sessionId: string, itemId: string): BridgeCommand[] {
	if (dshQueueable(src)) {
		if (!dshHas(src, itemId)) return [];
		return [{type: 'Queue', sessionId, itemId, action: 'remove'}];
	}
	if (!hostHas(src, itemId)) return [];
	return [{type: 'FollowUpRemove', sessionId, itemId}];
}

export function queueClearCommands(src: QueueSource, sessionId: string): BridgeCommand[] {
	if (dshQueueable(src)) {
		return (src.dshQueue ?? [])
			.filter(q => q.placement !== 'context')
			.map(q => ({type: 'Queue', sessionId, itemId: q.id, action: 'remove'}) as BridgeCommand);
	}
	if (src.queue.length === 0) return [];
	return src.queue.map(item => ({type: 'FollowUpRemove', sessionId, itemId: item.id}) as BridgeCommand);
}

export function queueReorderCommands(src: QueueSource, sessionId: string, fromIndex: number, toIndex: number): BridgeCommand[] {
	if (
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= src.queue.length ||
		toIndex >= src.queue.length ||
		fromIndex === toIndex
	) {
		return [];
	}
	return [{type: 'FollowUpReorder', sessionId, fromIndex, toIndex}];
}

export function queueEditCommands(src: QueueSource, sessionId: string, itemId: string, text: string): BridgeCommand[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (dshQueueable(src)) {
		if (!dshHas(src, itemId)) return [];
		return [{type: 'Queue', sessionId, itemId, action: 'edit', text: trimmed}];
	}
	if (!hostHas(src, itemId)) return [];
	return [{type: 'FollowUpUpdate', sessionId, itemId, text: trimmed}];
}

export function queuePauseCommand(sessionId: string, paused: boolean): BridgeCommand {
	return {type: 'FollowUpPause', sessionId, paused};
}

export type QueueSteerPlan =
	| {kind: 'dsh'}
	| {kind: 'interrupt'; text: string}
	| null;

export function queueSteerPlan(src: QueueSource, itemId: string): QueueSteerPlan {
	if (dshQueueable(src)) {
		if (!dshHas(src, itemId)) return null;
		return {kind: 'dsh'};
	}
	const item = src.queue.find(q => q.id === itemId);
	if (!item) return null;
	return {kind: 'interrupt', text: item.text};
}
