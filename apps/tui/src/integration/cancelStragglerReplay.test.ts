/**
 * Cancel-straggler storm at the reducer/timeline seam (the /CancelRun
 * screenshot regression): after the engine confirms run_cancelled, an
 * in-flight LLM stream can keep leaking reasoning/assistant/tool events —
 * typically WITHOUT a turnId, because the bridge already cleared its turn
 * context — while every extra Esc press produces another CancelRun ACK.
 *
 * The engine now suppresses post-cancel events at the source (RunEntity),
 * but the UI must stay correct against any engine that doesn't (older
 * engines, replayed session logs). ui-cancel-straggler.jsonl is therefore
 * hand-authored at the protocol boundary, not pinned from the Scala engine.
 *
 * Expected UX, asserted here and pixel-level in ptyCancelStraggler.test.ts:
 *   - stragglers never resurface as ghost "Thought"/answer turns;
 *   - CancelRun ACKs stay log-only (run_cancelled settles the turn — no cards);
 *   - no agent row spins in the live region after the cancel;
 *   - the <Static> settled-prefix invariant holds after every event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bridgeEventSchema, type BridgeEvent} from '../rpc/protocol.js';
import {initialState, type UiState} from '../state/model.js';
import {reducer} from '../state/reducer.js';
import {turnsToTimeline} from '../state/timeline/turnAdapter.js';
import type {TimelineItem} from '../state/timeline/model.js';

const fixturePath = path.join(
	path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ui-cancel-straggler.jsonl');

function fixtureEvents(): BridgeEvent[] {
	return readFileSync(fixturePath, 'utf8')
		.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
		.map(line => {
			const {payload} = JSON.parse(line) as {payload: unknown};
			const parsed = bridgeEventSchema.safeParse(payload);
			assert.ok(parsed.success, `fixture event violates protocol schema: ${line}`);
			return parsed.data;
		});
}

function settledJson(items: TimelineItem[]): string[] {
	return items.filter(item => item.pending !== true).map(item => JSON.stringify(item));
}

function replay(): UiState {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'} as BridgeEvent});
	state = reducer(state, {type: 'submit_user', text: '安装 libreoffice', clientMessageId: 'client-e2e'});

	let prevSettled = settledJson(turnsToTimeline(state).items);
	for (const [index, event] of fixtureEvents().entries()) {
		state = reducer(state, {type: 'engine_event', event});
		const items = turnsToTimeline(state).items;

		const ids = items.map(item => item.id);
		assert.equal(new Set(ids).size, ids.length, `duplicate timeline ids after #${index} (${event.type})`);

		const settledNow = settledJson(items);
		assert.deepEqual(settledNow.slice(0, prevSettled.length), prevSettled,
			`settled prefix mutated after #${index} (${event.type}) — printed scrollback would be corrupted`);
		prevSettled = settledNow;
	}
	return state;
}

test('cancel-straggler replay: ghosts dropped, one cancel card, no live agent rows', () => {
	const state = replay();

	const assistants = state.transcript.entries.filter(e => e.role === 'assistant');
	assert.equal(assistants.length, 1, 'stragglers must not create ghost turns');
	assert.equal(assistants[0]?.status, 'cancelled');
	assert.ok(!(assistants[0]?.reasoning ?? '').includes('GHOST'), 'post-cancel thoughts must not reach the transcript');
	assert.ok(!(assistants[0]?.text ?? '').includes('GHOST'), 'post-cancel answer text must not reach the transcript');

	// CancelRun ACKs are host-protocol log-only (run_cancelled already settles the
	// turn) — see reducer.test「repeated CancelRun host ACKs never spawn transcript cards」.
	const cancelCards = state.localTurns.flatMap(turn =>
		turn.systemMessages.filter(message => message.kind === 'command_result' && message.commandName === 'CancelRun'));
	assert.equal(cancelCards.length, 0, 'CancelRun ACKs must stay log-only (no transcript cards)');

	assert.equal(state.agentRuns.length, 0, 'no agent row may keep spinning after the cancel');
	assert.equal(state.running, false);
	assert.equal(state.inputMode, 'normal');

	const items = turnsToTimeline(state).items;
	assert.ok(!items.some(item => JSON.stringify(item).includes('GHOST')),
		'no ghost content may reach the timeline');
});
