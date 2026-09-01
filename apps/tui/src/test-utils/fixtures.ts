import type {BridgeEvent} from '../rpc/protocol.js';
import type {UiState} from '../state/model.js';
import {initialState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {turnsToTimeline} from '../state/timeline/turnAdapter.js';

/** Fake bridge replay for session/inspect UI tests. */
export function replayEvents(events: BridgeEvent[], base: UiState = initialState): UiState {
	return events.reduce((state, event) => reducer(state, {type: 'engine_event', event}), base);
}

export function snapshotTimeline(state: UiState): string[] {
	return turnsToTimeline(state).items.map(item => `${item.kind}:${item.id}`);
}

/** Keyboard driver helper for tests. */
export function keyInput(input: string, overrides: Partial<{upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; ctrl: boolean; shift: boolean}> = {}) {
	return {
		input,
		key: {
			upArrow: false,
			downArrow: false,
			leftArrow: false,
			rightArrow: false,
			return: false,
			escape: false,
			tab: false,
			backspace: false,
			delete: false,
			ctrl: false,
			shift: false,
			meta: false,
			...overrides
		}
	};
}
