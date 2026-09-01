import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TimelineItem} from '@fast-ide/session-view';
import {
	AUTO_MARK_MS,
	NEAR_BOTTOM_PX,
	NEAR_TOP_PX,
	NESTED_WHEEL_GRACE_MS,
	FLOW_ONLY_MAX,
	FLOW_TAIL,
	estimateTimelineRowPx,
	flowContainIntrinsicBlockPx,
	flowContentVisibilityStyle,
	followWritePlan,
	groupTranscriptSections,
	isAutoScroll,
	isNearBottom,
	isNearTop,
	isNestedWheelArtifact,
	makeAutoMark,
	nestedScrollableConsumesWheel,
	prependWritePlan,
	remainingScrollPx,
	shrinkWritePlan,
	shouldIgnoreScrollProximity,
	stableTranscriptSections,
	transcriptFlowSplitAt,
	virtualRowRangesOverlap,
	virtualRowStartsFromSizes,
	wheelIntent
} from './transcriptScroll.js';

test('remainingScrollPx matches viewport math', () => {
	assert.equal(remainingScrollPx(1000, 800, 200), 0);
	assert.equal(remainingScrollPx(1000, 700, 200), 100);
});

test('isNearBottom uses threshold', () => {
	assert.equal(isNearBottom(79, NEAR_BOTTOM_PX), true);
	assert.equal(isNearBottom(80, NEAR_BOTTOM_PX), false);
});

test('isNearTop uses threshold', () => {
	assert.equal(isNearTop(0), true);
	assert.equal(isNearTop(119, NEAR_TOP_PX), true);
	assert.equal(isNearTop(120, NEAR_TOP_PX), false);
});

test('shouldIgnoreScrollProximity covers jump-to-latest settle window', () => {
	assert.equal(shouldIgnoreScrollProximity(1000, 999), true);
	assert.equal(shouldIgnoreScrollProximity(1000, 1000), false);
});

test('transcriptFlowSplitAt keeps all practical threads in document flow while absolute virtual is off', () => {
	assert.equal(transcriptFlowSplitAt(1), 0);
	assert.equal(transcriptFlowSplitAt(36), 0);
	assert.equal(transcriptFlowSplitAt(500), 0);
	assert.equal(FLOW_ONLY_MAX, Number.MAX_SAFE_INTEGER);
});

test('transcriptFlowSplitAt with explicit caps leaves a live flow tail', () => {
	const count = 80;
	const split = transcriptFlowSplitAt(count, 36, FLOW_TAIL);
	assert.equal(count - split, FLOW_TAIL);
});

test('estimateTimelineRowPx scales with assistant text without extreme bias', () => {
	const short = estimateTimelineRowPx({kind: 'assistant', text: 'ok'});
	const long = estimateTimelineRowPx({
		kind: 'assistant',
		text: 'x'.repeat(4000)
	});
	assert.ok(short >= 96);
	assert.ok(long > short);
	assert.ok(long <= 480);
});

test('flow containment exempts sticky user rows and contains reply rows', () => {
	assert.equal(flowContentVisibilityStyle({kind: 'user', text: 'prompt'}), undefined);
	assert.deepEqual(flowContentVisibilityStyle({kind: 'assistant', text: 'reply'}), {
		contentVisibility: 'auto',
		containIntrinsicBlockSize: 'auto 96px'
	});
});

test('flow intrinsic block estimate scales beyond the virtual-row height cap', () => {
	const short = flowContainIntrinsicBlockPx({kind: 'assistant', text: 'ok'});
	const longItem = {kind: 'assistant', text: 'x'.repeat(8_800)};
	const long = flowContainIntrinsicBlockPx(longItem);
	assert.equal(short, 96);
	assert.ok(long >= 2_000, `long assistant fallback ${long}px should approximate wrapped height`);
	assert.ok(long > estimateTimelineRowPx(longItem));
});

test('streaming intrinsic estimate does not rescan accumulated newline content', () => {
	const text = '\n'.repeat(8_800);
	const streaming = flowContainIntrinsicBlockPx({kind: 'assistant', text, status: 'streaming'});
	const sealed = flowContainIntrinsicBlockPx({kind: 'assistant', text, status: 'done'});
	assert.ok(streaming >= 2_000, 'length still reserves a useful live placeholder');
	assert.ok(sealed > streaming * 20, 'precise newline accounting is deferred until seal');
});

test('heavy completed shell/file rows reserve only their folded summary height', () => {
	const shell = flowContainIntrinsicBlockPx({
		kind: 'tool',
		tool: 'shell',
		command: 'pnpm test',
		status: 'success',
		output: Array.from({length: 21}, (_, i) => `line ${i}`).join('\n')
	});
	const file = flowContainIntrinsicBlockPx({
		kind: 'file',
		status: 'success',
		lines: Array.from({length: 48}, () => ({})),
		hidden: 153
	});
	assert.equal(shell, 48);
	assert.equal(file, 48);
	assert.equal(
		flowContainIntrinsicBlockPx({...({kind: 'tool'} as const), status: 'running', output: 'x'}),
		288,
		'running output never gets the folded estimate'
	);
});

