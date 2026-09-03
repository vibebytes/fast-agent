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
} from './index.js';

test('Exploring search rows prefer pattern over full path', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'find tsx'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'g1',
		tool: 'glob',
		args: {
			pattern: '**/*.tsx',
			path: '/tmp/repo'
		}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'g1',
		tool: 'glob',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'g2',
		tool: 'grep',
		args: {pattern: 'SlashChip', path: '/tmp/repo/apps'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'g2',
		tool: 'grep',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'ok'});

	const exploring = toTimelineItems(state).find(i => i.kind === 'exploring');
	assert.ok(exploring && exploring.kind === 'exploring');
	assert.deepEqual(
		exploring.tools.map(t => ({title: t.title, summary: t.summary})),
		[
			{title: 'glob **/*.tsx', summary: 'tmp/repo'},
			{title: 'grep SlashChip', summary: 'repo/apps'}
		]
	);
});

test('Exploring path-only rows do not repeat the path as secondary text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'read it'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		args: {path: 'src/TimelineRow.tsx'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		success: true,
		fields: {}
	});

	const exploring = toTimelineItems(state).find(i => i.kind === 'exploring');
	assert.ok(exploring && exploring.kind === 'exploring');
	assert.deepEqual(exploring.tools[0], {
		id: 'r1',
		tool: 'read_file',
		title: 'read src/TimelineRow.tsx',
		status: 'success',
		summary: null
	});
});

test('toTimelineItems merges adjacent exploring groups into a single Exploring item', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'find files'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		args: {path: 'a.ts'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r2',
		tool: 'read_file',
		args: {path: 'b.ts'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r2',
		tool: 'read_file',
		success: true,
		fields: {}
	});

	const explorings = toTimelineItems(state).filter(i => i.kind === 'exploring');
	assert.equal(explorings.length, 1);
	assert.equal(explorings[0]?.summary, 'Explored 2 files');
});

test('toTimelineItems groups consecutive explore tools into Exploring', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'find it'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'search'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		args: {path: 'a.ts'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'g1',
		tool: 'grep',
		args: {pattern: 'foo'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'g1',
		tool: 'grep',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		args: {command: 'ls'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r2',
		tool: 'list_dir',
		args: {path: '.'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r2',
		tool: 'list_dir',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'found'});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	// Sealed thought + 2 sealed exploring groups => processStack (≥3 sealed steps)
	assert.equal(items[0]?.kind, 'processStack');
});

test('toTimelineItems emits chronological thoughts for think → tool → think', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'research'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'first plan'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'shell1',
		tool: 'shell',
		args: {command: 'ls'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'shell1',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'second plan'});

	// Completed shell tool + sealed thought = 2 sealed steps -> processStack; streaming thought stays outside
	let items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'thought']
	);
	const stack = items[0];
	assert.ok(stack && stack.kind === 'processStack');
	const firstThought = stack.steps.find(s => s.kind === 'thought');
	assert.equal(firstThought?.kind === 'thought' ? firstThought.text : '', 'first plan');

	const streamingThought = items[1];
	assert.ok(streamingThought && streamingThought.kind === 'thought');
	assert.equal(streamingThought.text, 'second plan');
	assert.equal(streamingThought.open, true);
	assert.equal(streamingThought.chrome.kind, 'open');

	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'done'});
	items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant']
	);
});

test('transcript projection appends user turn and streams reasoning/assistant', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'hello'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'think '});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'more'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hi'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: ' there'});
	state = applyBridgeEvent(state, {type: 'final_answer', turnId: 't1', text: 'hi there'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});

	assert.equal(state.entries.length, 2);
	assert.equal(state.entries[0]?.role, 'user');
	assert.equal(state.entries[0]?.text, 'hello');
	assert.equal(state.entries[1]?.role, 'assistant');
	assert.equal(state.entries[1]?.reasoning, 'think more');
	assert.equal(state.entries[1]?.text, 'hi there');
	assert.equal(state.entries[1]?.status, 'done');
});

test('live assistant segment ids stay unique across turns', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'one'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'first'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't2',
		clientMessageId: 'm2',
		text: 'two'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't2', text: 'second'});

	const items = toTimelineItems(state);
	const assistantIds = items.filter(i => i.kind === 'assistant').map(i => i.id);
	assert.deepEqual(assistantIds, ['seg-a-assistant-t1-0', 'seg-a-assistant-t2-0']);
	assert.equal(new Set(assistantIds).size, assistantIds.length);
});

test('assistant preamble appears before tools in timeline', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'check mem'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 't1',
		text: '我先看一下内存占用。'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		args: {command: 'ps aux', description: 'List processes'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		success: true,
		fields: {exit: '0'}
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 't1',
		text: '结果如下。'
	});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['assistant', 'tool', 'assistant']
	);
	assert.equal(items[0] && items[0].kind === 'assistant' ? items[0].text : '', '我先看一下内存占用。');
	assert.equal(items[2] && items[2].kind === 'assistant' ? items[2].text : '', '结果如下。');
});

test('timeline shows entry.text when segments only have tools (orphan preamble)', () => {
	const state = createTranscriptState();
	const entry = {
		id: 'assistant-orphan',
		role: 'assistant' as const,
		text: '我先列一下目录',
		reasoning: '',
		status: 'done' as const,
		turnId: 't1',
		tools: [
			{
				id: 's1',
				tool: 'shell',
				args: {command: 'ls'},
				status: 'success' as const,
				output: ''
			}
		],
		segments: [{kind: 'tools' as const, id: 'seg-t', toolIds: ['s1']}]
	};
	const items = toTimelineItems({
		...state,
		entries: [entry]
	}).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['assistant', 'tool']
	);
	assert.equal(items[0] && items[0].kind === 'assistant' ? items[0].text : '', '我先列一下目录');
});

