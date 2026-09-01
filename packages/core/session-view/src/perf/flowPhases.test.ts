/**
 * Message-flow perf harness — phase attribution + sentinels
 * (docs/features/message-flow-performance.md 刀 1).
 *
 * Phases measured here (renderer-independent, pure session-view):
 *   P-a  domain projection  — applyBridgeEvent fold
 *   P-b  view projection    — projectSessionView per simulated frame
 *
 * Sentinels (all in the default gate):
 *   断言 2 (absolute cap)        — loose; env `FLOW_PERF_ABS_MS`
 *   断言 4 (reference stability) — head + approval item refs across a frame
 *   断言 1 (scaling / no-O(n²))  — baseline measurement (2026-08-02) shows
 *     1.7–2.3× at this base size (quadratic terms not yet dominant), so these
 *     run as always-on anti-regression rails; 刀 5 / 刀 6 acceptance uses the
 *     §8 baseline numbers in docs/features/message-flow-performance.md, not a
 *     red→green flip here.
 *
 * `FLOW_PERF_PRINT=1` prints a phase table for manual profiling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState, type TranscriptState} from '../transcriptProjection.js';
import {createSessionViewProjector} from '../sessionView.js';
import type {TimelineItem} from '../timeline.js';
import {syntheticOptionsFromEnv, syntheticSession, syntheticStreamingDelta, type SyntheticOptions} from './syntheticSession.js';

/** Events per simulated frame (coalesced-flush proxy). */
const FRAME_EVERY = 8;

/**
 * Stable codeChanges reference — the projector's frozen-head fast path keys on
 * reference identity (刀 5a), matching real callers (SessionPane passes the
 * store's identity-stable `transcript.codeChanges`). A fresh `[]` per frame
 * would silently disable the fast path and benchmark the slow path instead.
 */
const NO_CODE_CHANGES: never[] = [];

const PRINT = process.env.FLOW_PERF_PRINT === '1';
const ABS_CAP_MS = Number.parseInt(process.env.FLOW_PERF_ABS_MS ?? '2000', 10);

type PhaseResult = {
	paMs: number;
	pbMs: number;
	events: number;
	frames: number;
	state: TranscriptState;
	items: TimelineItem[];
	project: ReturnType<typeof createSessionViewProjector>;
};

function runPipeline(opts: SyntheticOptions): PhaseResult {
	const events = syntheticSession(opts);
	const project = createSessionViewProjector();
	let state = createTranscriptState();
	let paMs = 0;
	let pbMs = 0;
	let frames = 0;
	let items: TimelineItem[] = [];

	for (let i = 0; i < events.length; i++) {
		const t0 = performance.now();
		state = applyBridgeEvent(state, events[i]!);
		paMs += performance.now() - t0;

		if (i % FRAME_EVERY === FRAME_EVERY - 1 || i === events.length - 1) {
			const t1 = performance.now();
			items = project(
				{entries: state.entries, approvals: state.approvals, questions: state.questions},
				NO_CODE_CHANGES,
				{canCancel: true}
			);
			pbMs += performance.now() - t1;
			frames += 1;
		}
	}
	return {paMs, pbMs, events: events.length, frames, state, items, project};
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)]!;
}

type TimedPair = {small: number; large: number; ratio: number};

/**
 * Interleave small/large runs and gate on the median paired ratio. Running all
 * small samples before all large samples made thermal throttling or a competing
 * process look like a complexity regression (刀 6 review).
 */
function timedPair(
	smallOptions: SyntheticOptions,
	largeOptions: SyntheticOptions,
	phase: 'paMs' | 'pbMs',
	runs = 7
): TimedPair {
	runPipeline(smallOptions);
	runPipeline(largeOptions);
	const small: number[] = [];
	const large: number[] = [];
	const ratios: number[] = [];
	for (let i = 0; i < runs; i += 1) {
		const smallFirst = i % 2 === 0;
		const first = runPipeline(smallFirst ? smallOptions : largeOptions)[phase];
		const second = runPipeline(smallFirst ? largeOptions : smallOptions)[phase];
		const s = smallFirst ? first : second;
		const l = smallFirst ? second : first;
		small.push(s);
		large.push(l);
		ratios.push(l / s);
	}
	return {small: median(small), large: median(large), ratio: median(ratios)};
}

