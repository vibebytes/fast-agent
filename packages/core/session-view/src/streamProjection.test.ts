import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {projectStreamEvent} from './streamProjection.js';
import {createTranscriptState} from './transcriptProjection.js';
import {createCodeChangesState} from './codeChangesProjection.js';
import type {SessionSeq} from './sessionSeq.js';

const delta = (seq: number, text: string): BridgeEvent => ({
	type: 'assistant_delta',
	text,
	eventSeq: seq,
	unitId: '1:1'
});

test('seq path: ordered events apply, ack follows cursor, seqState returned', () => {
	let input = {
		transcript: createTranscriptState(),
		codeChanges: createCodeChangesState(),
		lastEventSeq: 0,
		seq: undefined as SessionSeq | undefined,
		seqSession: 's1' as string | undefined
	};
	const r1 = projectStreamEvent({...input, seq: undefined}, delta(1, 'a'));
	assert.equal(r1.lastEventSeq, 1);
	assert.equal(r1.ack, 1);
	assert.equal(r1.resync, false);
	assert.ok(r1.seqState);
	const r2 = projectStreamEvent(
		{...input, lastEventSeq: r1.lastEventSeq, seq: r1.seqState},
		delta(2, 'b')
	);
	assert.equal(r2.ack, 2);
});

test('seq path: hole holds emit and flags resync; no ack regression', () => {
	const first = projectStreamEvent(
		{
			transcript: createTranscriptState(),
			codeChanges: createCodeChangesState(),
			lastEventSeq: 0,
			seq: undefined,
			seqSession: 's1'
		},
		delta(1, 'a')
	);
	const hole = projectStreamEvent(
		{
			transcript: first.transcript,
			codeChanges: first.codeChanges,
			lastEventSeq: first.lastEventSeq,
			seq: first.seqState,
			seqSession: 's1'
		},
		delta(3, 'c')
	);
	assert.equal(hole.lastEventSeq, 1);
	assert.equal(hole.ack, null);
	assert.equal(hole.resync, true);
});

test('no seqSession: direct apply, null seqState, no ack', () => {
	const r = projectStreamEvent(
		{
			transcript: createTranscriptState(),
			codeChanges: createCodeChangesState(),
			lastEventSeq: 0,
			seq: undefined,
			seqSession: undefined
		},
		{type: 'turn_started', turnId: 't1', clientMessageId: 'm1', text: 'find tsx'}
	);
	assert.equal(r.lastEventSeq, 0);
	assert.equal(r.ack, null);
	assert.equal(r.seqState, null);
	assert.ok(r.transcript.entries.length >= 1);
});
