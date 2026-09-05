import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {
	applyBridgeEvent,
	type TranscriptState
} from './transcriptProjection.js';
import {emptySessionSeq, offer, seqTerminal, type SessionSeq} from './sessionSeq.js';
import {applyCodeChangeEvent, type CodeChangesState} from './codeChangesProjection.js';

export type StreamProjectionInput = {
	transcript: TranscriptState;
	codeChanges: CodeChangesState;
	lastEventSeq: number;
	seq: SessionSeq | null | undefined;
	seqSession: string | undefined;
};

export type StreamProjectionResult = {
	transcript: TranscriptState;
	codeChanges: CodeChangesState;
	lastEventSeq: number;
	/** Non-null only on the per-session seq path — caller persists it. */
	seqState: SessionSeq | null;
	ack: number | null;
	resync: boolean;
};

export function projectStreamEvent(
	input: StreamProjectionInput,
	event: BridgeEvent
): StreamProjectionResult {
	let {transcript, codeChanges, lastEventSeq} = input;
	let ack: number | null = null;
	let resync = false;
	if (input.seqSession) {
		const before = input.seq ?? {...emptySessionSeq(), lastApplied: input.lastEventSeq};
		const result = offer(before, event, {terminal: seqTerminal(transcript)});
		if (result.state.lastApplied !== before.lastApplied) {
			lastEventSeq = result.state.lastApplied;
			ack = result.state.lastApplied;
		}
		for (const ev of result.emit) {
			transcript = applyBridgeEvent(transcript, ev);
			codeChanges = applyCodeChangeEvent(codeChanges, ev);
		}
		resync = result.resync;
		return {transcript, codeChanges, lastEventSeq, seqState: result.state, ack, resync};
	}
	transcript = applyBridgeEvent(transcript, event);
	codeChanges = applyCodeChangeEvent(codeChanges, event);
	return {transcript, codeChanges, lastEventSeq, seqState: null, ack, resync};
}