test('断言 2 — absolute cap: default synthetic session stays under the loose budget', () => {
	const opts = syntheticOptionsFromEnv();
	const r = runPipeline(opts);
	if (PRINT) {
		console.log(
			`[flow-perf] events=${r.events} frames=${r.frames} entries=${r.state.entries.length}\n` +
				`[flow-perf] P-a domain projection: ${r.paMs.toFixed(1)}ms\n` +
				`[flow-perf] P-b view projection:   ${r.pbMs.toFixed(1)}ms (${(r.pbMs / r.frames).toFixed(3)}ms/frame)`
		);
	}
	assert.ok(
		r.paMs + r.pbMs < ABS_CAP_MS,
		`P-a+P-b = ${(r.paMs + r.pbMs).toFixed(0)}ms exceeds cap ${ABS_CAP_MS}ms — catastrophic regression`
	);
});

test('断言 4 — reference stability: one streaming frame keeps head + approval item refs', () => {
	const opts = {
		...syntheticOptionsFromEnv(),
		turns: 10,
		deltasPerTurn: 30,
		approvals: 2
	};
	const r = runPipeline(opts);

	const before = r.items;
	let state = r.state;
	state = applyBridgeEvent(state, syntheticStreamingDelta(1000));
	const after = r.project(
		{entries: state.entries, approvals: state.approvals, questions: state.questions},
		NO_CODE_CHANGES,
		{canCancel: true}
	);

	// The live turn's rows (user + assistant) are the mutable tail: the user row
	// gets a fresh `withShowStop` object per projection and the assistant row is
	// streaming — both legitimately change. Everything else must keep identity.
	const liveTurnId = state.entries.at(-1)!.turnId!;
	const beforeById = new Map(before.map(i => [`${i.kind}-${i.id}`, i]));
	let checked = 0;
	for (const item of after) {
		// Segment ids embed the entry id (`seg-a-assistant-<turnId>-<n>`) — contains-match.
		if (item.id.includes(liveTurnId)) continue;
		if ('entryId' in item && String((item as {entryId?: string}).entryId).includes(liveTurnId)) continue;
		const prev = beforeById.get(`${item.kind}-${item.id}`);
		if (!prev) continue;
		assert.equal(prev, item, `item ${item.kind}-${item.id} lost reference identity across a streaming frame`);
		checked += 1;
	}
	assert.ok(checked > 10, `sanity: compared ${checked} stable items`);
	const approvalRefsBefore = before.filter(i => i.kind === 'approval');
	const approvalRefsAfter = after.filter(i => i.kind === 'approval');
	assert.equal(approvalRefsBefore.length, opts.approvals);
	for (let i = 0; i < approvalRefsBefore.length; i++) {
		assert.equal(approvalRefsBefore[i], approvalRefsAfter[i], 'pending approval item ref must not churn');
	}
});

// ── 断言 1 — scaling sentinels (anti-regression rails; see header note) ─────

const scalingBase: SyntheticOptions = {
	turns: 24,
	deltasPerTurn: 80,
	deltaLen: 40,
	toolsPerTurn: 2,
	approvals: 0,
	scale: 1
};

test('断言 1a — P-a no O(text²): doubling deltasPerTurn must stay < 4×', () => {
	const pair = timedPair(
		scalingBase,
		{...scalingBase, deltasPerTurn: scalingBase.deltasPerTurn * 2},
		'paMs'
	);
	if (PRINT) console.log(`[flow-perf] P-a scaling deltas×2: ${pair.small.toFixed(1)}ms → ${pair.large.toFixed(1)}ms (${pair.ratio.toFixed(2)}× paired median)`);
	assert.ok(pair.ratio < 4, `P-a quadratic in text: ×2 deltas took ${pair.ratio.toFixed(2)}× (limit 4×)`);
});

