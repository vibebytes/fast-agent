/**
 * Bridge event types that target a Session transcript / gate (grill set C).
 * These MUST carry sessionId for App-scoped multi-Project demux.
 * Host-level events (ready, open_project_set, sessions_list, model_*, Register/NewSession
 * command_result, …) are NOT in this set.
 *
 * Catalog lives in @fastllm/bridge-protocol — do not fork the list here.
 */
import {
	SESSION_STREAM_EVENT_TYPES,
	isSessionStreamEvent,
	type BridgeEvent
} from '@fastllm/bridge-protocol';

export {SESSION_STREAM_EVENT_TYPES, isSessionStreamEvent};

/** Single source for reading sessionId off Bridge events (Hub + SessionController). */
export function sessionIdFromEvent(event: BridgeEvent): string | undefined {
	if ('sessionId' in event && typeof (event as {sessionId?: unknown}).sessionId === 'string') {
		return (event as {sessionId: string}).sessionId;
	}
	return undefined;
}
