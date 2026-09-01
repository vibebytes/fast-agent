import assert from 'node:assert/strict';
import test from 'node:test';
import {staleErrorCardIds, toTimelineItems} from './timeline.js';
import {createTimelineProjectionCache} from './timelineCache.js';
import {createSessionViewProjector} from './sessionView.js';
import type {TranscriptEntry} from './transcriptProjection.js';

function userEntry(id: string, turnId: string, text = 'hi'): TranscriptEntry {
	return {id, role: 'user', text, status: 'done', turnId};
}

function src(entries: TranscriptEntry[]) {
	return {entries, approvals: [], questions: []};
}

function assistantEntry(id: string, turnId: string, text: string, status: TranscriptEntry['status']): TranscriptEntry {
	return {
		id,
		role: 'assistant',
		text,
		status,
		turnId,
		...(status === 'error'
			? {fault: {kind: 'engine_error', remedy: 'retry the run', retryableAfterMs: 0}}
			: {})
	};
}

function markerCount(items: readonly {kind: string}[]): number {
	return items.filter(i => i.kind === 'marker').length;
}

test('rerunMarkers hide victim rows and emit no provenance banner', () => {
	const entries: TranscriptEntry[] = [
		userEntry('u1', 't1'),
		assistantEntry('r1', 'r1', 'first answer', 'done'),
		userEntry('u2', 't2', 'again'),
		assistantEntry('r2', 'r2', 'second answer', 'done')
	];
	const items = toTimelineItems(src(entries), {rerunMarkers: {r1: 't2'}});
	assert.equal(markerCount(items), 0);
	const texts = items
		.filter((i): i is Extract<(typeof items)[number], {kind: 'assistant'}> => i.kind === 'assistant')
		.map(i => i.text);
	assert.deepEqual(texts, ['second answer']);
});

test('failed victim keeps its error card and fault; no retry banner either', () => {
	const entries: TranscriptEntry[] = [
		userEntry('u1', 't1'),
		assistantEntry('r1', 'r1', 'boom', 'error'),
		userEntry('u2', 't2', 'retry please'),
		assistantEntry('r2', 'r2', 'fixed', 'done')
	];
	const items = toTimelineItems(src(entries), {rerunMarkers: {r1: 't2'}});
	assert.equal(markerCount(items), 0);
	const texts = items
		.filter((i): i is Extract<(typeof items)[number], {kind: 'assistant'}> => i.kind === 'assistant')
		.map(i => i.text);
	assert.deepEqual(texts, ['boom', 'fixed']);
});

test('projection cache re-projects when rerunMarkers change identity', () => {
	const project = createTimelineProjectionCache();
	const entries: TranscriptEntry[] = [
		userEntry('u1', 't1'),
		assistantEntry('r1', 'r1', 'first', 'done'),
		userEntry('u2', 't2', 'again'),
		assistantEntry('r2', 'r2', 'second', 'done')
	];
	const before = project(src(entries), {});
	assert.ok(before.some(i => i.kind === 'assistant' && i.text === 'first'));
	const after = project(src(entries), {rerunMarkers: {r1: 't2'}});
	assert.ok(!after.some(i => i.kind === 'assistant' && i.text === 'first'));
});

test('projector cache path honors hiddenRuns with realistic display ids', () => {
	const projector = createSessionViewProjector();
	const source = {
		entries: [
			userEntry('u1', 'run-1'),
			assistantEntry('assistant-cm1', 'run-1', 'first answer', 'done'),
			userEntry('u2', 'run-2', 'again')
		],
		approvals: [],
		questions: [],
		questionBatches: [],
		subagents: []
	};

	const first = projector(source, [], {
		canCancel: false,
		rerunMarkers: {},
		hiddenRuns: new Set(['run-1'])
	});
	assert.deepEqual(
		first.map(i => i.kind),
		['user', 'user']
	);

	// Same inputs again → the cached pass must still hide the victim (no leak).
	const second = projector(source, [], {
		canCancel: false,
		rerunMarkers: {},
		hiddenRuns: new Set(['run-1'])
	});
	assert.deepEqual(second.map(i => i.id), first.map(i => i.id));

	// Once restore lands, the markers path takes over hiding: victim rows drop
	// silently and the new answer stands in their place.
	const restored = projector(source, [], {
		canCancel: false,
		rerunMarkers: {'run-1': 'run-2'},
		hiddenRuns: undefined
	});
	assert.equal(markerCount(restored), 0);
	assert.ok(!restored.some(i => i.kind === 'assistant' && i.text === 'first answer'));
});

test('superseded FAILED runs keep their error card (D4) and go stale later', () => {
	const entries: TranscriptEntry[] = [
		userEntry('u1', 't1'),
		{
			...assistantEntry('assistant-cm1', 'run-1', 'boom', 'error'),
			fault: {kind: 'silent', remedy: 'retry the run'}
		},
		userEntry('u2', 't2', 'retry please'),
		assistantEntry('assistant-cm2', 'run-2', 'fixed', 'done')
	];
	const items = toTimelineItems(src(entries), {rerunMarkers: {'run-1': 't2'}});
	assert.equal(markerCount(items), 0);
	const texts = items
		.filter((i): i is Extract<(typeof items)[number], {kind: 'assistant'}> => i.kind === 'assistant')
		.map(i => i.text);
	assert.deepEqual(texts, ['boom', 'fixed']);

	// Retry/regenerate must target the ENGINE run id, not the display row id.
	const card = items.find(
		(i): i is Extract<(typeof items)[number], {kind: 'assistant'}> =>
			i.kind === 'assistant' && i.text === 'boom'
	);
	assert.equal(card?.runId, 'run-1');
	assert.notEqual(card?.id, card?.runId);

	// Once the retry terminal landed, staleErrorCardIds grays the old card.
	assert.deepEqual([...staleErrorCardIds(items)], ['assistant-cm1']);
});