test('open Thought/Exploring intrinsic height is the Live Ticker budget (not growing with text)', () => {
	const shortThought = flowContainIntrinsicBlockPx({
		kind: 'thought',
		open: true,
		text: 'hi'
	});
	const longThought = flowContainIntrinsicBlockPx({
		kind: 'thought',
		open: true,
		text: 'x'.repeat(8_000)
	});
	const openExploring = flowContainIntrinsicBlockPx({kind: 'exploring', open: true});
	assert.equal(shortThought, longThought);
	assert.equal(shortThought, openExploring);
	assert.ok(shortThought < 200, 'ticker budget stays compact');
	assert.equal(flowContainIntrinsicBlockPx({kind: 'thought', open: false}), 48);
});

test('virtualRowRangesOverlap catches stale flat estimates under tall content', () => {
	// Failure mode from the screenshot: every row estimated 120px but real
	// assistant blocks are ~600px → absolute translateY ranges collide.
	const staleStarts = [0, 120, 240];
	const realSizes = [600, 600, 200];
	assert.equal(virtualRowRangesOverlap(staleStarts, realSizes), true);

	const correctStarts = virtualRowStartsFromSizes(realSizes);
	assert.equal(virtualRowRangesOverlap(correctStarts, realSizes), false);
});

test('groupTranscriptSections binds each user prompt to following reply rows', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u1', text: 'one', isCommand: false},
		{kind: 'assistant', id: 'a1', text: 'ans1', status: 'done'},
		{kind: 'thought', id: 'th1', text: 't', chrome: {kind: 'done'}, open: false},
		{kind: 'user', id: 'u2', text: 'two', isCommand: false},
		{kind: 'tool', id: 't1', tool: 'shell', status: 'success', title: 'ls', command: 'ls', output: null, exitCode: null, summary: null}
	];
	const sections = groupTranscriptSections(items);
	assert.equal(sections.length, 2);
	assert.equal(sections[0]?.user?.id, 'u1');
	assert.deepEqual(
		sections[0]?.items.map(i => i.id),
		['a1', 'th1']
	);
	assert.equal(sections[1]?.user?.id, 'u2');
	assert.deepEqual(
		sections[1]?.items.map(i => i.id),
		['t1']
	);
});

// ── Follow-bottom state machine (刀 4) ──────────────────────────────────────

test('followWritePlan skips the write when already at bottom', () => {
	const atBottom = {scrollHeight: 1000, scrollTop: 800, clientHeight: 200};
	const plan = followWritePlan(atBottom, 5000);
	assert.equal(plan.write, false, 'no scrollTop write when remaining <= 1px');
	assert.equal(plan.mark.top, 800, 'mark still records expected bottom');
	assert.equal(plan.mark.until, 5000 + AUTO_MARK_MS);
});

test('followWritePlan writes when content grew past the bottom', () => {
	const grew = {scrollHeight: 1200, scrollTop: 800, clientHeight: 200};
	const plan = followWritePlan(grew, 0);
	assert.equal(plan.write, true);
	assert.equal(plan.mark.top, 1000, 'expected post-write top');
});

test('prependWritePlan preserves reading position only for a confirmed prepend', () => {
	const anchor = {scrollHeight: 1_000, scrollTop: 120, firstKey: 'user-oldest'};
	assert.deepEqual(prependWritePlan(anchor, 1_600, false, false), {
		consume: false
	}, 'an append racing the history request must not move the viewport');
	assert.deepEqual(prependWritePlan(anchor, 1_600, true, false), {
		consume: true,
		scrollTop: 720
	});
});

test('prependWritePlan consumes a stale anchor without moving while following', () => {
	const anchor = {scrollHeight: 1_000, scrollTop: 120, firstKey: 'user-oldest'};
	assert.deepEqual(prependWritePlan(anchor, 1_600, true, true), {consume: true});
});

test('shrinkWritePlan keeps the bottom gap constant when victim rows vanish', () => {
	const before = {scrollHeight: 10_000, scrollTop: 5_000, clientHeight: 1_000};
	const after = {scrollHeight: 9_400, scrollTop: 5_000, clientHeight: 1_000};
	assert.deepEqual(shrinkWritePlan(before, after, false), {
		write: true,
		scrollTop: 4_400
	});
});

test('shrinkWritePlan skips growth, following, and noise', () => {
	const before = {scrollHeight: 10_000, scrollTop: 5_000, clientHeight: 1_000};
	assert.deepEqual(
		shrinkWritePlan(before, {scrollHeight: 10_500, scrollTop: 5_000, clientHeight: 1_000}, false),
		{write: false},
		'growth is not a shrink'
	);
	assert.deepEqual(
		shrinkWritePlan(before, {scrollHeight: 9_400, scrollTop: 5_000, clientHeight: 1_000}, true),
		{write: false},
		'stick-to-bottom owns the viewport'
	);
	assert.deepEqual(
		shrinkWritePlan(null, {scrollHeight: 9_400, scrollTop: 5_000, clientHeight: 1_000}, false),
		{write: false},
		'no baseline yet'
	);
	assert.deepEqual(
		shrinkWritePlan(before, {scrollHeight: 9_999, scrollTop: 5_000, clientHeight: 1_000}, false),
		{write: false},
		'sub-pixel noise'
	);
});

