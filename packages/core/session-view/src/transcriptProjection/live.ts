/** transcriptProjection tests — live deltas / prompts / drawers. Loaded by transcriptProjection.test.ts. */
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

test('run_done clears approvals/questions for that runId without a streaming entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'app_1',
		runId: 'run_1',
		tool: 'shell',
		description: 'test'
	});
	state = applyBridgeEvent(state, {
		type: 'question_requested',
		id: 'q_1',
		runId: 'run_1',
		question: 'test',
		options: [],
		allowCustom: true
	});
	assert.equal(state.approvals.length, 1);
	assert.equal(state.questions.length, 1);
	assert.equal(chromeRunId(state.chrome), 'run_1');
	state = applyBridgeEvent(state, {
		type: 'run_done',
		runId: 'run_1',
		success: true,
		summary: 'ok'
	});
	assert.equal(state.approvals.length, 0);
	assert.equal(state.questions.length, 0);
	assert.equal(chromeRunId(state.chrome), undefined);
	assert.ok(!chromePostRun(state.chrome));
});

test('approval_requested keeps optional note', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'app_1',
		runId: 'run_1',
		tool: 'write_file',
		description: 'write',
		context: '/tmp/a.txt',
		note: 'outside the session workspace'
	});
	assert.equal(state.approvals[0]?.note, 'outside the session workspace');
});

test('question_batch_requested upserts by rpcId and does not fill questions', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: 'run_1',
		rpcId: 'rpc-1',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	});
	assert.equal(state.questions.length, 0);
	assert.equal(state.questionBatches.length, 1);
	assert.equal(state.questionBatches[0]?.rpcId, 'rpc-1');
	const items = toTimelineItems(state);
	assert.equal(items.some(i => i.kind === 'question'), false);
	assert.equal(items.some(i => i.kind === 'question_batch'), true);
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: 'run_1',
		rpcId: 'rpc-1',
		questions: [{id: 'q1', question: 'Go now?', options: [{label: 'Yes'}, {label: 'No'}]}]
	});
	assert.equal(state.questionBatches.length, 1);
	assert.equal(state.questionBatches[0]?.questions[0]?.question, 'Go now?');
	state = applyBridgeEvent(state, {
		type: 'question_batch_resolved',
		runId: 'run_1',
		rpcId: 'rpc-1',
		outcome: 'answered'
	});
	assert.equal(state.questionBatches.length, 0);
});

test('empty-runId question_batch lands; parent terminal keeps it', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: '',
		rpcId: 'rpc-child',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	});
	assert.equal(state.questionBatches.length, 1);
	assert.equal(state.questionBatches[0]?.rpcId, 'rpc-child');
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(state.questionBatches.length, 1);
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'r1', success: true, summary: 'ok'});
	assert.equal(state.questionBatches.length, 1);
	assert.equal(composerGate(state, true).composerLocked, true);
});

test('run_done clears only the matching parent-runId question_batch', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: 'r1',
		rpcId: 'rpc-r1',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	});
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: 'r2',
		rpcId: 'rpc-r2',
		questions: [{id: 'q2', question: 'Stay?', options: [{label: 'No'}]}]
	});
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: '',
		rpcId: 'rpc-child',
		questions: [{id: 'q3', question: 'Child?', options: [{label: 'Ok'}]}]
	});
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'r1', success: true, summary: 'ok'});
	assert.deepEqual(
		state.questionBatches.map(q => q.rpcId).sort(),
		['rpc-child', 'rpc-r2']
	);
});

test('parent-runId question_batch clears on turn_finished', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'question_batch_requested',
		runId: 'r1',
		rpcId: 'rpc-parent',
		questions: [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}]
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(state.questionBatches.length, 0);
});

test('subagent_started upserts by childSessionId; finished stays', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'subagent_started',
		runId: 'r1',
		childSessionId: 'child-1',
		mode: 'one-shot',
		label: 'explore'
	});
	state = applyBridgeEvent(state, {
		type: 'subagent_started',
		runId: 'r1',
		childSessionId: 'child-1',
		mode: 'one-shot',
		label: 'explore again'
	});
	assert.equal(state.subagents.length, 1);
	assert.equal(state.subagents[0]?.label, 'explore again');
	state = applyBridgeEvent(state, {
		type: 'subagent_finished',
		childSessionId: 'child-1',
		status: 'completed'
	});
	assert.equal(state.subagents.length, 1);
	assert.equal(state.subagents[0]?.status, 'completed');
	const items = toTimelineItems(state);
	assert.equal(items.some(i => i.kind === 'subagent'), true);
});

