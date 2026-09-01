import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTimelineProjectionCache} from './timelineCache.js';
import type {TranscriptEntry} from './transcriptProjection.js';

function user(id: string, text: string): TranscriptEntry {
	return {id, role: 'user', text, status: 'done'};
}

function assistant(id: string, text: string, status: 'streaming' | 'done' = 'done'): TranscriptEntry {
	return {id, role: 'assistant', text, status};
}

test('projection cache reuses historical turn items when only the tail streams', () => {
	const project = createTimelineProjectionCache();
	const first = project({
		entries: [user('u1', 'hi'), assistant('a1', 'Hello')],
		approvals: [],
		questions: []
	});
	const second = project({
		entries: [user('u1', 'hi'), assistant('a1', 'Hello'), user('u2', 'more'), assistant('a2', 'Ta', 'streaming')],
		approvals: [],
		questions: []
	});
	const third = project({
		entries: [
			user('u1', 'hi'),
			assistant('a1', 'Hello'),
			user('u2', 'more'),
			assistant('a2', 'Tail growing', 'streaming')
		],
		approvals: [],
		questions: []
	});

	const firstUser = first.find(i => i.kind === 'user' && i.id === 'u1');
	const secondUser = second.find(i => i.kind === 'user' && i.id === 'u1');
	const thirdUser = third.find(i => i.kind === 'user' && i.id === 'u1');
	assert.equal(firstUser, secondUser);
	assert.equal(secondUser, thirdUser);

	const a1First = first.find(i => i.kind === 'assistant' && i.id === 'a1');
	const a1Third = third.find(i => i.kind === 'assistant' && i.id === 'a1');
	assert.equal(a1First, a1Third);

	const a2Second = second.find(i => i.kind === 'assistant' && i.id === 'a2');
	const a2Third = third.find(i => i.kind === 'assistant' && i.id === 'a2');
	assert.notEqual(a2Second, a2Third);
	assert.ok(a2Third && a2Third.kind === 'assistant' && a2Third.text === 'Tail growing');
});

// --- P0-2: reference fast path must stay behavior-equal to the uncached projection ---

import {toTimelineItems} from './timeline.js';

function tooled(id: string, toolId: string, path: string): TranscriptEntry {
	return {
		id,
		role: 'assistant',
		text: 'edited file',
		status: 'done',
		tools: [
			{id: toolId, tool: 'apply_patch', args: {path}, output: 'ok', status: 'success'}
		]
	};
}

test('cached projection stays deep-equal to toTimelineItems across streaming evolution', () => {
	const project = createTimelineProjectionCache();
	const u1 = user('u1', 'question');
	const a1 = assistant('a1', 'answer');
	let tail = assistant('a2', 'T', 'streaming');
	for (let i = 0; i < 25; i++) {
		tail = {...tail, text: tail.text + ` token-${i}`};
		const state = {entries: [u1, a1, user('u2', 'follow'), tail], approvals: [], questions: []};
		assert.deepEqual(project(state), toTimelineItems(state, {}));
	}
	const done = {...tail, status: 'done' as const};
	const state = {entries: [u1, a1, user('u2', 'follow'), done], approvals: [], questions: []};
	assert.deepEqual(project(state), toTimelineItems(state, {}));
});

test('reference-stable entry re-projects when its file diff arrives later', () => {
	const project = createTimelineProjectionCache();
	const entry = tooled('a1', 't1', 'src/x.ts');
	const state = {entries: [entry], approvals: [], questions: []};
	const before = project(state, {fileDiffs: {}});
	const diffs = {t1: '+++ src/x.ts\n+new line'};
	const after = project(state, {fileDiffs: diffs});
	assert.deepEqual(after, toTimelineItems(state, {fileDiffs: diffs}));
	assert.notDeepEqual(before, after, 'diff arrival must invalidate the cached row');
});