test('toTimelineItems orders thought → exploring → file → assistant', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'edit it'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'plan edits'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		args: {path: 'a.ts'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'r1',
		tool: 'read_file',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'e1',
		tool: 'FILE_EDIT',
		args: {path: 'App.tsx'}
	});
	const diff = [
		'@@ -1,2 +1,3 @@',
		' keep',
		'-old',
		'+new',
		'+more'
	].join('\n');
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'e1',
		tool: 'FILE_EDIT',
		success: true,
		fields: {diff}
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'done'});

	const items = toTimelineItems(state, {fileDiffs: {e1: diff}});
	const kinds = items.map(i => i.kind);
	assert.deepEqual(
		kinds.filter(k => k !== 'user'),
		['processStack', 'file', 'assistant']
	);
	const stack = items.find(i => i.kind === 'processStack');
	assert.ok(stack && stack.kind === 'processStack');
	const exploring = stack.steps.find(s => s.kind === 'exploring');
	assert.ok(exploring && exploring.kind === 'exploring');
	assert.match(exploring.summary, /Explored 1 file/);
	const thought = stack.steps.find(s => s.kind === 'thought');
	assert.ok(thought && thought.kind === 'thought');
	assert.ok(
		thought.chrome.kind === 'brief' || thought.chrome.kind === 'duration',
		`sealed thought chrome, got ${thought.chrome.kind}`
	);

	const file = items.find(i => i.kind === 'file');
	assert.ok(file && file.kind === 'file');
	assert.equal(file.path, 'App.tsx');
	assert.equal(file.op, 'edit');
	assert.ok(file.add >= 1);
	assert.ok(file.lines.some(l => l.type === 'add'));
});

test('formatActivitySummary matches Cursor phrasing', () => {
	assert.equal(
		formatActivitySummary({explored: 14, searched: 1, fetched: 1, edited: 0}),
		'Explored 14 files, 1 search, 1 fetch'
	);
});

test('parseDiffWithLineNumbers assigns add/del numbers', () => {
	const lines = parseDiffWithLineNumbers('@@ -10,2 +10,3 @@\n keep\n-old\n+new\n');
	assert.equal(lines.find(l => l.type === 'del')?.type, 'del');
	assert.equal(lines.find(l => l.type === 'add' && l.type === 'add')?.type, 'add');
});

test('normalizeToolOutput extracts output from tool_result wrapper', () => {
	const raw = `<tool_result name="shell" success="true">
output: bash: /bin/ps: Operation not permitted

summary: bash: /bin/ps: Operation not permitted

</tool_result>`;
	assert.equal(normalizeToolOutput(raw), 'bash: /bin/ps: Operation not permitted');
	// Without exit / failed status, Bridge success wins (pipeline exit 0 case).
	assert.equal(resolveToolStatus({eventSuccess: true, raw}), 'success');
	assert.equal(normalizeToolOutput('plain ok\n'), 'plain ok');
});

test('normalizeToolOutput unwraps JSON objects and literal newlines', () => {
	const jsonPayload = JSON.stringify({
		status: 'exited',
		outputPreview: 'line1\\nline2\\nline3',
		exitCode: 0
	});
	assert.equal(normalizeToolOutput(jsonPayload), 'line1\nline2\nline3');
	assert.equal(parseExitCode(undefined, jsonPayload), 0);

	const malformed = [
		'{"status":"exited","outputPreview":"line1',
		'line2',
		'line3","outFile":"/tmp/tool.log","exitCode":7,"reason":null}'
	].join('\n');
	assert.equal(normalizeToolOutput(malformed), 'line1\nline2\nline3');
	assert.equal(parseExitCode(undefined, malformed), 7);
});

test('shell tool event chain projects outputPreview instead of its JSON envelope', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-shell',
		clientMessageId: 'm-shell',
		text: 'inspect postgres'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't-shell',
		id: 'shell-1',
		tool: 'shell',
		args: {command: 'find modules/runtime/storage/postgres/src -name "*.scala"'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: 't-shell',
		id: 'shell-1',
		tool: 'shell',
		stream: 'stdout',
		text:
			'{"status":"exited","outputPreview":"modules/runtime/storage/postgres/src/A.scala:7:object A\\nmodules/runtime/storage/postgres/src/B.scala:9:object B","exitCode":0}'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't-shell',
		id: 'shell-1',
		tool: 'shell',
		success: true,
		fields: {}
	});

	const tool = toTimelineItems(state).find(i => i.kind === 'tool');
	assert.ok(tool && tool.kind === 'tool');
	assert.equal(
		tool.output,
		[
			'modules/runtime/storage/postgres/src/A.scala:7:object A',
			'modules/runtime/storage/postgres/src/B.scala:9:object B'
		].join('\n')
	);
});

test('resolveToolStatus prefers exit code over Bridge success', () => {
	assert.equal(parseExitCode({exit: '1'}), 1);
	assert.equal(
		resolveToolStatus({eventSuccess: true, fields: {exit: '1'}}),
		'error'
	);
	assert.equal(
		resolveToolStatus({eventSuccess: false, fields: {exit: '0'}}),
		'success'
	);
	assert.equal(
		resolveToolStatus({
			eventSuccess: true,
			raw: '<tool_result name="shell" success="false">\nerror: exit=127\n</tool_result>'
		}),
		'error'
	);
	assert.equal(parseExitCode(undefined, 'error: exit=127'), 127);
	assert.equal(
		resolveToolStatus({eventSuccess: true, fields: {status: 'failed'}}),
		'error'
	);
});

