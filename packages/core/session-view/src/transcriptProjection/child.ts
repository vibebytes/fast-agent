/** transcriptProjection tests — agent_call / child_work. Loaded by transcriptProjection.test.ts. */
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

test('agent_call_started paints a running "agent: name" row; finished patches summary', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'delegate it'
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a1',
		name: 'researcher',
		depth: 1,
		runId: 'run-a'
	});

	const entry = state.entries.at(-1)!;
	const row = (entry.tools ?? []).find(t => t.agentRunId === 'run-a');
	assert.ok(row, 'delegation row exists');
	assert.equal(row.tool, 'agent: researcher');
	assert.equal(row.status, 'running');

	state = applyBridgeEvent(state, {
		type: 'agent_call_finished',
		turnId: 't1',
		agentId: 'a1',
		success: true,
		runId: 'run-a',
		resultSummary: '找到 3 处相关实现'
	});
	const done = (state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-a')!;
	assert.equal(done.status, 'success');
	assert.equal(done.output, '找到 3 处相关实现');

	const toolItem = toTimelineItems(state).find(
		i => i.kind === 'tool' && i.tool === 'agent: researcher'
	);
	assert.ok(toolItem, 'delegation row projects into the timeline');
});

test('L1 Goal agent_call with goalId updates goalFlow status and never paints a Subagent body card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: '启动'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'Goal 已启动'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(chromePostRun(state.chrome), true);

	// After chat settle, L1 agent_call still updates status (passes postRunTerminal).
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		agentId: 'a1',
		name: 'analyst',
		depth: 1,
		runId: 'run-step',
		goalId: 'g1',
		stepId: 'analyst'
	});
	const sealedEntry = state.entries.find(e => e.turnId === 't1' && e.role === 'assistant')!;
	assert.equal(sealedEntry.status, 'done');
	assert.equal(
		(sealedEntry.tools ?? []).some(t => t.agentRunId === 'run-step'),
		false,
		'no chat Subagent body card for L1 Goal step'
	);
	assert.equal(state.goalFlow?.goalId, 'g1');
	assert.equal(state.goalFlow?.members[0]?.name, 'analyst');
	assert.equal(state.goalFlow?.members[0]?.status, 'running');

	state = applyBridgeEvent(state, {
		type: 'agent_call_finished',
		agentId: 'a1',
		success: true,
		runId: 'run-step',
		goalId: 'g1',
		stepId: 'analyst',
		resultSummary: '行情报告完成'
	});
	assert.equal(state.goalFlow?.members[0]?.status, 'success');
	assert.equal(
		(state.entries.find(e => e.turnId === 't1' && e.role === 'assistant')!.tools ?? []).length,
		0
	);
});

test('non-Goal agent_call without goalId still paints a Subagent body card', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'delegate'});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a1',
		name: 'researcher',
		depth: 1,
		runId: 'run-a'
	});
	assert.ok(
		(state.entries.at(-1)?.tools ?? []).some(t => t.agentRunId === 'run-a'),
		'ordinary call_agent still gets a body card'
	);
	assert.equal(state.goalFlow, undefined);
});

test('subagent deltas are intercepted and never touch the main assistant', () => {
	// Their content reaches the card via the unified workload wire instead.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'delegate'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: '主回答'});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a1',
		name: 'analyst',
		depth: 1,
		runId: 'run-a'
	});

	const before = state;
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 't1',
		text: '子代理正文',
		agentId: 'a1',
		depth: 1,
		agentRunId: 'run-a'
	});
	assert.equal(state, before, 'subagent assistant delta does not mutate the transcript');
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't1',
		text: '让我想想',
		agentId: 'a1',
		depth: 1,
		agentRunId: 'run-a'
	});
	assert.equal(state, before, 'subagent reasoning delta does not mutate the transcript');
	assert.equal(state.entries.at(-1)!.text, '主回答');
});

