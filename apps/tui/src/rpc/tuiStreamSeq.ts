import {emptySessionSeq, offer, type OfferCtx, type SessionSeq} from '@fast-ide/session-view';
import type {BridgeEvent} from '@fastllm/bridge-protocol';

export type TuiStreamResult = {
	emit: BridgeEvent[];
	lastApplied: number;
	resync: boolean;
};

export type TuiStreamSeq = {
	lastApplied: number;
	onEvent(event: BridgeEvent, ctx?: OfferCtx): TuiStreamResult;
};

export function createTuiStreamSeq(): TuiStreamSeq {
	let state: SessionSeq = emptySessionSeq();
	return {
		get lastApplied() {
			return state.lastApplied;
		},
		onEvent(event, ctx = {}) {
			const result = offer(state, event, ctx);
			state = result.state;
			return {emit: result.emit, lastApplied: result.state.lastApplied, resync: result.resync};
		}
	};
}
