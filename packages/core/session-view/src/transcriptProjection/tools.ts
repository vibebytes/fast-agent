/** transcriptProjection tests — tool format / processStack. Loaded by transcriptProjection.test.ts. */
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
import {exploreFinished} from './kit.js';

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
