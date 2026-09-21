/** transcriptProjection tests — Exploring / timeline groups. Loaded by transcriptProjection.test.ts. */
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