function longAssistantStreamMs(deltas: number): number {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'turn_started',
		turnId: 'long-stream',
		text: 'benchmark'
	});
	const t0 = performance.now();
	for (let i = 0; i < deltas; i += 1) {
		state = applyBridgeEvent(state, {
			type: 'assistant_delta',
			turnId: 'long-stream',
			text: String(i % 10).repeat(40)
		});
	}
	const elapsed = performance.now() - t0;
	assert.equal(state.entries.at(-1)?.text.length, deltas * 40);
	return elapsed;
}

function pairedLongAssistantStreamMs(smallDeltas: number, largeDeltas: number): TimedPair {
	longAssistantStreamMs(smallDeltas);
	longAssistantStreamMs(largeDeltas);
	const small: number[] = [];
	const large: number[] = [];
	const ratios: number[] = [];
	for (let i = 0; i < 7; i += 1) {
		const smallFirst = i % 2 === 0;
		const first = longAssistantStreamMs(smallFirst ? smallDeltas : largeDeltas);
		const second = longAssistantStreamMs(smallFirst ? largeDeltas : smallDeltas);
		const s = smallFirst ? first : second;
		const l = smallFirst ? second : first;
		small.push(s);
		large.push(l);
		ratios.push(l / s);
	}
	return {small: median(small), large: median(large), ratio: median(ratios)};
}

test('断言 1a-long — one very long Turn stays near-linear in delta count', () => {
	const pair = pairedLongAssistantStreamMs(4_000, 8_000);
	if (PRINT) console.log(`[flow-perf] P-a one-turn deltas×2: ${pair.small.toFixed(1)}ms → ${pair.large.toFixed(1)}ms (${pair.ratio.toFixed(2)}× paired median)`);
	assert.ok(pair.ratio < 3.2, `P-a long Turn regressed: ×2 deltas took ${pair.ratio.toFixed(2)}× (limit 3.2×)`);
});

function fixedTailProjectionMs(opts: SyntheticOptions, frames = 120): number {
	let state = createTranscriptState();
	for (const event of syntheticSession(opts)) state = applyBridgeEvent(state, event);
	const project = createSessionViewProjector();
	project(
		{entries: state.entries, approvals: state.approvals, questions: state.questions},
		NO_CODE_CHANGES,
		{canCancel: true}
	);
	let elapsed = 0;
	for (let frame = 0; frame < frames; frame += 1) {
		state = applyBridgeEvent(state, syntheticStreamingDelta(frame));
		const t0 = performance.now();
		project(
			{entries: state.entries, approvals: state.approvals, questions: state.questions},
			NO_CODE_CHANGES,
			{canCancel: true}
		);
		elapsed += performance.now() - t0;
	}
	return elapsed;
}

function pairedTailProjectionMs(
	smallOptions: SyntheticOptions,
	largeOptions: SyntheticOptions
): TimedPair {
	fixedTailProjectionMs(smallOptions);
	fixedTailProjectionMs(largeOptions);
	const small: number[] = [];
	const large: number[] = [];
	const ratios: number[] = [];
	for (let i = 0; i < 7; i += 1) {
		const smallFirst = i % 2 === 0;
		const first = fixedTailProjectionMs(smallFirst ? smallOptions : largeOptions);
		const second = fixedTailProjectionMs(smallFirst ? largeOptions : smallOptions);
		const s = smallFirst ? first : second;
		const l = smallFirst ? second : first;
		small.push(s);
		large.push(l);
		ratios.push(l / s);
	}
	return {small: median(small), large: median(large), ratio: median(ratios)};
}

test('断言 1b — P-b fixed-frame tail cost stays below quadratic in turn count', () => {
	const pair = pairedTailProjectionMs(scalingBase, {
		...scalingBase,
		turns: scalingBase.turns * 2
	});
	if (PRINT) console.log(`[flow-perf] P-b fixed 120 frames, turns×2: ${pair.small.toFixed(1)}ms → ${pair.large.toFixed(1)}ms (${pair.ratio.toFixed(2)}× paired median)`);
	assert.ok(pair.ratio < 3.2, `P-b per-frame cost regressed: ×2 turns took ${pair.ratio.toFixed(2)}× (limit 3.2×)`);
});