test('tool_finished normalizes wrapped shell output into timeline', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'ps'
	});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		args: {command: 'ps', description: 'List processes'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_output',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		stream: 'stdout',
		text: `<tool_result name="shell" success="false">
output: bash: /bin/ps: Operation not permitted

summary: bash: /bin/ps: Operation not permitted

</tool_result>`
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		success: false,
		fields: {exit: '1'}
	});

	const tool = state.entries[1]?.tools?.[0];
	assert.equal(tool?.output, 'bash: /bin/ps: Operation not permitted');
	assert.equal(tool?.status, 'error');
	assert.equal(tool?.exitCode, '1');

	const item = toTimelineItems(state).find(i => i.kind === 'tool');
	assert.ok(item && item.kind === 'tool');
	assert.equal(item.output, 'bash: /bin/ps: Operation not permitted');
	assert.equal(item.title, 'List processes');
	assert.equal(item.exitCode, '1');
});

test('input_accepted sets activeRunId to server Run id; local cancel awaits turn_cancelled', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	// Peer/local turn_started pins activeRunId immediately so Composer Gate can enqueue.
	assert.equal(state.activeRunId, 'client_1');
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	assert.equal(state.activeRunId, 'client_1');
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	});
	assert.equal(state.activeRunId, '019f-server-run');

	state = applyLocalCancel(state);
	assert.equal(state.awaitingCancelSettlement, true);
	assert.equal(state.entries[1]?.status, 'cancelled');
	assert.equal(state.activeRunId, '019f-server-run', 'run id kept until settlement for diagnostics');

	// Late accept after local cancel must NOT unlock before turn_cancelled
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: '019f-server-run'
	});
	assert.equal(state.awaitingCancelSettlement, true);

	state = applyBridgeEvent(state, {type: 'turn_cancelled', reason: 'user cancel'});
	assert.equal(state.awaitingCancelSettlement, false);
	assert.equal(state.activeRunId, undefined);
});

test('full-answer assistant_delta that re-emits streamed text is ignored', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'q'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello world'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'hello world'});
	assert.equal(state.entries[1]?.text, 'hello world');
});

test('long assistant stream preserves immutable snapshots and mirrored segment text', () => {
	let state = applyBridgeEvent(createTranscriptState(), {
		type: 'turn_started',
		turnId: 'long',
		clientMessageId: 'long',
		text: 'q'
	});
	const chunks = Array.from({length: 1_000}, (_, i) => `${i % 10}x`);
	for (const text of chunks) {
		state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'long', text});
	}

	const before = state;
	const beforeAssistant = before.entries[1]!;
	const next = applyBridgeEvent(before, {
		type: 'assistant_delta',
		turnId: 'long',
		text: 'tail'
	});
	const expected = `${chunks.join('')}tail`;
	const assistant = next.entries[1]!;
	const assistantSegment = assistant.segments?.at(-1);

	assert.equal(before.entries[1], beforeAssistant);
	assert.equal(beforeAssistant.text, chunks.join(''), 'prior snapshot must not observe the next delta');
	assert.equal(next.entries[0], before.entries[0], 'settled user prefix keeps object identity');
	assert.notEqual(assistant, beforeAssistant, 'changed assistant remains a new object for tail diff');
	assert.equal(assistant.text, expected);
	assert.equal(assistantSegment?.kind, 'assistant');
	assert.equal(assistantSegment?.text, expected);
});

test('double input_accepted: entry id stays stable; deltas route via server turnId', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	const entryId = state.entries[1]?.id;
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'server-uuid-1'
	});
	assert.equal(state.entries[1]?.id, entryId, 'entry id must not change after remap');
	assert.equal(state.entries[1]?.turnId, 'server-uuid-1');
	assert.equal(state.activeRunId, 'server-uuid-1');

	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 'server-uuid-1',
		text: 'thinking'
	});
	assert.equal(state.entries[1]?.reasoning, 'thinking');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'server-uuid-1',
		text: 'reply'
	});
	assert.equal(state.entries[1]?.text, 'reply');
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 'server-uuid-1',
		success: true
	});
	assert.equal(state.entries[1]?.status, 'done');
});

test('double input_accepted: later turn_started does not duplicate entries', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client_1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'client_1'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		clientMessageId: 'client_1',
		turnId: 'server-uuid-1'
	});
	const before = state.entries.length;
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'server-uuid-1',
		clientMessageId: 'client_1',
		text: 'go'
	});
	assert.equal(state.entries.length, before);
	assert.equal(state.entries[1]?.turnId, 'server-uuid-1');
});

