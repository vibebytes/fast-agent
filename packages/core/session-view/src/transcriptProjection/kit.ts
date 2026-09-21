import {applyBridgeEvent, createTranscriptState} from '../index.js';

/** Shared sealed explore-tool step for processStack / river remap tests. */
export function exploreFinished(
	state: ReturnType<typeof createTranscriptState>,
	turnId: string,
	id: string,
	path: string
) {
	let next = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId,
		id,
		tool: 'read_file',
		args: {path}
	});
	return applyBridgeEvent(next, {
		type: 'tool_finished',
		turnId,
		id,
		tool: 'read_file',
		success: true,
		fields: {}
	});
}
