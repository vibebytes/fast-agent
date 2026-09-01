import test from 'node:test';
import assert from 'node:assert/strict';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {createTuiStreamSeq} from './tuiStreamSeq.js';

function delta(seq: number, text: string): BridgeEvent {
	return {type: 'assistant_delta', text, eventSeq: seq};
}

test('1,3,2 emits 1 then 2,3 and lastApplied is 3', () => {
	const gate = createTuiStreamSeq();
	const a = gate.onEvent(delta(1, 'a'));
	const late = gate.onEvent(delta(3, 'c'));
	const b = gate.onEvent(delta(2, 'b'));
	assert.deepEqual(a.emit.map(e => e.type === 'assistant_delta' ? e.text : ''), ['a']);
	assert.deepEqual(late.emit, []);
	assert.equal(late.resync, true);
	assert.equal(late.lastApplied, 1);
	assert.deepEqual(b.emit.map(e => e.type === 'assistant_delta' ? e.text : ''), ['b', 'c']);
	assert.equal(gate.lastApplied, 3);
});

test('duplicate seq emits once', () => {
	const gate = createTuiStreamSeq();
	gate.onEvent(delta(1, 'a'));
	const first = gate.onEvent(delta(2, 'b'));
	const dup = gate.onEvent(delta(2, 'b'));
	assert.equal(first.emit.length, 1);
	assert.equal(dup.emit.length, 0);
	assert.equal(gate.lastApplied, 2);
});

test('isolated eventSeq 5 does not emit or advance', () => {
	const gate = createTuiStreamSeq();
	const r = gate.onEvent(delta(5, 'late'));
	assert.deepEqual(r.emit, []);
	assert.equal(r.lastApplied, 0);
	assert.equal(r.resync, true);
});

test('live UI does not advance lastApplied', () => {
	const gate = createTuiStreamSeq();
	const r = gate.onEvent({type: 'proc_updated', procId: 'p', status: 'running'});
	assert.equal(r.lastApplied, 0);
	assert.equal(r.emit[0]?.type, 'proc_updated');
	assert.equal(r.resync, false);
});