test('subagent_updated preview replaces when present and keeps when omitted', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'subagent_started',
		runId: 'r1',
		childSessionId: 'child-1',
		mode: 'one-shot',
		label: 'explore'
	});
	state = applyBridgeEvent(state, {
		type: 'subagent_updated',
		childSessionId: 'child-1',
		activity: 'running',
		preview: 'read_file a'
	});
	assert.equal(state.subagents[0]?.preview, 'read_file a');
	state = applyBridgeEvent(state, {
		type: 'subagent_updated',
		childSessionId: 'child-1',
		activity: 'running'
	});
	assert.equal(state.subagents[0]?.preview, 'read_file a');
	state = applyBridgeEvent(state, {
		type: 'subagent_updated',
		childSessionId: 'child-1',
		activity: 'running',
		preview: ''
	});
	assert.equal(state.subagents[0]?.preview, '');
	const item = toTimelineItems(state).find(i => i.kind === 'subagent');
	assert.equal(item && item.kind === 'subagent' ? item.preview : undefined, '');
});
test('background_task_output accumulates LiveProc preview and survives postRunTerminal', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'p1',
		status: 'running',
		command: 'sbt compile',
		outFile: '/ws/.fast/artifacts/terminal/p1.log'
	});
	assert.equal(state.liveProcs?.length, 1);
	assert.equal(state.liveProcs?.[0]?.command, 'sbt compile');

	state = applyBridgeEvent(state, {
		type: 'background_task_output',
		procId: 'p1',
		text: 'compiling...\n'
	});
	state = applyBridgeEvent(state, {
		type: 'background_task_output',
		procId: 'p1',
		text: 'done\n'
	});
	assert.equal(state.liveProcs?.[0]?.outputPreview, 'compiling...\ndone\n');

	// Cancel/settlement must not drop P1 deltas for cross-run bg procs.
	state = {...state, chrome: runChromeTransition(state.chrome, {postRun: true})};
	state = applyBridgeEvent(state, {
		type: 'background_task_output',
		procId: 'p1',
		text: 'still-running\n'
	});
	assert.ok(state.liveProcs?.[0]?.outputPreview?.endsWith('still-running\n'));

	state = applyBridgeEvent(state, {
		type: 'background_task_completed',
		procId: 'p1',
		exitCode: 0
	});
	assert.equal(state.liveProcs?.length, 0);
});

test('appendProcPreview keeps only the tail', () => {
	const big = 'x'.repeat(LIVE_PROC_PREVIEW_MAX + 50);
	const out = appendProcPreview('', big);
	assert.equal(out.length, LIVE_PROC_PREVIEW_MAX);
	assert.equal(out, big.slice(-LIVE_PROC_PREVIEW_MAX));
});

test('Fg proc_updated enters liveProcs; status exit removes without needing cancelRun', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'fg-1',
		status: 'running',
		command: 'sbt compile',
		reason: undefined
	});
	assert.equal(state.liveProcs?.length, 1);
	assert.equal(state.liveProcs?.[0]?.procId, 'fg-1');

	// Drawer stop is KillProc → terminal proc_updated; must not clear via run cancel fields.
	state = {...state, chrome: runChromeTransition(state.chrome, {postRun: false})};
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'fg-1',
		status: 'killed',
		reason: 'user_stopped'
	});
	assert.equal(state.liveProcs?.length, 0);
	assert.equal(chromePostRun(state.chrome), false);
});
test('Fg natural exit (open/find) clears liveProcs via proc_updated exited', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'open-1',
		status: 'running',
		command: 'open /tmp/x'
	});
	assert.equal(state.liveProcs?.length, 1);
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'open-1',
		status: 'exited',
		command: 'open /tmp/x'
	});
	assert.equal(state.liveProcs?.length, 0);
});

test('late background_task_output does not resurrect cleared liveProcs', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'p-late',
		status: 'running',
		command: 'sbt test'
	});
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'p-late',
		status: 'exited'
	});
	assert.equal(state.liveProcs?.length, 0);
	state = applyBridgeEvent(state, {
		type: 'background_task_output',
		procId: 'p-late',
		text: 'straggler chunk\n'
	});
	assert.equal(state.liveProcs?.length, 0, 'output after exit must not re-add the row');
});

test('nextFireAtFromDetail parses next= ISO from TaskUpdated.detail', () => {
	assert.equal(nextFireAtFromDetail(undefined), undefined);
	assert.equal(nextFireAtFromDetail(''), undefined);
	assert.equal(nextFireAtFromDetail('next=2026-08-01T09:00:00Z'), '2026-08-01T09:00:00Z');
	assert.equal(nextFireAtFromDetail('cron=*/5 next=2026-08-01T09:00:00Z'), '2026-08-01T09:00:00Z');
});

test('task_updated projects liveTasks with nextFireAt; cancelled drops from drawer set', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'task_updated',
		taskId: 'job-1',
		kind: 'loop',
		status: 'armed',
		title: 'ci',
		detail: 'next=2026-08-01T09:00:00Z'
	});
	assert.equal(state.liveTasks?.length, 1);
	assert.equal(state.liveTasks?.[0]?.taskId, 'job-1');
	assert.equal(state.liveTasks?.[0]?.nextFireAt, '2026-08-01T09:00:00Z');
	assert.equal(state.liveTasks?.[0]?.kind, 'loop');

	state = applyBridgeEvent(state, {
		type: 'task_updated',
		taskId: 'job-1',
		kind: 'loop',
		status: 'paused',
		title: 'ci',
		detail: 'next=2026-08-01T10:00:00Z'
	});
	assert.equal(state.liveTasks?.[0]?.status, 'paused');
	assert.equal(state.liveTasks?.[0]?.nextFireAt, '2026-08-01T10:00:00Z');

	state = applyBridgeEvent(state, {
		type: 'task_updated',
		taskId: 'job-1',
		kind: 'loop',
		status: 'cancelled',
		title: 'ci'
	});
	assert.equal(state.liveTasks?.length, 0);
});

