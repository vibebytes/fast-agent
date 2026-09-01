import test from 'node:test';
import assert from 'node:assert/strict';
import {DeltaBatcher} from './DeltaBatcher.js';
import type {BridgeEvent} from './protocol.js';

test('DeltaBatcher passes non-delta events immediately', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e));

	batcher.push({type: 'turn_started', turnId: 'turn_1'} as BridgeEvent);
	batcher.push({type: 'tool_started', turnId: 'turn_1', id: 't1', tool: 'shell', args: {}} as BridgeEvent);

	assert.equal(emitted.length, 2);
	assert.equal(emitted[0]?.type, 'turn_started');
	assert.equal(emitted[1]?.type, 'tool_started');
	batcher.dispose();
});

test('DeltaBatcher coalesces consecutive same-type same-turnId deltas', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'hello '} as BridgeEvent);
	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'world'} as BridgeEvent);

	assert.equal(emitted.length, 0);
	batcher.flush();
	assert.equal(emitted.length, 1);
	assert.equal((emitted[0] as any).text, 'hello world');
	batcher.dispose();
});

test('DeltaBatcher does NOT coalesce different delta types', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'reasoning_delta', turnId: 'turn_1', text: 'thinking'} as BridgeEvent);
	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'answer'} as BridgeEvent);

	batcher.flush();
	assert.equal(emitted.length, 2);
	assert.equal(emitted[0]?.type, 'reasoning_delta');
	assert.equal(emitted[1]?.type, 'assistant_delta');
	batcher.dispose();
});

test('DeltaBatcher does NOT coalesce across agentRunId (subagent vs parent text)', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: '主回答'} as BridgeEvent);
	batcher.push({
		type: 'assistant_delta',
		turnId: 'turn_1',
		text: '子代理输出',
		agentRunId: 'run-a'
	} as BridgeEvent);
	batcher.push({
		type: 'assistant_delta',
		turnId: 'turn_1',
		text: '继续',
		agentRunId: 'run-a'
	} as BridgeEvent);

	batcher.flush();
	assert.equal(emitted.length, 2);
	assert.equal((emitted[0] as any).text, '主回答');
	assert.equal((emitted[0] as any).agentRunId, undefined);
	assert.equal((emitted[1] as any).text, '子代理输出继续');
	assert.equal((emitted[1] as any).agentRunId, 'run-a');
	batcher.dispose();
});

test('DeltaBatcher does NOT coalesce different turnIds', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'first '} as BridgeEvent);
	batcher.push({type: 'assistant_delta', turnId: 'turn_2', text: 'second'} as BridgeEvent);

	batcher.flush();
	assert.equal(emitted.length, 2);
	assert.equal((emitted[0] as any).turnId, 'turn_1');
	assert.equal((emitted[1] as any).turnId, 'turn_2');
	batcher.dispose();
});

test('DeltaBatcher flushes pending deltas when a non-delta arrives', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'partial'} as BridgeEvent);
	batcher.push({type: 'tool_started', turnId: 'turn_1', id: 't1', tool: 'shell', args: {}} as BridgeEvent);

	assert.equal(emitted.length, 2);
	assert.equal(emitted[0]?.type, 'assistant_delta');
	assert.equal((emitted[0] as any).text, 'partial');
	assert.equal(emitted[1]?.type, 'tool_started');
	batcher.dispose();
});

test('DeltaBatcher flushes on timer', async () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 20);

	batcher.push({type: 'assistant_delta', turnId: 'turn_1', text: 'timed'} as BridgeEvent);
	assert.equal(emitted.length, 0);

	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(emitted.length, 1);
	assert.equal((emitted[0] as any).text, 'timed');
	batcher.dispose();
});

test('DeltaBatcher dispose flushes pending', () => {
	const emitted: BridgeEvent[] = [];
	const batcher = new DeltaBatcher(e => emitted.push(e), 9999);

	batcher.push({type: 'reasoning_delta', turnId: 'turn_1', text: 'pending'} as BridgeEvent);
	assert.equal(emitted.length, 0);

	batcher.dispose();
	assert.equal(emitted.length, 1);
	assert.equal((emitted[0] as any).text, 'pending');
});
