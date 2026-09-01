/**
 * Message-flow perf harness — 断言 3: card-scenario render counting
 * (docs/features/message-flow-performance.md 刀 1).
 *
 * Implemented as a **production-comparator probe**: `TimelineRow` is
 * `memo(..., timelineRowPropsEqual)`, so "row re-renders" ⇔ "comparator
 * returns false for its props across frames". The probe rebuilds props each
 * frame exactly as SessionPane wires them and counts comparator misses —
 * deterministic, no React runtime.
 *
 * (Real component-tree render counting was attempted with RTL under both tsx
 * and vitest and hit dual-react-instance loader bugs — see the perf doc 刀 1
 * notes. If the toolchain gains a working component runner, this probe can be
 * complemented, not replaced: the comparator contract is still the gate.)
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	applyBridgeEvent,
	createSessionViewProjector,
	createTranscriptState,
	syntheticSession,
	syntheticStreamingDelta,
	type TimelineItem
} from '@fast-ide/session-view';
import {timelineRowPropsEqual, type TimelineRowProps} from './TimelineRow.js';
import {stablePlanBuildIds} from './timelineDerived.js';

const FRAMES = 100;

/** Stable reference — the projector fast path keys on codeChanges identity (刀 5a). */
const NO_CODE_CHANGES: never[] = [];
const PRINT = process.env.FLOW_PERF_PRINT === '1';

/** Stable identities, as SessionPane provides via useCallback. */
const onOpenFile = () => {};

// 刀 3-1 note: the question card's custom draft and the decision records live
// inside the cards (pendingDecisions store) — they no longer cross TimelineRow
// props, so typing / deciding cannot fail this comparator by construction.
function propsFor(item: TimelineItem, buildActivePlanIds: Set<string>): TimelineRowProps {
	return {
		item,
		decisionScope: 'perf-task',
		canCancel: true,
		showUserStop: false,
		onOpenFile,
		buildActivePlanIds
	};
}

test('断言 3 — pending-approval streaming: only live-turn rows fail the memo comparator across 100 frames', () => {
	let domain = createTranscriptState();
	for (const event of syntheticSession({
		turns: 8,
		deltasPerTurn: 20,
		deltaLen: 40,
		toolsPerTurn: 2,
		approvals: 2,
		scale: 1
	})) {
		domain = applyBridgeEvent(domain, event);
	}
	assert.equal(domain.approvals.length, 2, 'cards pending');

	const project = createSessionViewProjector();
	const projectFrame = () =>
		project(
			{entries: domain.entries, approvals: domain.approvals, questions: domain.questions},
			NO_CODE_CHANGES,
			{canCancel: true}
		);
	let planIds: Set<string> | null = null;
	let items = projectFrame();
	planIds = stablePlanBuildIds(items, planIds);
	let prevProps = new Map(items.map(i => [`${i.kind}-${i.id}`, propsFor(i, planIds!)]));

	const liveTurnId = domain.entries.at(-1)!.turnId!;
	const rerenderCounts = new Map<string, number>();

	for (let f = 0; f < FRAMES; f++) {
		domain = applyBridgeEvent(domain, syntheticStreamingDelta(f));
		items = projectFrame();
		planIds = stablePlanBuildIds(items, planIds);
		const nextProps = new Map(items.map(i => [`${i.kind}-${i.id}`, propsFor(i, planIds!)]));
		for (const [key, next] of nextProps) {
			const prev = prevProps.get(key);
			if (!prev) continue; // newly appeared row = mount, not re-render
			if (!timelineRowPropsEqual(prev, next)) {
				rerenderCounts.set(key, (rerenderCounts.get(key) ?? 0) + 1);
			}
		}
		prevProps = nextProps;
	}

	let liveRerenders = 0;
	const offenders: string[] = [];
	for (const [key, count] of rerenderCounts) {
		if (key.includes(liveTurnId)) liveRerenders += count;
		else offenders.push(`${key}:${count}`);
	}
	if (PRINT) {
		console.log(
			`[flow-perf] comparator probe: rows=${prevProps.size} liveRerenders=${liveRerenders}` +
				(offenders.length ? ` offenders=${offenders.slice(0, 5).join(',')}` : ' offenders=none')
		);
	}
	// Approval cards and every completed-turn row must be memo-stable.
	assert.deepEqual(offenders, [], 'rows outside the live turn would re-render');
	for (const [key] of rerenderCounts) {
		assert.ok(!key.startsWith('approval-'), `approval card ${key} would re-render`);
	}
	// Live-turn rows re-render at most ~once per frame (fence splits add rows, not extra misses).
	assert.ok(
		liveRerenders <= FRAMES * 4,
		`live-turn comparator misses ${liveRerenders} exceed budget ${FRAMES * 4}`
	);
	assert.ok(liveRerenders >= FRAMES, 'sanity: the streaming row must actually change per frame');
});

// 3b（打字场景）已由架构消除：custom 草稿收进 QuestionCard（刀 3-1），decision
// 记录走 pendingDecisions 外部 store（刀 3-2）——两者都不经过 TimelineRow props，
// 打字/点击在比较器契约下天然只影响那张卡；store 侧的跨卡片引用隔离由
// pendingDecisions.test.ts 覆盖。