test('local cancel blocks late deltas from mutating cancelled entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'hello'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'partial'});
	state = applyLocalCancel(state);
	assert.equal(state.entries[1]?.status, 'cancelled');
	const textBefore = state.entries[1]?.text;
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: ' late'});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't1',
		text: 'ghost'
	});
	assert.equal(state.entries[1]?.text, textBefore);
	assert.equal(state.entries[1]?.reasoning ?? '', '');
	assert.equal(state.entries.length, 2);
});

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
	assert.equal(state.postRunTerminal, true);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-g1-notice',
		clientMessageId: 'goal-g1-notice',
		text: ''
	});
	assert.equal(state.postRunTerminal, false);
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
	assert.equal(state.activeRunId, 'server-run-err');
	assert.equal(composerGate(state, true).runState, 'running');

	state = applyBridgeEvent(state, {
		type: 'error',
		turnId: 't-err',
		message: 'Replay failed: boom'
	});
	assert.equal(state.activeRunId, 'server-run-err');
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
	assert.equal(state.activeRunId, undefined);
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
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.activeRunId, undefined);
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
	assert.equal(state.postRunTerminal, true);
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
	assert.equal(state.postRunTerminal, true);
	state = applyBridgeEvent(state, {type: 'reasoning_delta', text: 'straggler'});
	assert.equal(state.entries.filter(e => e.role === 'assistant').length, 1);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't2',
		clientMessageId: 'm2',
		text: 'again'
	});
	assert.equal(state.postRunTerminal, false);
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 't2',
		text: 'ok'
	});
	assert.equal(state.entries.at(-1)?.reasoning, 'ok');
});

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
	assert.equal(state.activeRunId, 'run_1');
	state = applyBridgeEvent(state, {
		type: 'run_done',
		runId: 'run_1',
		success: true,
		summary: 'ok'
	});
	assert.equal(state.approvals.length, 0);
	assert.equal(state.questions.length, 0);
	assert.equal(state.activeRunId, undefined);
	assert.ok(!state.postRunTerminal);
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
	assert.equal(state.activeRunId, 'run-new');
	assert.equal(state.postRunTerminal, false);
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
	assert.equal(state.activeRunId, 'run-new');
	state = applyBridgeEvent(state, {
		type: 'run_cancelled',
		runId: 'run-old',
		reason: 'superseded by new user message'
	});
	assert.equal(state.postRunTerminal, false);
	assert.equal(state.activeRunId, 'run-new');
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

test('session_restored mid-run keeps the in-flight streaming entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'turn_live',
		clientMessageId: 'client_live',
		text: '继续构建'
	});
	state = applyBridgeEvent(state, {
		type: 'reasoning_delta',
		turnId: 'turn_live',
		text: '思考中'
	});
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.ok(state.entries.some(e => e.turnId === 'restored_0'));
	const live = state.entries.find(e => e.turnId === 'turn_live' && e.role === 'assistant');
	assert.equal(live?.status, 'streaming');
	assert.equal(live?.reasoning, '思考中');
});

test('session_restored with live turn in snapshot does not duplicate', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'turn_live',
		clientMessageId: 'client_live',
		text: '继续构建'
	});
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{turnId: 'restored_0', userText: '旧问题', assistantText: '旧回答'},
			{turnId: 'turn_live', userText: '继续构建', assistantText: '部分内容已落盘'}
		],
		hasMoreOlder: false,
		totalTurnCount: 2
	});
	const liveUsers = state.entries.filter(e => e.role === 'user' && e.turnId === 'turn_live');
	const liveAssistants = state.entries.filter(e => e.role === 'assistant' && e.turnId === 'turn_live');
	assert.equal(liveUsers.length, 1, 'live user should not duplicate');
	assert.equal(liveAssistants.length, 1, 'live assistant should not duplicate');
	assert.equal(liveAssistants[0]?.status, 'streaming');
	assert.equal(
		liveAssistants[0]?.text,
		'部分内容已落盘',
		'Attach restore must paint persisted prose onto the empty live row (restart-visible today)'
	);
	const all = toTimelineItems(state);
	const assistantItems = all.filter(
		(i): i is Extract<(typeof all)[number], {kind: 'assistant'}> =>
			i.kind === 'assistant' && i.text.trim() !== ''
	);
	assert.ok(
		assistantItems.some(i => i.text.includes('部分内容已落盘')),
		'live timeline must show restored prose without a UI remount'
	);
});

test('prior turn_finished must not drop the next live turn prose', () => {
	// User sent the same prompt twice while the first run was still settling.
	// turn_finished used to arm postRunTerminal unconditionally and swallow the
	// second turn's assistant_delta — live UI showed two user bubbles and no body.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-1',
		clientMessageId: 'client-1',
		text: '我们不讨论实施，只讨论哪个方案更好'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-2',
		clientMessageId: 'client-2',
		text: '我们不讨论实施，只讨论哪个方案更好'
	});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		1
	);
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-1', success: true});
	assert.equal(state.postRunTerminal, false, 'a still-streaming turn must keep the content gate open');
	assert.equal(state.activeRunId, 'run-2');
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-2',
		text: 'Engine → EngineRuntime → EngineSession 更好。'
	});
	const live = state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant');
	assert.equal(live?.text, 'Engine → EngineRuntime → EngineSession 更好。');
	assert.equal(live?.status, 'streaming');
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-2', success: true});
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.entries.find(e => e.turnId === 'run-2' && e.role === 'assistant')?.status, 'done');
});

test('final_answer after empty settle still paints the body', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: '只讨论方案'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'compare layers'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(state.postRunTerminal, true);
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, '');
	assert.equal(state.entries.find(e => e.role === 'assistant')?.reasoning, 'compare layers');
	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 't1',
		text: '用三层生命周期拆 Engine。'
	});
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.text, '用三层生命周期拆 Engine。');
	assert.equal(assistant?.reasoning, 'compare layers', 'thinking must survive empty-settle seed');
	assert.equal(assistant?.status, 'done', 'filling empty prose must not relight Stop');
	assert.ok(toTimelineItems(state).some(i => i.kind === 'assistant' && i.text.includes('三层生命周期')));
});

