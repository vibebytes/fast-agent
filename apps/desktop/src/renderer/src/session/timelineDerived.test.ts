import test from 'node:test';
import assert from 'node:assert/strict';
import type {TimelineItem} from '@fast-ide/session-view';
import {
	activePlanBuildIds,
	deferredValueForTask,
	sameIdSet,
	stablePlanBuildIds,
	stableReviewFiles,
	transcriptScrollKey
} from './timelineDerived.js';

function user(id: string, opts?: {planId?: string; showStop?: boolean}): TimelineItem {
	return {
		kind: 'user',
		id,
		text: `msg-${id}`,
		...(opts?.showStop ? {showStop: true} : {}),
		...(opts?.planId
			? {planBuild: {planId: opts.planId, name: `plan-${opts.planId}`}}
			: {})
	} as TimelineItem;
}

function assistant(id: string, text: string, status: 'streaming' | 'done'): TimelineItem {
	return {kind: 'assistant', id, text, status} as TimelineItem;
}

test('activePlanBuildIds picks only in-flight planBuild user rows', () => {
	const items: TimelineItem[] = [
		user('u1', {planId: 'p1', showStop: true}),
		user('u2', {planId: 'p2'}),
		user('u3', {showStop: true}),
		assistant('a1', 'hi', 'done')
	];
	assert.deepEqual([...activePlanBuildIds(items)], ['p1']);
});

test('sameIdSet compares contents, not identity', () => {
	assert.ok(sameIdSet(new Set(['a', 'b']), new Set(['b', 'a'])));
	assert.ok(!sameIdSet(new Set(['a']), new Set(['a', 'b'])));
	assert.ok(!sameIdSet(new Set(['a']), new Set(['b'])));
});

test('stablePlanBuildIds keeps previous Set identity when contents match', () => {
	const items = [user('u1', {planId: 'p1', showStop: true})];
	const first = stablePlanBuildIds(items, null);
	const again = stablePlanBuildIds([...items], first);
	assert.equal(again, first, 'unchanged contents must reuse the previous Set');

	const changed = stablePlanBuildIds([user('u1', {planId: 'p9', showStop: true})], first);
	assert.notEqual(changed, first);
	assert.deepEqual([...changed], ['p9']);
});

test('stableReviewFiles keeps Composer stack identity across text-only frames', () => {
	const first = [
		{id: 'f1', path: 'src/a.ts', add: 2, del: 1, status: 'done' as const}
	];
	const same = stableReviewFiles([{...first[0]!}], first);
	assert.equal(same, first, 'equal review rows must retain the previous array');

	const changed = stableReviewFiles([{...first[0]!, add: 3}], first);
	assert.notEqual(changed, first);
	assert.equal(changed[0]?.add, 3);
});

test('deferredValueForTask never shows a previous Task snapshot after focus switch', () => {
	const current = {text: 'task-b'};
	assert.equal(
		deferredValueForTask('task-b', current, {taskId: 'task-a', value: {text: 'task-a'}}),
		current
	);
	const priorFrame = {text: 'task-b prior frame'};
	assert.equal(
		deferredValueForTask('task-b', current, {taskId: 'task-b', value: priorFrame}),
		priorFrame,
		'same-Task streaming updates may remain deferred'
	);
});

test('transcriptScrollKey tracks tail growth', () => {
	const base: TimelineItem[] = [
		user('u1'),
		assistant('a1', 'hello', 'streaming')
	];
	const grown: TimelineItem[] = [
		user('u1'),
		assistant('a1', 'hello world', 'streaming')
	];
	assert.notEqual(transcriptScrollKey(base), transcriptScrollKey(grown));

	const appended = [...grown, assistant('a2', '', 'streaming')];
	assert.notEqual(transcriptScrollKey(grown), transcriptScrollKey(appended));
});

test('transcriptScrollKey ignores deep-history edits (ResizeObserver owns those)', () => {
	const history: TimelineItem[] = Array.from({length: 12}, (_, i) =>
		assistant(`a${i}`, `text-${i}`, 'done')
	);
	const editedEarly = history.map((it, i) =>
		i === 0 ? assistant('a0', 'text-0 EDITED LONGER', 'done') : it
	);
	assert.equal(transcriptScrollKey(history), transcriptScrollKey(editedEarly));
});

test('transcriptScrollKey is content-keyed across array identities', () => {
	const a = [user('u1'), assistant('a1', 'x', 'streaming')];
	const b = [user('u1'), assistant('a1', 'x', 'streaming')];
	assert.equal(transcriptScrollKey(a), transcriptScrollKey(b));
});
