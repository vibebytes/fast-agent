import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptState, type TranscriptEntry} from './transcriptProjection.js';
import {toTimelineItems} from './timeline.js';

/**
 * Product lock: Goal pre-start confirm is a chat reply AFTER the plan Process Stack.
 * Painting 请确认 onto the tool-bearing turn's entry.text makes it an orphan preamble
 * (above 「N 步」) — that layout is the regression; do not treat it as the confirm surface.
 */
test('Goal confirm as a following assistant entry renders after Process Stack, not inside it', () => {
	const state = {
		...createTranscriptState(),
		entries: [
			{id: 'u1', role: 'user' as const, text: '/goal ship', status: 'done' as const},
			{
				id: 'a-plan',
				role: 'assistant' as const,
				text: '',
				status: 'done' as const,
				tools: [
					{
						id: 'g-tool',
						tool: 'goal',
						args: {},
						status: 'success' as const,
						output: ''
					}
				],
				segments: [
					{kind: 'thinking' as const, id: 'th', text: '规划成员'},
					{kind: 'tools' as const, id: 'seg-t', toolIds: ['g-tool']}
				]
			},
			{
				id: 'a-confirm',
				role: 'assistant' as const,
				text: '目标：ship widget\n请确认是否开始执行（回复「开始」或「确认」即可）。',
				status: 'done' as const
			}
		]
	};
	const items = toTimelineItems(state).filter(i => i.kind !== 'user');
	assert.deepEqual(
		items.map(i => i.kind),
		['processStack', 'assistant'],
		'confirm must sit below 「N 步」, not as preamble above it'
	);
	const stack = items[0];
	assert.ok(stack && stack.kind === 'processStack');
	assert.equal(
		JSON.stringify(stack).includes('请确认是否开始执行'),
		false,
		'Process Stack must not swallow the confirm ask'
	);
	const reply = items[1];
	assert.ok(reply && reply.kind === 'assistant');
	assert.match(reply.text, /请确认是否开始执行/);
	assert.match(reply.text, /ship widget/);
});

test('confirm dumped on the tool turn is orphan preamble above Process Stack — not the confirm surface', () => {
	const state = {
		...createTranscriptState(),
		entries: [
			{
				id: 'a-plan',
				role: 'assistant' as const,
				text: '请确认是否开始执行（回复「开始」或「确认」即可）。',
				status: 'done' as const,
				tools: [
					{id: 't1', tool: 'skill_view', args: {}, status: 'success' as const, output: ''},
					{id: 't2', tool: 'shell', args: {command: 'ls'}, status: 'success' as const, output: ''},
					{id: 't3', tool: 'goal', args: {}, status: 'success' as const, output: ''}
				],
				segments: [{kind: 'tools' as const, id: 'seg-t', toolIds: ['t1', 't2', 't3']}]
			}
		] as TranscriptEntry[]
	};
	const items = toTimelineItems(state);
	assert.deepEqual(
		items.map(i => i.kind),
		['assistant', 'processStack'],
		'timeline trap: tool-turn entry.text lands above 「N 步」 — paint confirm as a later entry instead'
	);
	assert.ok(items[0] && items[0].kind === 'assistant');
	assert.match(items[0].text, /请确认是否开始执行/);
});
