/**
 * Message-flow perf harness — desktop-side phases
 * (docs/features/message-flow-performance.md 刀 1).
 *
 *   P-c  main-process diff proxy — pointer-diff scan + structuredClone of the
 *        tail patch (IPC serialization stand-in) + payload byte size
 *   P-d  renderer merge          — workspaceStore `transcript:tailPatched`
 *   P-e  derived                 — stablePlanBuildIds / transcriptScrollKey /
 *                                  groupTranscriptSections per frame
 *
 * Loose absolute cap only (`FLOW_PERF_ABS_MS`); asymptote sentinels live in
 * packages/session-view/src/perf/flowPhases.test.ts. `FLOW_PERF_PRINT=1`
 * prints the phase table.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	applyBridgeEvent,
	createSessionViewProjector,
	createTranscriptState,
	syntheticOptionsFromEnv,
	syntheticSession,
	syntheticStreamingDelta,
	type TranscriptEntry,
	type TranscriptState
} from '@fast-ide/session-view';
import {
	initialWorkspaceState,
	reduceWorkspace,
	type WorkspaceEvent,
	type WorkspaceState
} from '../workspaceStore.js';
import {flowContentVisibilityStyle, groupTranscriptSections} from '../transcriptScroll.js';
import {stablePlanBuildIds, transcriptScrollKey} from './timelineDerived.js';

const PRINT = process.env.FLOW_PERF_PRINT === '1';
const ABS_CAP_MS = Number.parseInt(process.env.FLOW_PERF_ABS_MS ?? '2000', 10);
const FRAMES = 100;

/** Stable reference — the projector fast path keys on codeChanges identity (刀 5a). */
const NO_CODE_CHANGES: never[] = [];

const gate = {
	runState: 'running' as const,
	canSubmitNow: false,
	canEnqueue: true,
	canCancel: true,
	composerLocked: false,
	lockReason: null
};

function foldSynthetic(): TranscriptState {
	let state = createTranscriptState();
	for (const event of syntheticSession(syntheticOptionsFromEnv())) {
		state = applyBridgeEvent(state, event);
	}
	return state;
}

/** Pointer-diff scan mirroring `publishTranscriptTail` (uiPublisher.ts). */
function tailDiff(prev: TranscriptEntry[], next: TranscriptEntry[]): {from: number; tail: TranscriptEntry[]} {
	let from = 0;
	const shared = Math.min(prev.length, next.length);
	while (from < shared && next[from] === prev[from]) from += 1;
	return {from, tail: next.slice(from)};
}

test('P-c/P-d/P-e — desktop phases stay under the loose budget over 100 streaming frames', () => {
	let domain = foldSynthetic();
	const taskId = 'perf-task';

	// Renderer store base: one full patch (cold hydrate), then tail patches.
	const seed: WorkspaceEvent[] = [
		{
			type: 'workspace:focus',
			payload: {
				focusEpoch: 1,
				activeProjectId: 'p1',
				activeTaskId: taskId,
				activeKind: 'task',
				projects: [],
				tasks: [{id: taskId, title: 'perf', active: true}],
				chats: [],
				defaultTasks: [],
				gate,
				model: 'default',
				modelDisplay: 'Default',
				modelCatalog: [],
				queue: [],
				queuePaused: false
			}
		} as unknown as WorkspaceEvent,
		{
			type: 'transcript:patched',
			payload: {
				taskId,
				entries: domain.entries,
				approvals: domain.approvals,
				questions: domain.questions,
				codeChanges: [],
				gate
			}
		} as unknown as WorkspaceEvent
	];
	let store: WorkspaceState = seed.reduce((s, e) => reduceWorkspace(s, e), initialWorkspaceState());
	assert.ok(store.byTaskId[taskId]!.entries.length > 0, 'store hydrated');

	const project = createSessionViewProjector();
	let planIds: Set<string> | null = null;
	let pcMs = 0;
	let pdMs = 0;
	let peMs = 0;
	let bytes = 0;

	for (let f = 0; f < FRAMES; f++) {
		const prevEntries = domain.entries;
		domain = applyBridgeEvent(domain, syntheticStreamingDelta(f));

		// P-c: pointer diff + structured clone (IPC stand-in) + payload size.
		const t0 = performance.now();
		const {from, tail} = tailDiff(prevEntries, domain.entries);
		const patch = {taskId, from, total: domain.entries.length, entries: tail, gate};
		const cloned = structuredClone(patch);
		pcMs += performance.now() - t0;
		if (f === FRAMES - 1) bytes = JSON.stringify(cloned).length;

		// P-d: renderer merge of the tail patch.
		const t1 = performance.now();
		store = reduceWorkspace(store, {
			type: 'transcript:tailPatched',
			payload: patch
		} as unknown as WorkspaceEvent);
		pdMs += performance.now() - t1;

		// P-e: derived values per frame (SessionPane / VirtualTranscript path).
		const t2 = performance.now();
		const body = store.byTaskId[taskId]!;
		const timeline = project(
			{entries: body.entries, approvals: body.approvals, questions: body.questions},
			NO_CODE_CHANGES,
			{canCancel: true}
		);
		planIds = stablePlanBuildIds(timeline, planIds);
		transcriptScrollKey(timeline);
		const sections = groupTranscriptSections(timeline);
		const liveSection = sections.at(-1);
		if (liveSection?.user) flowContentVisibilityStyle(liveSection.user);
		for (const item of liveSection?.items ?? []) flowContentVisibilityStyle(item);
		peMs += performance.now() - t2;
	}

	const merged = store.byTaskId[taskId]!.entries;
	assert.equal(merged.length, domain.entries.length, 'store converged with domain');
	assert.equal(merged.at(-1)!.text, domain.entries.at(-1)!.text, 'streamed text merged');

	if (PRINT) {
		console.log(
			`[flow-perf] desktop frames=${FRAMES} entries=${domain.entries.length}\n` +
				`[flow-perf] P-c diff+clone: ${pcMs.toFixed(1)}ms (${(pcMs / FRAMES).toFixed(3)}ms/frame, last patch ${bytes}B)\n` +
				`[flow-perf] P-d merge:      ${pdMs.toFixed(1)}ms (${(pdMs / FRAMES).toFixed(3)}ms/frame)\n` +
				`[flow-perf] P-e derived:    ${peMs.toFixed(1)}ms (${(peMs / FRAMES).toFixed(3)}ms/frame)`
		);
	}
	assert.ok(
		pcMs + pdMs + peMs < ABS_CAP_MS,
		`P-c+P-d+P-e = ${(pcMs + pdMs + peMs).toFixed(0)}ms exceeds cap ${ABS_CAP_MS}ms`
	);
});