test('stray stream after restore never mutates a completed restored entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: 'old', assistantText: 'done text'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	const restored = state.entries.find(e => e.role === 'assistant');
	assert.equal(restored?.text, 'done text');
	const before = restored?.text;
	// Homeless deltas: shared projection drops them (no ghost synthesize).
	state = applyBridgeEvent(state, {type: 'reasoning_delta', text: 'stray'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', text: 'stray a'});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.text, before);
	assert.equal(state.entries.filter(e => e.role === 'assistant').length, 1);
});

test('cold session_restored settles so attach-replay TurnStarted does not relight Stop', () => {
	let state = createTranscriptState();
	state = {...state, activeRunId: 'stale-run', awaitingCancelSettlement: true};
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'review 下这个开发计划',
				assistantText: '## Findings\n总结：计划可落地。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
	assert.equal(state.activeRunId, undefined);
	assert.equal(state.awaitingCancelSettlement, false);
	assert.equal(state.postRunTerminal, true, 'settled restore must arm the straggler guard');
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);

	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run-9', text: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'empty persist TurnStarted must not spawn a streaming row after cold restore'
	);
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('session_restored keeps background_wake origin on the user entry for wake styling', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'm1',
				userText: 'Background task(s) finished (1). Continue from these results:\n- procId=p exitCode=0',
				assistantText: '已继续处理后台结果',
				origin: 'background_wake'
			},
			{turnId: 'm2', userText: '普通提问', assistantText: '回答'}
		],
		hasMoreOlder: false,
		totalTurnCount: 2
	});
	assert.equal(
		state.entries.find(e => e.turnId === 'm1' && e.role === 'user')?.origin,
		'background_wake'
	);
	assert.equal(state.entries.find(e => e.turnId === 'm2' && e.role === 'user')?.origin, undefined);
});

test('settled restore + persist TurnStarted with user text must not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [
			{
				turnId: 'restored_0',
				userText: '继续完成啊',
				assistantText: '剩余 3 项 [~] 及原因'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		text: '继续完成啊',
		eventSeq: 80
	});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'persist opener with the restored prompt must not spawn a new streaming row'
	);
	assert.equal(state.activeRunId, undefined);
	assert.equal(state.postRunTerminal, true);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('persist TurnStarted with eventSeq must not fill an empty user row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'ok'
	});
	state = {
		...state,
		entries: state.entries.map(e => (e.role === 'user' ? {...e, text: ''} : e))
	};
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 9
	});
	assert.equal(state.entries.find(e => e.role === 'user')?.text, '');
});

test('live turn_started without eventSeq paints Follow-up display text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-fu',
		text: '/goal draft the launch plan'
	});
	assert.equal(
		state.entries.find(e => e.role === 'user')?.text,
		'/goal draft the launch plan'
	);
});

test('live PlanBuild display survives persist TurnStarted with model text', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-pb',
		clientMessageId: 'client-pb',
		text: '执行计划：review-findings-fix',
		messageType: 'plan_build',
		planId: 'plan-1',
		planName: 'review-findings-fix'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-pb'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-pb',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 4
	});
	const users = state.entries.filter(e => e.role === 'user');
	assert.equal(users.length, 1);
	assert.equal(users[0]?.text, '执行计划：review-findings-fix');
});

test('approval-sealed card + persist TurnStarted with model text must not spawn a second user', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix',
		messageType: 'plan_build',
		planId: 'plan-1',
		planName: 'review-findings-fix'
	} as never);
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-1',
		runId: 'run-9',
		tool: 'shell',
		description: 'ls'
	});
	assert.equal(state.entries.find(e => e.role === 'assistant')?.status, 'done');
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9',
		clientMessageId: 'client-1',
		text: '执行计划：review-findings-fix\nplan_id=plan-1\n\nThis is a Plan Build / execute turn (not planning).',
		eventSeq: 20
	});
	const users = state.entries.filter(e => e.role === 'user');
	assert.equal(users.length, 1);
	assert.equal(users[0]?.text, '执行计划：review-findings-fix');
});

test('settled restore + persist input_accepted must not set activeRunId', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'restored_0', userText: 'hi', assistantText: 'done'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-old',
		eventSeq: 81
	});
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
});

test('settled restore + persist approval pair must not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: '01a017f0-ed6f-719a-90d4-4b87394f2805',
		turns: [
			{
				turnId: '01a0197b-8976-7f28-98a6-68d7f404d274',
				userText: '设计L0引擎文档',
				assistantText: '文档已写完。'
			}
		],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(state.postRunTerminal, true);
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		tool: 'shell',
		description: 'git diff build.sbt',
		eventSeq: 5454
	});
	assert.equal(state.approvals.length, 1, 'pending card still paints so a live wait can resolve');
	assert.equal(state.activeRunId, undefined, 'settled restore must not arm Stop from persist approval');
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'approval_resolved',
		id: '01a01981-6014-7118-93d9-ce8ff5bdbadf',
		runId: '01a0197b-8976-7f28-98a6-68d7f404d274',
		approved: true,
		eventSeq: 5455
	});
	assert.equal(state.approvals.length, 0);
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).runState, 'idle');
	assert.equal(composerGate(state, true).canCancel, false);
});

test('live approval_requested still arms activeRunId so resolve can resume Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-live',
		clientMessageId: 'client-live',
		text: 'go'
	});
	state = applyBridgeEvent(state, {
		type: 'approval_requested',
		id: 'ap-live',
		runId: 'run-live',
		tool: 'shell',
		description: 'rm'
	});
	assert.equal(state.activeRunId, 'run-live');
	assert.equal(state.postRunTerminal, false);
	assert.equal(composerGate(state, true).canCancel, false, 'prompt lock extinguishes Stop');
	state = applyBridgeEvent(state, {
		type: 'approval_resolved',
		id: 'ap-live',
		runId: 'run-live',
		approved: true
	});
	assert.equal(state.activeRunId, 'run-live');
	assert.equal(composerGate(state, true).runState, 'running');
	assert.equal(composerGate(state, true).canCancel, true);
});

