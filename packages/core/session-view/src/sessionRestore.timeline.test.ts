import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBridgeEvent, createTranscriptState, toTimelineItems} from './index.js';

test('session_restored preserves scheduler_generated origin on user entry', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'sched_1',
				userText: 'hourly check',
				assistantText: 'ok',
				origin: 'scheduler_generated'
			}
		]
	});
	const user = state.entries.find(e => e.role === 'user');
	assert.equal(user?.origin, 'scheduler_generated');
	const items = toTimelineItems(state);
	const userItem = items.find(i => i.kind === 'user');
	assert.equal(userItem && 'origin' in userItem ? userItem.origin : undefined, 'scheduler_generated');
});

test('session_restored with shell+edit tools yields tool and file cards', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'edit App',
				assistantText: 'done',
				thinking: 'plan',
				tools: [
					{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success', summary: 'ok'},
					{
						id: 't2',
						tool: 'FILE_EDIT',
						args: {path: 'App.tsx'},
						status: 'success',
						summary: '@@ -1 +1 @@\n-a\n+b'
					}
				]
			}
		]
	});
	const entry = state.entries.find(e => e.role === 'assistant');
	assert.equal(entry?.tools?.length, 2);
	assert.ok(entry?.segments?.some(s => s.kind === 'tools'));
	const items = toTimelineItems(state);
	const kinds = items.map(i => i.kind);
	const allKinds = items.flatMap(i => (i.kind === 'processStack' ? i.steps.map(s => s.kind) : [i.kind]));
	assert.ok(allKinds.includes('tool'), `expected tool card, got ${kinds.join(',')}`);
	const file = items.find(i => i.kind === 'file');
	assert.ok(file && file.kind === 'file');
	assert.ok(file.lines.some(l => l.type === 'del' || l.type === 'add'));
});

test('session_restored explore-only tools become Exploring group', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'look',
				assistantText: 'saw it',
				tools: [
					{id: 't1', tool: 'read_file', args: {path: 'a.ts'}, status: 'success', summary: '...'}
				]
			}
		]
	});
	const items = toTimelineItems(state);
	assert.equal(items.some(i => i.kind === 'tool' || i.kind === 'file'), false);
	assert.ok(items.some(i => i.kind === 'exploring'));
});

test('session_restored steps rebuild chronological thought → tool → thought', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'research',
				assistantText: 'done',
				thinking: 'first\nsecond',
				tools: [
					{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'},
					{id: 't2', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}
				],
				steps: [
					{
						reasoning: 'first',
						tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
						text: 'looking'
					},
					{
						reasoning: 'second',
						tools: [{id: 't2', tool: 'read_file', args: {path: 'a.ts'}, status: 'success'}],
						text: 'done'
					}
				]
			}
		]
	});
	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant', 'processStack', 'assistant']
	);
	const stacks = items.filter(i => i.kind === 'processStack');
	const thoughts = stacks.flatMap(s => (s.kind === 'processStack' ? s.steps.filter(st => st.kind === 'thought') : []));
	assert.equal(thoughts[0] && thoughts[0].kind === 'thought' ? thoughts[0].text : '', 'first');
	assert.equal(thoughts[1] && thoughts[1].kind === 'thought' ? thoughts[1].text : '', 'second');
});

test('session_restored preamble textBeforeTools keeps assistant before tools', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'look',
				assistantText: '我先列目录',
				tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}],
				steps: [
					{
						text: '我先列目录',
						textBeforeTools: true,
						tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}]
					}
				]
			}
		]
	});
	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['assistant', 'tool']
	);
	assert.equal(items[0] && items[0].kind === 'assistant' ? items[0].text : '', '我先列目录');
});

test('session_restored assistant segment ids are unique per turn', () => {
	let state = createTranscriptState();
	state = applyBridgeEvent(state, {
		type: 'session_restored',
		sessionId: 'sess',
		turns: [
			{
				turnId: 'restored_0',
				userText: 'one',
				assistantText: 'first answer',
				tools: [{id: 't1', tool: 'shell', args: {command: 'ls'}, status: 'success'}]
			},
			{
				turnId: 'restored_1',
				userText: 'two',
				assistantText: 'second answer',
				tools: [{id: 't2', tool: 'shell', args: {command: 'pwd'}, status: 'success'}]
			}
		]
	});
	const items = toTimelineItems(state);
	const assistantIds = items.filter(i => i.kind === 'assistant').map(i => i.id);
	assert.deepEqual(assistantIds, ['seg-a-restored_0', 'seg-a-restored_1']);
	assert.equal(new Set(assistantIds).size, assistantIds.length);
});
