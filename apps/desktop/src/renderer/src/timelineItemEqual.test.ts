import assert from 'node:assert/strict';
import {test} from 'node:test';
import {timelineItemEqual} from './timelineItemEqual.js';
import type {TimelineItem} from '@fast-ide/session-view';

test('timelineItemEqual is true for identical assistant content on new object identities', () => {
	const a: TimelineItem = {
		kind: 'assistant',
		id: '1',
		text: 'hello',
		status: 'streaming'
	};
	const b: TimelineItem = {
		kind: 'assistant',
		id: '1',
		text: 'hello',
		status: 'streaming'
	};
	assert.equal(timelineItemEqual(a, b), true);
});

test('timelineItemEqual is false when assistant text changes', () => {
	const a: TimelineItem = {
		kind: 'assistant',
		id: '1',
		text: 'hello',
		status: 'streaming'
	};
	const b: TimelineItem = {...a, text: 'hello!'};
	assert.equal(timelineItemEqual(a, b), false);
});

test('timelineItemEqual observes rendered Exploring tool details', () => {
	const a: TimelineItem = {
		kind: 'exploring',
		id: 'e1',
		summary: 'Explored 1',
		toolIds: ['t1'],
		tools: [{id: 't1', tool: 'read_file', title: 'a.ts', status: 'success', summary: 'src/a.ts'}],
		open: false
	};
	const changedTitle: TimelineItem = {
		...a,
		tools: [{...a.tools[0]!, title: 'b.ts', summary: 'src/b.ts'}]
	};
	assert.equal(timelineItemEqual(a, changedTitle), false);
});

test('timelineItemEqual observes user origin used by the scheduled badge', () => {
	const a = {
		kind: 'user',
		id: 'u1',
		text: 'run',
		origin: 'user'
	} as TimelineItem;
	const scheduled = {...a, origin: 'scheduler_generated'} as TimelineItem;
	assert.equal(timelineItemEqual(a, scheduled), false);
});

test('timelineItemEqual observes every rendered tool summary/body field', () => {
	const item: Extract<TimelineItem, {kind: 'tool'}> = {
		kind: 'tool',
		id: 'tool-1',
		tool: 'shell',
		title: 'Build',
		status: 'success',
		command: 'pnpm build',
		output: 'done',
		exitCode: '0',
		summary: 'build',
		startedAt: 1
	};
	assert.equal(timelineItemEqual(item, {...item}), true);
	for (const changed of [
		{...item, title: 'Test'},
		{...item, status: 'error' as const},
		{...item, command: 'pnpm test'},
		{...item, output: 'failed'},
		{...item, exitCode: '1'},
		{...item, summary: 'test'},
		{...item, startedAt: 2}
	]) {
		assert.equal(timelineItemEqual(item, changed), false);
	}
});

test('timelineItemEqual observes file threshold and preview fields', () => {
	const lines: Extract<TimelineItem, {kind: 'file'}>['lines'] = [
		{type: 'add', newLine: 1, content: 'one'}
	];
	const item: Extract<TimelineItem, {kind: 'file'}> = {
		kind: 'file',
		id: 'file-1',
		path: 'src/a.ts',
		op: 'diff',
		status: 'success',
		add: 1,
		del: 0,
		lines,
		hidden: 0
	};
	assert.equal(timelineItemEqual(item, {...item}), true);
	assert.equal(timelineItemEqual(item, {...item, add: 2}), false);
	assert.equal(timelineItemEqual(item, {...item, hidden: 201}), false);
	assert.equal(timelineItemEqual(item, {...item, lines: [...lines]}), false);
	assert.equal(timelineItemEqual(item, {...item, path: 'src/b.ts'}), false);
});

test('timelineItemEqual observes question_batch questions by reference', () => {
	const questions = [{id: 'q1', question: 'Go?', options: [{label: 'Yes'}]}];
	const a: TimelineItem = {kind: 'question_batch', id: 'rpc-1', questions};
	const b: TimelineItem = {kind: 'question_batch', id: 'rpc-1', questions};
	assert.equal(timelineItemEqual(a, b), true);
	assert.equal(
		timelineItemEqual(a, {kind: 'question_batch', id: 'rpc-1', questions: [...questions]}),
		false
	);
});