// --- Subagent delegation (agent_call_*) ---
test('assistant_delta keeps ）\\n\\n and opens a new segment on unitId change', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: '）\n\n', unitId: '1:1'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'next', unitId: '1:2'});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, '）\n\nnext');
	const units = (entry.segments ?? []).filter(s => s.kind === 'assistant');
	assert.equal(units.length, 2);
	assert.equal(units[0]?.kind === 'assistant' && units[0].text, '）\n\n');
	assert.equal(units[1]?.kind === 'assistant' && units[1].text, 'next');
});

test('assistant_delta persist full text replaces live prefix instead of appending', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hel'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello', eventSeq: 2});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, 'hello');
});

test('assistant_delta keeps live text when persist is a shorter prefix', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hel', eventSeq: 2});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, 'hello');
});

test('assistant_delta still appends a true incremental fragment', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hel'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'lo'});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, 'hello');
});

test('checkpoint replaces the matching unit and does not touch the next step', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'ab', unitId: '1:1'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'xy', unitId: '1:2'});
	state = applyBridgeEvent(state, {type: 'checkpoint', turnId: 't1', unitId: '1:1', content: 'abcd'});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, 'abcdxy');
	const units = (entry.segments ?? []).filter(s => s.kind === 'assistant');
	assert.equal(units[0]?.kind === 'assistant' && units[0].text, 'abcd');
	assert.equal(units[1]?.kind === 'assistant' && units[1].text, 'xy');
});

test('late checkpoint after turn_finished does not rewrite completed text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'partial', unitId: '1:1'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	state = applyBridgeEvent(state, {type: 'checkpoint', turnId: 't1', unitId: '1:1', content: 'FULL'});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.text, 'partial');
	assert.equal(entry.status, 'done');
});

test('dsh_tool_card attaches by callId and is preferred over generic', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'r1', text: 'hi'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 'r1',
		id: 'c-x',
		tool: 'web_search',
		args: {q: 'x'}
	});
	state = applyBridgeEvent(state, {
		type: 'dsh_tool_card',
		sessionId: 's1',
		runId: 'r1',
		callId: 'c-x',
		name: 'web_search',
		title: 'Search',
		args: {q: 'x'}
	});
	const tool = state.entries.find(e => e.role === 'assistant')?.tools?.[0];
	assert.equal(tool?.id, 'c-x');
	assert.equal(tool?.dshCard?.title, 'Search');
	assert.equal(tool?.tool, 'web_search');
});

test('dsh_goal_changed does not become a GoalUpdated transcript row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'dsh_goal_changed',
		sessionId: 's1',
		operation: 'create',
		phase: 'active',
		title: 'Ship',
		text: ''
	});
	assert.equal(state.entries.length, 0);
});

test('gap marks the streaming assistant incomplete', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'ab'});
	state = applyBridgeEvent(state, {type: 'gap', floor: 9});
	const entry = state.entries.find(e => e.role === 'assistant')!;
	assert.equal(entry.streamIncomplete, true);
	assert.equal(entry.text, 'ab');
});
test('stamped delta with an unknown turnId opens its own card instead of polluting another streaming row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-a',
		clientMessageId: 'client-a',
		text: 'question a'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-a', text: 'answer a'});
	// Foreign-turn delta: turnId matches no document/entry. It must not land in
	// run-a's streaming row via the lastDocumentId/activeRunId fallback.
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-b', text: 'answer b'});

	const cardA = state.entries.find(e => e.role === 'assistant' && e.turnId === 'run-a');
	assert.equal(cardA?.text, 'answer a');
	const cardB = state.entries.find(e => e.role === 'assistant' && e.turnId === 'run-b');
	assert.equal(cardB?.text, 'answer b');
	assert.equal(cardB?.status, 'streaming');
	// Follow-up deltas for the new turn keep appending to their own card.
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-b', text: ' more'});
	assert.equal(
		state.entries.find(e => e.role === 'assistant' && e.turnId === 'run-b')?.text,
		'answer b more'
	);
	assert.equal(
		state.entries.find(e => e.role === 'assistant' && e.turnId === 'run-a')?.text,
		'answer a'
	);
});

test('unstamped delta keeps the lastDocumentId fallback (live chrome)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-a',
		clientMessageId: 'client-a',
		text: 'question a'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', text: 'live '});
	state = applyBridgeEvent(state, {type: 'assistant_delta', text: 'chrome'});
	assert.equal(
		state.entries.find(e => e.role === 'assistant' && e.turnId === 'run-a')?.text,
		'live chrome'
	);
	assert.equal(state.entries.filter(e => e.role === 'assistant').length, 1);
});
