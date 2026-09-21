/** transcriptProjection tests — turn_finished / cancel / straggler. Loaded by transcriptProjection.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	appendProcPreview,
	applyBridgeEvent,
	applyLocalCancel,
	composerGate,
	createTranscriptState,
	formatActivitySummary,
	LIVE_PROC_PREVIEW_MAX,
	nextFireAtFromDetail,
	normalizeToolOutput,
	parseDiffWithLineNumbers,
	parseExitCode,
	resolveToolStatus,
	toTimelineItems
} from '../index.js';
import {runChromeTransition, chromeRunId, chromePostRun, chromeAwaitingSettlement} from '../runChrome.js';

test('Goal finished notice turn after postRunTerminal paints a new streaming turn', () => {
	// Plan Chat settles → postRunTerminal; Goal track no longer emits step fake turns.
	// The finished notice turn still clears the guard so the notice paints.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'plan-1',
		clientMessageId: 'plan-1',
		text: '/goal ship'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'plan-1',
		text: 'plan ready'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'plan-1', success: true});
	assert.equal(chromePostRun(state.chrome), true);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-g1-notice',
		clientMessageId: 'goal-g1-notice',
		text: ''
	});
	assert.equal(chromePostRun(state.chrome), false);
	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 'goal-g1-notice',
		text: 'Goal g1 passed — ok'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 'goal-g1-notice',
		success: true
	});
	const notice = state.entries.find(e => e.turnId === 'goal-g1-notice');
	assert.ok(notice);
	assert.equal(notice?.status, 'done');
	assert.equal(notice?.text, 'Goal g1 passed — ok');
});

test('turn_finished success:false with reason fills empty assistant text (no bare Error)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-fail',
		clientMessageId: 'm-fail',
		text: 'do something'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't-fail',
		id: 'c1',
		tool: 'goal',
		args: {action: 'status'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't-fail',
		id: 'c1',
		tool: 'goal',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 't-fail',
		success: false,
		reason: 'run failed: boom'
	});
	const assistant = state.entries.find(e => e.role === 'assistant' && e.turnId === 't-fail');
	assert.ok(assistant);
	assert.equal(assistant!.status, 'error');
	assert.equal(assistant!.text, 'run failed: boom');
});

test('error event fills assistant text but does not unlock Composer (host errors share the type)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-err',
		clientMessageId: 'm-err',
		text: 'continue'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'm-err',
		turnId: 'server-run-err'
	});
	assert.equal(chromeRunId(state.chrome), 'server-run-err');
	assert.equal(composerGate(state, true).runState, 'running');

	state = applyBridgeEvent(state, {
		type: 'error',
		turnId: 't-err',
		message: 'Replay failed: boom'
	});
	assert.equal(chromeRunId(state.chrome), 'server-run-err');
	const assistant = state.entries.find(
		e => e.role === 'assistant' && (e.turnId === 'server-run-err' || e.clientMessageId === 'm-err')
	);
	assert.equal(assistant?.status, 'error');
	assert.equal(assistant?.text, 'Replay failed: boom');
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true).canSubmitNow, false);

	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 't-err',
		success: false,
		reason: 'insufficient_quota'
	});
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canSubmitNow, true);
});

test('SkillSlash turn_finished arms postRunTerminal — straggler deltas must not re-light Stop', () => {
	// Real Bridge SkillSlash settle emits turn_finished WITHOUT turnId; the live
	// stream can still deliver assistant_delta/tool_* after skillF completes.
	// Without postRunTerminal, those stragglers reopen streaming → Stop stays lit
	// after the skill has already ended (user Fast IDE screenshot).
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client-1',
		turnId: 'client-1'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '/grilling'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client-1',
		turnId: 'host-run-1'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'host-run-1',
		text: '首要建议：把 codebase-design 作为通用语言权威。'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true, sessionId: 'sess'});
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.equal(state.entries[1]?.status, 'done');
	assert.equal(composerGate(state, true).canCancel, false);

	const textBefore = state.entries[1]?.text;
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'host-run-1',
		text: '\n(straggler after settle)'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 'host-run-1',
		id: 'ghost-tool',
		tool: 'shell',
		args: {command: 'echo x'}
	});
	assert.equal(state.entries[1]?.status, 'done');
	assert.equal(state.entries[1]?.text, textBefore);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false, 'Stop must stay off after SkillSlash end');
});

test('SkillSlash turn_finished drops reasoning/tool_output/file_read stragglers too', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c1',
		clientMessageId: 'c1',
		text: '/skill'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'c1',
		turnId: 'h1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'h1', text: 'done'});
	state = applyBridgeEvent(state, {type: 'turn_finished', success: true});
	const before = state.entries[1]?.text;
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'h1', text: 'late'});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: 'h1',
		id: 't1',
		tool: 'shell',
		stream: 'stdout',
		text: 'late-out'
	});
	state = applyBridgeEvent(state, {
		type: 'file_read',
		turnId: 'h1',
		path: 'x.ts',
		language: 'typescript',
		content: 'ghost'
	});
	assert.equal(state.entries[1]?.text, before);
	assert.equal(state.entries[1]?.reasoning ?? '', '');
	assert.equal((state.entries[1]?.tools ?? []).length, 0);
	assert.equal(composerGate(state, true).canCancel, false);
});

test('run_cancelled arms postRunTerminal so stragglers never create ghost entries', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'm1',
		text: 'q'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-1', text: 'a'});
	state = applyBridgeEvent(state, {
		type: 'run_cancelled',
		runId: 'run-1',
		reason: 'user'
	});
	assert.equal(chromePostRun(state.chrome), true);
	assert.equal(state.entries[1]?.status, 'cancelled');
	const count = state.entries.length;
	state = applyBridgeEvent(state, {type: 'reasoning_delta', text: 'straggler'});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'wrong-id',
		text: 'ghost'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		id: 'tc-ghost',
		tool: 'shell',
		args: {command: 'x'}
	});
	assert.equal(state.entries.length, count);
});

test('straggler guard lifts once the next turn starts', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'm1',
		text: 'q'
	});
	state = applyBridgeEvent(state, {
		type: 'run_cancelled',
		runId: 'run-1',
		reason: 'user'
	});
	assert.equal(chromePostRun(state.chrome), true);
	state = applyBridgeEvent(state, {type: 'reasoning_delta', text: 'straggler'});
	assert.equal(state.entries.filter(e => e.role === 'assistant').length, 1);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't2',
		clientMessageId: 'm2',
		text: 'again'
	});
	assert.equal(chromePostRun(state.chrome), false);
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't2',
		text: 'ok'
	});
	assert.equal(state.entries.at(-1)?.reasoning, 'ok');
});
test('foreign run_cancelled drops orphaned prompts for that run only', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-old',
		runId: 'run-old',
		tool: 'shell',
		description: 'old'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_new',
		clientMessageId: 'client_new',
		text: 'continue'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_new',
		turnId: 'run-new'
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-new',
		runId: 'run-new',
		tool: 'shell',
		description: 'new'
	});
	assert.equal(state.approvals.length, 2);
	state = applyBridgeEvent(state, {
		type: 'run_cancelled',
		runId: 'run-old',
		reason: 'superseded'
	});
	assert.equal(state.approvals.map(a => a.id).join(','), 'ap-new');
	assert.equal(chromeRunId(state.chrome), 'run-new');
	assert.equal(chromePostRun(state.chrome), false);
});

test('foreign run_cancelled (superseded prior) does not freeze the live Turn', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_new',
		clientMessageId: 'client_new',
		text: 'continue'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_new',
		turnId: 'run-new'
	});
	assert.equal(chromeRunId(state.chrome), 'run-new');
	state = applyBridgeEvent(state, {
		type: 'run_cancelled',
		runId: 'run-old',
		reason: 'superseded by new user message'
	});
	assert.equal(chromePostRun(state.chrome), false);
	assert.equal(chromeRunId(state.chrome), 'run-new');
	assert.equal(state.entries[1]?.status, 'streaming');
	assert.equal(state.entries[1]?.text, '');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-new',
		text: 'still answering'
	});
	assert.equal(state.entries[1]?.text, 'still answering');
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-new',
		tool: 'shell',
		description: 'run ls'
	});
	assert.equal(state.approvals.length, 1);
});

test('foreign turn_cancelled (superseded prior) does not freeze the live Turn', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_new',
		clientMessageId: 'client_new',
		text: 'continue'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_new',
		turnId: 'run-new'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-new',
		text: 'still answering'
	});
	assert.equal(chromeRunId(state.chrome), 'run-new');
	assert.equal(composerGate(state, true).canCancel, true);
	state = applyBridgeEvent(state, {
		type: 'turn_cancelled',
		turnId: 'run-old',
		reason: 'superseded by new user message'
	});
	assert.equal(chromePostRun(state.chrome), false, 'foreign cancel must not arm postRun');
	assert.equal(chromeRunId(state.chrome), 'run-new');
	assert.equal(state.entries[1]?.status, 'streaming');
	assert.equal(state.entries[1]?.text, 'still answering');
	assert.equal(composerGate(state, true).canCancel, true, 'Stop must stay lit on the live turn');
});
test('turn_finished resolves orphan running tools', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'ok',
		tool: 'shell',
		args: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'ok',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'orphan',
		tool: 'shell',
		args: {}
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	const tools = state.entries[1]?.tools ?? [];
	assert.equal(tools[0]?.status, 'success');
	assert.equal(tools[1]?.status, 'success', 'orphan running tool resolved to success');
	assert.equal(state.entries[1]?.status, 'done');
});