test('user turn_started after settled restore lifts the guard', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-1',
		turns: [{turnId: 'old', userText: 'hi', assistantText: 'hello'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(state.postRunTerminal, true);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-2',
		clientMessageId: 'client-2',
		text: '下一句'
	});
	assert.equal(state.postRunTerminal, false);
	assert.equal(state.activeRunId, 'client-2');
	assert.equal(composerGate(state, true).runState, 'running');
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

function exploreFinished(
	state: ReturnType<typeof createTranscriptState>,
	turnId: string,
	id: string,
	path: string
) {
	let next = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId,
		id,
		tool: 'read_file',
		args: {path}
	});
	return applyBridgeEvent(next, {
		type: 'tool_finished',
		turnId,
		id,
		tool: 'read_file',
		success: true,
		fields: {}
	});
}

test('toTimelineItems wraps ≥3 sealed Thought/Exploring into processStack', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'dig'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'plan a'});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'plan b'});
	state = exploreFinished(state, 't1', 'r2', 'b.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'plan c'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'done'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant']
	);
	const stack = items[0];
	assert.ok(stack && stack.kind === 'processStack');
	assert.equal(stack.stepCount, 5);
	assert.equal(stack.open, false);
	assert.deepEqual(
		stack.steps.map(s => s.kind),
		['thought', 'exploring', 'thought', 'exploring', 'thought']
	);
});

test('toTimelineItems wraps ≥2 sealed process rows into processStack', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'short'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'one'});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'ok'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant']
	);
	assert.equal(items[0]?.kind === 'processStack' ? items[0].stepCount : 0, 2);
});

test('toTimelineItems folds Cancelled into processStack (no standalone system row)', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'stop me'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'one'});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'two'});
	state = exploreFinished(state, 't1', 'r2', 'b.ts');
	state = applyLocalCancel(state);

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.equal(
		items.some(i => i.kind === 'system' && i.tone === 'cancelled'),
		false
	);
	const stack = items.find(i => i.kind === 'processStack');
	assert.ok(stack && stack.kind === 'processStack');
	assert.equal(stack.cancelled, true);
});

test('toTimelineItems drops Cancelled when there is no processStack', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'early stop'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'only'});
	state = applyLocalCancel(state);

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.equal(
		items.some(i => i.kind === 'system' && i.tone === 'cancelled'),
		false
	);
	assert.equal(
		items.some(i => i.kind === 'processStack'),
		false
	);
});

test('toTimelineItems leaves streaming Thought outside processStack', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'live'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'a'});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'b'});
	state = exploreFinished(state, 't1', 'r2', 'b.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'c'});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'thought']
	);
	const stack = items[0];
	assert.ok(stack && stack.kind === 'processStack');
	assert.equal(stack.stepCount, 4);
	// Only the live tip shimmers — earlier stacks stay collapsed.
	assert.equal(stack.open, false);
	const live = items[1];
	assert.ok(live && live.kind === 'thought');
	assert.equal(live.open, true);
	assert.equal(live.text, 'c');
});

test('toTimelineItems keeps finished Exploring open as live tip while turn streams', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'explore'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 't1',
		text: '我先探索项目结构'
	});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 'g1',
		tool: 'glob',
		args: {pattern: '**/CONTEXT.md'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 'g1',
		tool: 'glob',
		success: true,
		fields: {}
	});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	const exploring = items.find(i => i.kind === 'exploring');
	assert.ok(exploring && exploring.kind === 'exploring');
	assert.equal(exploring.open, true);
	assert.match(exploring.summary, /Explored/);
});

test('toTimelineItems shell breaks processStack runs', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'break'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'a'});
	state = exploreFinished(state, 't1', 'r1', 'a.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'b'});
	state = applyBridgeEvent(state, {
		type: 'tool_started',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		args: {command: 'ls'}
	});
	state = applyBridgeEvent(state, {
		type: 'tool_finished',
		turnId: 't1',
		id: 's1',
		tool: 'shell',
		success: true,
		fields: {}
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'c'});
	state = exploreFinished(state, 't1', 'r2', 'b.ts');
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 't1', text: 'd'});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'done'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant']
	);
	assert.equal(items[0] && items[0].kind === 'processStack' ? items[0].stepCount : 0, 7);
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
	state = {...state, postRunTerminal: true};
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
	state = {...state, postRunTerminal: false};
	state = applyBridgeEvent(state, {
		type: 'proc_updated',
		procId: 'fg-1',
		status: 'killed',
		reason: 'user_stopped'
	});
	assert.equal(state.liveProcs?.length, 0);
	assert.equal(state.postRunTerminal, false);
});

test('slash-only skill user text is a command timeline row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-slash',
		text: '/research focus memory'
	});
	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.isCommand, true);
	assert.equal(user.text, '/research focus memory');
});

test('legacy injected [Skill: name] user text is a command timeline row', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't-skill',
		text: '[Skill: research]\n# Research\n\nbody\n\n---\n\nfocus memory'
	});
	const user = toTimelineItems(state).find(i => i.kind === 'user');
	assert.ok(user && user.kind === 'user');
	assert.equal(user.isCommand, true);
	assert.match(user.text, /^\[Skill: research\]/);
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
	assert.equal(state.postRunTerminal, true);

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