test('child_work_changed is the unified card feed: preview body + terminal settle', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: '启动'});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a1',
		name: 'analyst',
		depth: 1,
		runId: 'run-step'
	});

	// Wire id is WorkId (`run:<bare>`); agentRunId stays bare — must still match.
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-step',
		title: 'analyst',
		status: 'running',
		outputPreview: '上证指数收于 3200 点'
	});
	assert.equal(
		(state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-step')?.output,
		'上证指数收于 3200 点'
	);
	assert.equal(state.entries.at(-1)!.text, '', 'main assistant text untouched');

	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-step',
		title: 'analyst',
		status: 'running',
		outputPreview: '$ python3 score_stocks.py\n计算中…'
	});
	const sealedRow = (state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-step')!;
	assert.equal(sealedRow.status, 'running');
	assert.equal(sealedRow.output, '$ python3 score_stocks.py\n计算中…');

	// LLM wait note rides child_work summary → row statusNote; next snapshot clears it.
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-step',
		title: 'analyst',
		status: 'running',
		summary: 'waiting llm 5s'
	});
	assert.equal(
		(state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-step')?.statusNote,
		'waiting llm 5s'
	);
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-step',
		title: 'analyst',
		status: 'running',
		outputPreview: '开始产出'
	});
	assert.equal(
		(state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-step')?.statusNote,
		undefined,
		'note cleared once output arrives'
	);

	// Terminal child_work settles the row even though agent_call_finished never arrives.
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-step',
		title: 'analyst',
		status: 'succeeded'
	});
	const settledRow = (state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-step')!;
	assert.equal(settledRow.status, 'success');
});

test('agent_call_started hydrates card from earlier child_work_changed', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: '启动'});
	// Hub can emit before the stream event that creates the Subagent row.
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:run-late',
		title: 'analyst',
		status: 'running',
		summary: 'waiting llm 5s',
		outputPreview: '预热输出'
	});
	assert.equal(
		(state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-late'),
		undefined,
		'no card row yet'
	);
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a1',
		name: 'analyst',
		depth: 1,
		runId: 'run-late'
	});
	const row = (state.entries.at(-1)!.tools ?? []).find(t => t.agentRunId === 'run-late')!;
	assert.equal(row.output, '预热输出');
	assert.equal(row.statusNote, 'waiting llm 5s');
});

test('agent_call_started adopts the parent call_agent tool row instead of duplicating', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'delegate it'
	});
	// Bridge renames the parent's call_agent ToolStarted to "agent: <name>".
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'call-1',
		tool: 'agent: coder',
		args: {name: 'coder'}
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		turnId: 't1',
		agentId: 'a2',
		name: 'coder',
		depth: 1,
		runId: 'run-b'
	});

	const tools = state.entries.at(-1)!.tools ?? [];
	assert.equal(tools.filter(t => t.tool === 'agent: coder').length, 1, 'no duplicate row');
	assert.equal(tools[0]!.agentRunId, 'run-b');

	state = applyBridgeEvent(state, {
		type: 'agent_call_finished',
		turnId: 't1',
		agentId: 'a2',
		success: false,
		runId: 'run-b',
		detail: 'cancelled: parent run cancelled'
	});
	const row = (state.entries.at(-1)!.tools ?? [])[0]!;
	assert.equal(row.status, 'error');
	assert.equal(row.output, 'cancelled: parent run cancelled');
});

test('replayed agent_call_started for a known runId is idempotent; same agent twice keys by runId', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started', turnId: 't1', agentId: 'a1', name: '风控员', depth: 1, runId: 'run-a'
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started', turnId: 't1', agentId: 'a1', name: '风控员', depth: 1, runId: 'run-a'
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_started', turnId: 't1', agentId: 'a1', name: '风控员', depth: 1, runId: 'run-b'
	});
	const rows = (state.entries.at(-1)!.tools ?? []).filter(t => t.tool === 'agent: 风控员');
	assert.equal(rows.length, 2);

	state = applyBridgeEvent(state, {
		type: 'agent_call_finished', turnId: 't1', agentId: 'a1', success: false, runId: 'run-a'
	});
	const after = (state.entries.at(-1)!.tools ?? []).filter(t => t.tool === 'agent: 风控员');
	assert.equal(after.find(t => t.agentRunId === 'run-a')?.status, 'error');
	assert.equal(after.find(t => t.agentRunId === 'run-b')?.status, 'running');
});

test('leaked agentRunId on define_agent finish still settles the parent row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'review'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'def-1',
		tool: 'define_agent',
		args: {name: 'reviewer'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'def-1',
		tool: 'define_agent',
		success: true,
		fields: {},
		agentRunId: 'run-main'
	});
	const row = (state.entries.at(-1)!.tools ?? []).find(t => t.id === 'def-1')!;
	assert.equal(row.status, 'success');
});

test('late tool_started with agentRunId cannot overwrite a successful define_agent', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'review'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'def-1',
		tool: 'define_agent',
		args: {name: 'reviewer'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'def-1',
		tool: 'define_agent',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'def-1',
		tool: 'define_agent',
		args: {name: 'reviewer'},
		agentRunId: 'run-main'
	});
	const row = (state.entries.at(-1)!.tools ?? []).find(t => t.id === 'def-1')!;
	assert.equal(row.status, 'success');
});