test('same-length tool output change cannot collide in the IPC-clone fallback', () => {
	const project = createTimelineProjectionCache();
	const firstEntry = tooled('a1', 't1', 'src/x.ts');
	firstEntry.tools![0] = {
		id: 't1',
		tool: 'shell',
		args: {command: 'printf value'},
		output: 'ok',
		status: 'success'
	};
	const firstState = {entries: [firstEntry], approvals: [], questions: []};
	const before = project(firstState);

	const changed = structuredClone(firstEntry);
	changed.tools![0]!.output = 'NO';
	const changedState = {entries: [changed], approvals: [], questions: []};
	const expected = toTimelineItems(changedState, {});
	assert.notDeepEqual(before, expected, 'fixture must change rendered tool output');
	assert.deepEqual(
		project(changedState),
		expected,
		'cache key must compare tool output content, not only its length'
	);
});

test('same-length file diff replacement invalidates a reference-stable entry', () => {
	const project = createTimelineProjectionCache();
	const entry = tooled('a1', 't1', 'src/x.ts');
	const state = {entries: [entry], approvals: [], questions: []};
	const before = project(state, {
		fileDiffs: {t1: '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-old\n+new'}
	});
	const nextDiffs = {
		t1: '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-one\n+two'
	};
	const expected = toTimelineItems(state, {fileDiffs: nextDiffs});
	assert.notDeepEqual(before, expected, 'fixture must change rendered diff lines');
	assert.deepEqual(
		project(state, {fileDiffs: nextDiffs}),
		expected,
		'cache key must compare diff content, not only its length'
	);
});

test('approval and question metadata changes invalidate pending-card cache', () => {
	const project = createTimelineProjectionCache();
	const first = {
		entries: [],
		approvals: [
			{id: 'a1', runId: 'r1', tool: 'shell', description: 'run it', risk: 'low', context: 'aaa'}
		],
		questions: [
			{
				id: 'q1',
				runId: 'r1',
				title: 'Pick',
				question: 'Which?',
				options: [{id: '1', label: 'One', description: 'aaa'}],
				allowCustom: true
			}
		]
	};
	project(first);
	const changed = {
		...first,
		approvals: [{...first.approvals[0]!, risk: 'high', context: 'bbb'}],
		questions: [
			{
				...first.questions[0]!,
				title: 'Choose',
				options: [{id: '1', label: 'Two', description: 'bbb'}],
				allowCustom: false
			}
		]
	};
	assert.deepEqual(
		project(changed),
		toTimelineItems(changed, {}),
		'pending card cache must include every rendered field'
	);
});

test('IPC-cloned identical entries keep cached item identity', () => {
	const project = createTimelineProjectionCache();
	const state1 = {entries: [user('u1', 'hi'), assistant('a1', 'Hello')], approvals: [], questions: []};
	const first = project(state1);
	const cloned = {
		entries: structuredClone(state1.entries) as TranscriptEntry[],
		approvals: [],
		questions: []
	};
	const second = project(cloned);
	assert.equal(
		first.find(i => i.id === 'a1'),
		second.find(i => i.id === 'a1'),
		'same content under new objects must reuse cached items'
	);
});

test('PERF SENTINEL: 800 streamed frames over a 30-turn history stay bounded', () => {
	const project = createTimelineProjectionCache();
	const history: TranscriptEntry[] = [];
	for (let i = 0; i < 15; i++) {
		history.push(user(`u${i}`, `question ${i} ${'x'.repeat(400)}`));
		history.push(assistant(`a${i}`, `answer ${i} ${'y'.repeat(2000)}`));
	}
	let tail = assistant('tail', '', 'streaming');
	const t0 = Date.now();
	for (let i = 0; i < 800; i++) {
		tail = {...tail, text: tail.text + `tok-${i} `};
		project({entries: [...history, tail], approvals: [], questions: []});
	}
	const elapsed = Date.now() - t0;
	// Generous canary bound (was multi-second with per-frame full-text fingerprints).
	assert.ok(elapsed < 1500, `800 frames took ${elapsed}ms — projection hot path regressed`);
});
