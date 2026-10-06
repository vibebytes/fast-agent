import test from 'node:test';
import assert from 'node:assert/strict';
import {
	foldForeignEntries,
	splitForeignColumns,
	splitForeignEntryColumns,
	toTimelineItems,
	wrapForeignFolds
} from './timeline.js';
import type {TimelineItem} from './timeline.js';
import type {TranscriptEntry} from './transcript/state.js';

function user(
	id: string,
	text: string,
	origin?: string,
	from?: {fromAgentId?: string; displayName?: string}
): TranscriptEntry {
	return {
		id,
		role: 'user',
		text,
		status: 'done',
		turnId: id,
		...(origin ? {origin} : {}),
		...(from?.fromAgentId ? {fromAgentId: from.fromAgentId} : {}),
		...(from?.displayName ? {displayName: from.displayName} : {})
	};
}

function assistant(id: string, text: string): TranscriptEntry {
	return {id, role: 'assistant', text, status: 'done', turnId: id.replace('a', 'u')};
}

test('toTimelineItems folds consecutive cluster_agent turns and leaves owner turns open', () => {
	const items = toTimelineItems({
		entries: [
			user('u0', '主人问'),
			assistant('a0', '主人答'),
			user('u1', '第一问', 'cluster_agent', {fromAgentId: 'peer-a', displayName: '小A'}),
			assistant('a1', '答一'),
			user('u2', '第二问', 'cluster_agent', {fromAgentId: 'peer-a', displayName: '小A'}),
			assistant('a2', '答二'),
			user('u3', '另一人', 'cluster_agent', {fromAgentId: 'peer-b', displayName: '小B'}),
			assistant('a3', '答B')
		],
		approvals: [],
		questions: []
	});
	assert.equal(items[0]?.kind, 'user');
	assert.equal(items[1]?.kind, 'assistant');
	assert.equal(items[2]?.kind, 'foreignFold');
	assert.equal(items[2] && items[2].kind === 'foreignFold' ? items[2].displayName : '', '小A');
	assert.equal(items[2] && items[2].kind === 'foreignFold' ? items[2].items.length : 0, 4);
	assert.equal(items[3]?.kind, 'foreignFold');
	assert.equal(items[3] && items[3].kind === 'foreignFold' ? items[3].displayName : '', '小B');
});

test('wrapForeignFolds does not fold scheduler or wake rows', () => {
	const items: TimelineItem[] = [
		{kind: 'user', id: 'u1', text: 'job', isCommand: false, origin: 'scheduler_generated'},
		{kind: 'assistant', id: 'a1', text: 'ok', status: 'done'}
	];
	assert.deepEqual(
		wrapForeignFolds(items).map(i => i.kind),
		['user', 'assistant']
	);
});

test('foldForeignEntries groups the same from for mobile', () => {
	const rows = foldForeignEntries([
		user('u1', '一', 'cluster_agent', {fromAgentId: 'a', displayName: '小A'}),
		assistant('a1', '答'),
		user('u2', '主人')
	]);
	assert.equal(rows[0] && 'kind' in rows[0] ? rows[0].kind : '', 'foreignFold');
	const rest = rows[1];
	assert.ok(rest && !('kind' in rest));
	assert.equal(rest.role, 'user');
});

test('splitForeignColumns moves folds off the owner river', () => {
	const items = toTimelineItems({
		entries: [
			user('u0', '主人问'),
			assistant('a0', '主人答'),
			user('u1', '外来', 'cluster_agent', {fromAgentId: 'peer-a', displayName: '小A'}),
			assistant('a1', '答外来')
		],
		approvals: [],
		questions: []
	});
	const {owner, foreign} = splitForeignColumns(items);
	assert.deepEqual(
		owner.map(i => i.kind),
		['user', 'assistant']
	);
	assert.equal(owner[0] && owner[0].kind === 'user' ? owner[0].text : '', '主人问');
	assert.equal(foreign.length, 1);
	assert.equal(foreign[0]?.displayName, '小A');
});

test('splitForeignEntryColumns keeps mobile owner rows unwrapped', () => {
	const rows = foldForeignEntries([
		user('u0', '主人'),
		assistant('a0', '答'),
		user('u1', '外来', 'cluster_agent', {fromAgentId: 'a', displayName: '小A'}),
		assistant('a1', '答A')
	]);
	const {owner, foreign} = splitForeignEntryColumns(rows);
	assert.equal(owner.length, 2);
	assert.equal(owner[0]?.role, 'user');
	assert.equal(owner[0]?.text, '主人');
	assert.equal(foreign.length, 1);
	assert.equal(foreign[0]?.displayName, '小A');
});