test('isAutoScroll matches our own write within tolerance and window', () => {
	const mark = makeAutoMark({scrollHeight: 1200, scrollTop: 800, clientHeight: 200}, 1000);
	assert.equal(isAutoScroll(mark, 1000, 1100), true, 'exact top inside window');
	assert.equal(isAutoScroll(mark, 1002, 1100), true, 'within 2px tolerance');
	assert.equal(isAutoScroll(mark, 900, 1100), false, 'user moved elsewhere');
	assert.equal(isAutoScroll(mark, 1000, 1000 + AUTO_MARK_MS + 1), false, 'window expired');
	assert.equal(isAutoScroll(null, 1000, 1100), false, 'no mark');
});

test('wheelIntent: wheel-up leaves follow unless inside a nested scrollable', () => {
	assert.equal(wheelIntent(-10, false), 'leave-follow');
	assert.equal(wheelIntent(-10, true), 'nested');
	assert.equal(wheelIntent(10, false), 'none', 'wheel-down never leaves follow');
	assert.equal(wheelIntent(0, false), 'none');
});

test('nested scroll exemption applies only while the inner region can consume the wheel', () => {
	const middle = {scrollHeight: 500, scrollTop: 100, clientHeight: 200};
	assert.equal(nestedScrollableConsumesWheel(middle, -10), true);
	assert.equal(nestedScrollableConsumesWheel(middle, 10), true);
	assert.equal(
		nestedScrollableConsumesWheel({...middle, scrollTop: 0}, -10),
		false,
		'wheel-up at inner top belongs to the Transcript'
	);
	assert.equal(
		nestedScrollableConsumesWheel({...middle, scrollTop: 300}, 10),
		false,
		'wheel-down at inner bottom belongs to the Transcript'
	);
});

test('isNestedWheelArtifact suppresses outer unstick briefly after nested wheel', () => {
	assert.equal(isNestedWheelArtifact(1000, 1000 + NESTED_WHEEL_GRACE_MS), true);
	assert.equal(isNestedWheelArtifact(1000, 1000 + NESTED_WHEEL_GRACE_MS + 1), false);
});

// ── Frozen-head sections (刀 5b) ─────────────────────────────────────────────

const u = (id: string): TimelineItem => ({kind: 'user', id, text: id, isCommand: false});
const a = (id: string, text = 'x'): TimelineItem => ({kind: 'assistant', id, text, status: 'done'});

test('stableTranscriptSections reuses unchanged prefix section objects', () => {
	const u1 = u('u1');
	const a1 = a('a1');
	const u2 = u('u2');
	const first = stableTranscriptSections([u1, a1, u2, a('a2', 'v1')], null);
	const second = stableTranscriptSections([u1, a1, u2, a('a2', 'v2')], first);
	assert.equal(second.sections.length, 2);
	assert.equal(second.sections[0], first.sections[0], 'frozen section keeps object identity');
	assert.notEqual(second.sections[1], first.sections[1], 'live section rebuilt');
	assert.equal(
		(second.sections[1]!.items[0] as {text?: string}).text,
		'v2',
		'rebuilt section carries new content'
	);
});

test('stableTranscriptSections output stays deep-equal to groupTranscriptSections', () => {
	const u1 = u('u1');
	const a1 = a('a1');
	let prev = stableTranscriptSections([u1, a1], null);
	const grown = [u1, a1, u('u2'), a('a2'), a('a3')];
	prev = stableTranscriptSections(grown, prev);
	assert.deepEqual(prev.sections, groupTranscriptSections(grown), 'identity reuse must not change content');
});

test('stableTranscriptSections rebuilds a prefix section when an inner item changes (diff arrival)', () => {
	const u1 = u('u1');
	const u2 = u('u2');
	const first = stableTranscriptSections([u1, a('a1', 'old'), u2, a('a2')], null);
	const changed = [u1, a('a1', 'patched'), u2, a('a2')];
	const second = stableTranscriptSections(changed, first);
	assert.notEqual(second.sections[0], first.sections[0], 'changed head section must rebuild');
	assert.deepEqual(second.sections, groupTranscriptSections(changed));
});

test('groupTranscriptSections keeps leading non-user rows in a lead section', () => {
	const items: TimelineItem[] = [
		{kind: 'system', id: 's1', text: 'hi', tone: 'info'},
		{kind: 'user', id: 'u1', text: 'ask', isCommand: false}
	];
	const sections = groupTranscriptSections(items);
	assert.equal(sections.length, 2);
	assert.equal(sections[0]?.user, null);
	assert.equal(sections[0]?.items[0]?.id, 's1');
	assert.equal(sections[1]?.user?.id, 'u1');
});
