import type {DshQueueItem} from '../../env';

export function inboxItems(items: DshQueueItem[]): DshQueueItem[] {
	return items.filter(i => i.placement === 'queued');
}

export function steeringItems(items: DshQueueItem[]): DshQueueItem[] {
	return items.filter(i => i.placement === 'steering');
}

export function dockOpen(capsQueue: boolean | undefined, items: DshQueueItem[]): boolean {
	return capsQueue === true && (inboxItems(items).length > 0 || steeringItems(items).length > 0);
}