test('orphaned streaming assistant from a dropped turn is sealed when the next turn starts', () => {
	// Repro: Turn 1 streams partial output then the LLM stream drops silently (no
	// turn_finished/turn_cancelled). The user sends a new message; Turn 2's deltas
	// must NOT route into the stale streaming entry via the patchAssistant fallback.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't1',
		clientMessageId: 'm1',
		text: 'first'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't1', text: 'partial reply'});
	assert.equal(state.entries[1]?.status, 'streaming');
	assert.equal(state.entries[1]?.text, 'partial reply');

	// No turn_finished — stream just stopped. User sends a new message.
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 't2',
		clientMessageId: 'm2',
		text: 'second'
	});

	// Stale entry is sealed as done — not cancelled (user did not Stop) and not red error.
	const firstAssistant = state.entries.find(e => e.turnId === 't1' && e.role === 'assistant');
	assert.equal(firstAssistant?.status, 'done');
	assert.equal(firstAssistant?.sealedUnconfirmed, true);
	assert.equal(firstAssistant?.text, 'partial reply');

	// New turn has its own streaming assistant.
	const secondAssistant = state.entries.find(e => e.turnId === 't2' && e.role === 'assistant');
	assert.ok(secondAssistant);
	assert.equal(secondAssistant?.status, 'streaming');

	// Deltas for t2 route into the new entry, not the stale one.
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 't2', text: 'second reply'});
	assert.equal(state.entries.find(e => e.turnId === 't2' && e.role === 'assistant')?.text, 'second reply');
	assert.equal(firstAssistant?.text, 'partial reply', 'stale entry untouched');

	const items = toTimelineItems(state);
	assert.equal(
		items.some(i => i.kind === 'processStack' && i.cancelled),
		false,
		'neutral seal must not paint 已取消'
	);
});

test('river turn_started with same clientMessageId and different turnId does not split', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review this'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'client-1', text: 'look'});
	const before = state.entries.length;
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'engine-run-9',
		clientMessageId: 'client-1'
	});
	assert.equal(state.entries.length, before);
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'streaming');
	assert.equal(assistant?.turnId, 'client-1', 'must not adopt river `$runId-turn-N`');
	assert.equal(assistant?.clientMessageId, 'client-1');
	assert.equal(state.entries.filter(e => e.role === 'user').length, 1);
});

test('river turn_started with a different id remaps the live optimistic turn', () => {
	// CommandLoop emits turn_started(clientMessageId); river TurnStarted is the
	// same turn — merge, do not seal / split, do not overwrite the live turnId.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review this'
	});
	state = applyBridgeEvent(state, {type: 'reasoning_delta', turnId: 'client-1', text: 'look'});
	state = exploreFinished(state, 'client-1', 'r1', 'a.ts');
	state = exploreFinished(state, 'client-1', 'r2', 'b.ts');
	const before = state.entries.length;

	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'engine-run-9'});

	assert.equal(state.entries.length, before);
	const assistant = state.entries.find(e => e.role === 'assistant');
	assert.equal(assistant?.status, 'streaming');
	assert.equal(assistant?.turnId, 'client-1', 'must not adopt river `$runId-turn-N`');
	assert.equal(assistant?.clientMessageId, 'client-1');
	assert.equal(state.entries.filter(e => e.role === 'user').length, 1);

	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.equal(
		items.some(i => i.kind === 'processStack' && i.cancelled),
		false
	);
	assert.equal(items.filter(i => i.kind === 'processStack').length, 1);
});

test('run_done after river TurnStarted remaps turnId off the run id must extinguish Stop', () => {
	// Live order: CommandLoop turn_started(client id) → input_accepted(run id) →
	// deltas keyed by run id → persist TurnStarted uses `$runId-turn-N`.
	// Reconciliation must keep the run id so run_done can match.
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-9', text: '审查通过'});
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'run-9-turn-1',
		clientMessageId: 'client-1'
	});
	assert.equal(
		state.entries.find(e => e.role === 'assistant')?.turnId,
		'run-9',
		'input_accepted run id must survive river TurnStarted'
	);
	assert.equal(composerGate(state, true).canCancel, true);
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0,
		'run_done must seal the remapped streaming row'
	);
	assert.equal(state.activeRunId, undefined);
	assert.equal(composerGate(state, true).canCancel, false, 'Stop must go out when the run completes');
});

test('second ReAct TurnStarted without clientMessageId must not leave Stop lit after run_done', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: 'review the plan'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {type: 'assistant_delta', turnId: 'run-9', text: '审查通过'});
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: '1'});
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: '2'});
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-9', success: true});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(composerGate(state, true).canCancel, false);
});

test('sequenced empty TurnStarted after settle does not relight Stop', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'client-1',
		clientMessageId: 'client-1',
		text: '你是谁'
	});
	state = applyBridgeEvent(state, {
		type: 'input_accepted',
		turnId: 'run-9',
		clientMessageId: 'client-1'
	});
	state = applyBridgeEvent(state, {
		type: 'assistant_delta',
		turnId: 'run-9',
		text: '我是 Fast。',
		unitId: '1:1'
	});
	state = applyBridgeEvent(state, {type: 'checkpoint', unitId: '1:1', content: '我是 Fast。'});
	state = applyBridgeEvent(state, {type: 'run_done', runId: 'run-9', success: true, summary: ''});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'run-9', success: true});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 'run-9', text: ''});
	assert.equal(
		state.entries.filter(e => e.role === 'assistant' && e.status === 'streaming').length,
		0
	);
	assert.equal(state.postRunTerminal, true);
	assert.equal(composerGate(state, true).canCancel, false);
	assert.equal(composerGate(state, true).runState, 'idle');
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

