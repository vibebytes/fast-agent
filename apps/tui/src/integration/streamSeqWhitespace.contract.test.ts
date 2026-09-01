import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bridgeEventSchema} from '@fastllm/bridge-protocol';
import {applyBridgeEvent, createTranscriptState, emptySessionSeq, offer} from '@fast-ide/session-view';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stream-seq-whitespace.ndjson');

test('whitespace NDJSON parses, stays contiguous, and projects exact text', () => {
	const lines = readFileSync(fixture, 'utf8').split(/\r?\n/).filter(l => l.trim());
	assert.ok(lines.length > 0, 'golden fixture must exist');
	let seq = emptySessionSeq();
	let state = applyBridgeEvent(createTranscriptState(), {type: 'turn_started', turnId: 'r1', text: 'go'});
	const texts: string[] = [];
	let sealed = '';
	for (const line of lines) {
		const event = bridgeEventSchema.parse(JSON.parse(line));
		const result = offer(seq, event);
		seq = result.state;
		for (const ev of result.emit) {
			state = applyBridgeEvent(state, ev);
			if (ev.type === 'assistant_delta') texts.push(ev.text);
			if (ev.type === 'checkpoint') texts.push(ev.content);
			if (ev.type === 'assistant_delta' || ev.type === 'checkpoint') {
				sealed = state.entries.find(e => e.role === 'assistant')?.text ?? '';
			}
		}
	}
	assert.equal(seq.lastApplied, 7);
	assert.equal(seq.syncing, false);
	assert.ok(texts.includes('）\n\n'));
	assert.ok(texts.includes('🙂'));
	assert.ok(texts.includes(' '));
	assert.ok(texts.includes(''));
	assert.ok(texts.includes('  hi  '));
	assert.equal(sealed, '）\n\n🙂   hi  ');
});
