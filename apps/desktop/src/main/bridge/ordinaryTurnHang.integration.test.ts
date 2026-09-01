/**
 * End-to-end Thin Client contract for ordinary-chat hang after explore:
 * Bridge wire shows tool_finished×2 ("Explored") but no turn_finished →
 * Composer Stop stays lit; CancelRun settlement clears it so the next submit works.
 *
 * Events mirror OrdinaryTurnBridgeGapSpec / real SessionEventStream NDJSON.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {SessionController} from './SessionController.js';
import {isSessionStreamEvent} from './sessionStreamEvents.js';
import {composerGate, applyBridgeEvent, createTranscriptState} from '@fast-ide/session-view';

function withSid(sessionId: string, event: BridgeEvent): BridgeEvent {
	if (!isSessionStreamEvent(event.type)) return event;
	return {...event, sessionId} as BridgeEvent;
}

test('Explored tools without turn_finished keeps Stop lit; Cancel unlocks submit', () => {
	const sent: BridgeCommand[] = [];
	const c = new SessionController({
		clientId: 'cli',
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		createId: (() => {
			let n = 0;
			return () => `cid-${++n}`;
		})()
	});
	const sessionId = 'sess-explore-hang';
	const runId = '019f-ordinary-explore-hang';
	const task = c.createTask('T');
	c.acceptNewSession(sessionId, task.id);
	c.handleEvent({type: 'Attached', sessionId, clientId: 'cli'});
	c.handleEvent({type: 'session_restored', sessionId, turns: []});

	assert.equal(c.sendMessage('你扫描下~/.agent/skills 目录看看 标准skill有没有这个字段'), true);

	const feed = (event: BridgeEvent) => c.handleEvent(withSid(sessionId, event));

	feed({type: 'input_accepted', clientMessageId: 'cid-1', turnId: 'cid-1'});
	feed({type: 'turn_started', turnId: 'cid-1', clientMessageId: 'cid-1', text: 'scan skills'});
	feed({type: 'input_accepted', clientMessageId: 'cid-1', turnId: runId});
	feed({
		type: 'tool_started',
		turnId: runId,
		id: 'tc-1',
		tool: 'list_dir',
		args: {path: join(homedir(), '.agents', 'skills')}
	});
	feed({
		type: 'tool_finished',
		turnId: runId,
		id: 'tc-1',
		tool: 'list_dir',
		success: true,
		fields: {output: 'grilling\n'}
	});
	feed({
		type: 'tool_started',
		turnId: runId,
		id: 'tc-2',
		tool: 'list_dir',
		args: {path: join(homedir(), '.agent', 'skills')}
	});
	feed({
		type: 'tool_finished',
		turnId: runId,
		id: 'tc-2',
		tool: 'list_dir',
		success: true,
		fields: {output: ''}
	});

	const gateAfterExplore = c.gate();
	assert.equal(gateAfterExplore.runState, 'running', 'Stop must stay lit after explored tools');
	assert.equal(gateAfterExplore.canCancel, true);
	assert.equal(gateAfterExplore.canSubmitNow, false);

	// Pure projection: Explored summary is visible while entry still streaming.
	let transcript = createTranscriptState();
	const apply = (e: BridgeEvent) => {
		transcript = applyBridgeEvent(transcript, withSid(sessionId, e));
	};
	apply({type: 'input_accepted', clientMessageId: 'cid-1', turnId: runId});
	apply({type: 'turn_started', turnId: runId, clientMessageId: 'cid-1', text: 'scan'});
	apply({
		type: 'tool_started',
		turnId: runId,
		id: 'tc-1',
		tool: 'list_dir',
		args: {path: join(homedir(), '.agents', 'skills')}
	});
	apply({
		type: 'tool_finished',
		turnId: runId,
		id: 'tc-1',
		tool: 'list_dir',
		success: true,
		fields: {output: 'x'}
	});
	apply({
		type: 'tool_started',
		turnId: runId,
		id: 'tc-2',
		tool: 'list_dir',
		args: {path: join(homedir(), '.agent', 'skills')}
	});
	apply({
		type: 'tool_finished',
		turnId: runId,
		id: 'tc-2',
		tool: 'list_dir',
		success: true,
		fields: {output: ''}
	});
	const g = composerGate(transcript, true);
	assert.equal(g.canCancel, true);
	assert.ok(transcript.activeRunId === runId || transcript.entries.some(e => e.status === 'streaming'));

	assert.equal(c.cancelRun(), true);
	c.handleEvent(withSid(sessionId, {type: 'turn_cancelled', turnId: runId, reason: 'user cancel'}));

	const gateAfterCancel = c.gate();
	assert.equal(gateAfterCancel.runState, 'idle');
	assert.equal(gateAfterCancel.canCancel, false);
	assert.equal(gateAfterCancel.canSubmitNow, true);

	sent.length = 0;
	assert.equal(c.sendMessage('继续对话'), true);
	assert.ok(sent.some(cmd => cmd.type === 'SubmitUserMessage'));
});
