import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from '../SessionController.js';
import {isSessionStreamEvent} from '../sessionEvents.js';

/** Stamp sessionId on session-stream events for post-demux unit tests. */
export function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

export function cueController() {
	const controller = new SessionController({
		clientId: 'cli',
		send: () => true,
		createId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})()
	});
	const task = controller.createTask('T');
	controller.acceptNewSession('sess', task.id);
	controller.handleEvent({type: 'Attached', sessionId: 'sess', clientId: 'cli'});
	return {controller, task};
}