test('session_restored restores goal_outcome / goal_step_conclusion chrome from assistantMessageType', () => {
	const state = applyBridgeEvent(createTranscriptState(), {
		type: 'session_restored',
		sessionId: 's1',
		turns: [
			{
				turnId: 'msg-step',
				userText: '',
				assistantText: '验收意见正文',
				assistantMessageType: 'goal_step_conclusion',
				goalId: 'g1',
				goalStepId: 'verify',
				goalAgentName: 'reviewer',
				goalVerdict: 'pass'
			},
			{
				turnId: 'msg-out',
				userText: '',
				assistantText: 'ship it',
				assistantMessageType: 'goal_outcome',
				goalId: 'g1',
				goalStatus: 'passed'
			}
		]
	});
	const step = state.entries.find(e => e.turnId === 'msg-step');
	assert.equal(step?.messageType, 'goal_step_conclusion');
	assert.equal(step?.goalAgentName, 'reviewer');
	assert.equal(step?.goalVerdict, 'pass');
	const out = state.entries.find(e => e.turnId === 'msg-out');
	assert.equal(out?.messageType, 'goal_outcome');
	assert.equal(out?.goalStatus, 'passed');
	const items = toTimelineItems(state);
	assert.ok(items.some(i => i.kind === 'goalStepConclusion'));
	assert.ok(items.some(i => i.kind === 'goalOutcome'));
});

test('goal_step_conclusion and goal_outcome structured turns project after chat seal', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {type: 'turn_started', turnId: 't1', text: 'go'});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 't1', success: true});
	assert.equal(state.postRunTerminal, true);

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-step-r1-conclusion',
		messageType: 'goal_step_conclusion',
		agentName: 'reviewer',
		verdict: 'pass',
		goalId: 'g1',
		stepId: 'verify'
	});
	assert.equal(state.postRunTerminal, true, 'goal system turn must not clear postRunTerminal');
	assert.equal(state.activeRunId, undefined, 'goal system turn must not arm Stop');
	const stepEntry = state.entries.find(e => e.turnId === 'goal-step-r1-conclusion');
	assert.equal(stepEntry?.messageType, 'goal_step_conclusion');
	assert.equal(stepEntry?.goalAgentName, 'reviewer');
	assert.equal(stepEntry?.goalVerdict, 'pass');

	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 'goal-step-r1-conclusion',
		text: '验收意见正文'
	});
	state = applyBridgeEvent(state, {
		type: 'turn_finished',
		turnId: 'goal-step-r1-conclusion',
		success: true
	});
	assert.equal(
		state.entries.find(e => e.turnId === 'goal-step-r1-conclusion')?.text,
		'验收意见正文'
	);

	const items = toTimelineItems(state);
	const stepItem = items.find(i => i.kind === 'goalStepConclusion');
	assert.ok(stepItem);
	assert.equal(stepItem?.kind === 'goalStepConclusion' && stepItem.agentName, 'reviewer');
	assert.equal(stepItem?.kind === 'goalStepConclusion' && stepItem.verdict, 'pass');

	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'goal-g1-notice',
		messageType: 'goal_outcome',
		goalId: 'g1',
		goalStatus: 'passed'
	});
	state = applyBridgeEvent(state, {
		type: 'final_answer',
		turnId: 'goal-g1-notice',
		text: 'Goal passed: ship it'
	});
	state = applyBridgeEvent(state, {type: 'turn_finished', turnId: 'goal-g1-notice', success: true});
	const outcome = toTimelineItems(state).find(i => i.kind === 'goalOutcome');
	assert.ok(outcome);
	assert.equal(outcome?.kind === 'goalOutcome' && outcome.goalStatus, 'passed');
	assert.equal(outcome?.kind === 'goalOutcome' && outcome.text, 'Goal passed: ship it');
});

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

test('settled restore + live new turn with fresh prompt paints and arms run', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess-live-new',
		turns: [{turnId: 'restored_0', userText: 'hi', assistantText: 'done'}],
		hasMoreOlder: false,
		totalTurnCount: 1
	});
	assert.equal(composerGate(state, true).canCancel, false);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'tb',
		clientMessageId: 'tb',
		text: 'ask B',
		eventSeq: 1
	});
	assert.equal(state.postRunTerminal, false);
	assert.equal(state.activeRunId, 'tb');
	assert.ok(
		state.entries.some(e => e.role === 'assistant' && e.turnId === 'tb' && e.status === 'streaming'),
		'live new turn on a freshly restored session must paint a streaming row'
	);
});

test('settled cancel + resubmit with different prompt paints new streaming turn', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c1',
		clientMessageId: 'c1',
		text: '继续寻找方法',
		eventSeq: 1
	});
	state = applyLocalCancel(state);
	state = applyBridgeEvent(state, {type: 'turn_cancelled', reason: 'stop', eventSeq: 2});
	assert.equal(state.postRunTerminal, true);
	state = applyBridgeEvent(state, {
		type: 'turn_started',
		turnId: 'c2',
		clientMessageId: 'c2',
		text: '继续',
		eventSeq: 3
	});
	assert.equal(state.postRunTerminal, false);
	assert.ok(
		state.entries.some(e => e.role === 'assistant' && e.turnId === 'c2' && e.status === 'streaming'),
		'resubmit after cancel settle must paint a new streaming row'
	);
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