test('child-run tool_started with agentRunId stays off the parent tools list', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'review'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'rf-1',
		tool: 'read_file',
		args: {path: '/tmp/a'},
		agentRunId: 'run-child'
	});
	assert.equal((state.entries.at(-1)!.tools ?? []).length, 0);
});

// --- child_work_changed → unified LiveChildWork drawer rows ---

test('child_work_changed upserts subagent/run rows and drops terminal ones', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'running',
		summary: '核实最新 YC batch'
	});
	assert.equal(state.childWork?.length, 1);
	assert.equal(state.childWork?.[0]?.title, 'researcher');
	assert.equal(state.childWork?.[0]?.summary, '核实最新 YC batch');

	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'running',
		summary: '调研 AI 项目'
	});
	assert.equal(state.childWork?.length, 1, 'same id must upsert, not duplicate');
	assert.equal(state.childWork?.[0]?.summary, '调研 AI 项目');

	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'completed'
	});
	assert.equal(state.childWork?.length, 0, 'terminal status must drop the row');
});

test('two live sibling subagent child_work stay until one terminals', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-c1',
		title: 'subagent',
		status: 'running'
	});
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-c2',
		title: 'subagent',
		status: 'running'
	});
	assert.equal(state.childWork?.length, 2);
	assert.deepEqual(
		state.childWork?.map(w => w.id),
		['run-c1', 'run-c2']
	);

	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-c1',
		title: 'subagent',
		status: 'completed'
	});
	assert.equal(state.childWork?.length, 1);
	assert.equal(state.childWork?.[0]?.id, 'run-c2');
});

test('L1 Goal child_work keeps settled rows for drawer retention', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:step-1',
		title: 'goal-step:g1',
		status: 'running',
		goalId: 'g1',
		stepId: 'analyst',
		outputPreview: 'drafting…'
	});
	assert.equal(state.childWork?.[0]?.goalId, 'g1');
	assert.equal(state.childWork?.[0]?.stepId, 'analyst');
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run:step-1',
		title: 'goal-step:g1',
		status: 'succeeded',
		goalId: 'g1',
		stepId: 'analyst',
		outputPreview: 'done'
	});
	assert.equal(state.childWork?.length, 1, 'settled L1 Goal step stays in drawer');
	assert.equal(state.childWork?.[0]?.status, 'succeeded');
	assert.equal(state.childWork?.[0]?.outputPreview, 'done');
});

test('goalFlow does not downgrade a settled success when a late false finish arrives', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'agent_call_started',
		agentId: 'a1',
		name: 'analyst',
		depth: 1,
		runId: 'run-step',
		goalId: 'g1',
		stepId: 'analyst'
	});
	state = applyBridgeEvent(state, {
		type: 'agent_call_finished',
		agentId: 'a1',
		success: true,
		runId: 'run-step',
		goalId: 'g1'
	});
	assert.equal(state.goalFlow?.members[0]?.status, 'success');
	state = applyBridgeEvent(state, {
		type: 'agent_call_finished',
		agentId: 'a1',
		success: false,
		runId: 'run-step',
		goalId: 'g1',
		detail: 'goal finished'
	});
	assert.equal(state.goalFlow?.members[0]?.status, 'success');
});

test('child_work_changed skips kinds owned by richer surfaces (goal card / live proc)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'goal',
		id: 'goal-1',
		title: 'YC调研',
		status: 'running'
	});
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'proc',
		id: 'proc-1',
		title: 'npm test',
		status: 'running'
	});
	assert.equal(state.childWork?.length ?? 0, 0, 'goal/proc rows stay on their own surfaces');
});
test('child_work_changed replaces outputPreview (wire carries rolling tail)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'running',
		outputPreview: 'hello '
	});
	assert.equal(state.childWork?.[0]?.outputPreview, 'hello ');
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'running',
		outputPreview: 'hello world'
	});
	assert.equal(state.childWork?.[0]?.outputPreview, 'hello world');
	// Lifecycle without preview keeps the prior tail.
	state = applyBridgeEvent(state, {
		type: 'child_work_changed',
		kind: 'run',
		id: 'run-1',
		title: 'researcher',
		status: 'running',
		summary: 'still going'
	});
	assert.equal(state.childWork?.[0]?.outputPreview, 'hello world');
	assert.equal(state.childWork?.[0]?.summary, 'still going');
});
