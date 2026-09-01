import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	TRANSCRIPT_BACKFILL_BATCH_SECTIONS,
	TRANSCRIPT_REVEAL_PAGE_SECTIONS,
	TRANSCRIPT_STAGING_INITIAL_SECTIONS,
	TRANSCRIPT_TAIL_WINDOW_SECTIONS,
	advanceTranscriptStaging,
	reconcileTranscriptStaging,
	visibleTranscriptSections,
	type TranscriptStagingState
} from './transcriptStaging.js';

const empty: TranscriptStagingState = {
	key: null,
	total: 0,
	visible: 0,
	phase: 'complete'
};

test('cold long Transcript stages to the tail window then hands over to backfill', () => {
	let state = reconcileTranscriptStaging(empty, {
		key: 'task-a',
		total: 20,
		loading: false,
		revisited: false
	});
	assert.equal(state.phase, 'staging');
	assert.equal(state.visible, TRANSCRIPT_STAGING_INITIAL_SECTIONS);

	state = advanceTranscriptStaging(state);
	assert.equal(state.phase, 'backfill');
	assert.equal(state.visible, TRANSCRIPT_TAIL_WINDOW_SECTIONS);

	state = advanceTranscriptStaging(state, TRANSCRIPT_BACKFILL_BATCH_SECTIONS);
	assert.equal(state.phase, 'backfill');
	assert.equal(state.visible, TRANSCRIPT_TAIL_WINDOW_SECTIONS + 1);
});

test('backfill completes when the window reaches the total', () => {
	let state: TranscriptStagingState = {
		key: 'task-a',
		total: 6,
		visible: 5,
		phase: 'backfill'
	};
	state = advanceTranscriptStaging(state, TRANSCRIPT_BACKFILL_BATCH_SECTIONS);
	assert.deepEqual(state, {key: 'task-a', total: 6, visible: 6, phase: 'complete'});
});

test('cold slim focus waits for its body before deciding whether to stage', () => {
	const waiting = reconcileTranscriptStaging(empty, {
		key: 'task-cold',
		total: 0,
		loading: true,
		revisited: false
	});
	assert.equal(waiting.phase, 'waiting');

	const loaded = reconcileTranscriptStaging(waiting, {
		key: 'task-cold',
		total: 12,
		loading: false,
		revisited: false
	});
	assert.equal(loaded.phase, 'staging');
	assert.equal(loaded.visible, 1);
});

test('small authoritative Transcript completes without staging', () => {
	const state = reconcileTranscriptStaging(empty, {
		key: 'task-small',
		total: 1,
		loading: false,
		revisited: false
	});
	assert.deepEqual(state, {key: 'task-small', total: 1, visible: 1, phase: 'complete'});
});

test('new Turn while the window is open stays visible without full mount', () => {
	const staging = reconcileTranscriptStaging(empty, {
		key: 'task-a',
		total: 10,
		loading: false,
		revisited: false
	});
	const changed = reconcileTranscriptStaging(staging, {
		key: 'task-a',
		total: 11,
		loading: false,
		revisited: false
	});
	// Window top boundary stable: visible grew by the appended delta only.
	assert.equal(changed.phase, 'staging');
	assert.equal(changed.total, 11);
	assert.equal(changed.visible, staging.visible + 1);
});

test('revisited Task starts at the tail window instead of mounting everything', () => {
	const revisited = reconcileTranscriptStaging(
		{key: 'task-b', total: 20, visible: 20, phase: 'complete'},
		{
			key: 'task-a',
			total: 40,
			loading: false,
			revisited: true
		}
	);
	assert.deepEqual(revisited, {
		key: 'task-a',
		total: 40,
		visible: TRANSCRIPT_TAIL_WINDOW_SECTIONS,
		phase: 'backfill'
	});
});

test('revisited short Task completes immediately', () => {
	const revisited = reconcileTranscriptStaging(empty, {
		key: 'task-short',
		total: TRANSCRIPT_TAIL_WINDOW_SECTIONS,
		loading: false,
		revisited: true
	});
	assert.equal(revisited.phase, 'complete');
	assert.equal(revisited.visible, TRANSCRIPT_TAIL_WINDOW_SECTIONS);
});

test('near-top reveal pages in older sections during backfill', () => {
	let state: TranscriptStagingState = {
		key: 'task-a',
		total: 20,
		visible: TRANSCRIPT_TAIL_WINDOW_SECTIONS,
		phase: 'backfill'
	};
	state = advanceTranscriptStaging(state, TRANSCRIPT_REVEAL_PAGE_SECTIONS);
	assert.equal(state.phase, 'backfill');
	assert.equal(state.visible, TRANSCRIPT_TAIL_WINDOW_SECTIONS + TRANSCRIPT_REVEAL_PAGE_SECTIONS);
});

test('switching to an unseen Task interrupts the old window and starts at its tail', () => {
	const old = reconcileTranscriptStaging(empty, {
		key: 'task-a',
		total: 20,
		loading: false,
		revisited: false
	});
	const next = reconcileTranscriptStaging(old, {
		key: 'task-b',
		total: 5,
		loading: false,
		revisited: false
	});
	assert.deepEqual(next, {key: 'task-b', total: 5, visible: 1, phase: 'staging'});
});

test('visibleTranscriptSections preserves whole section objects from the newest tail', () => {
	const sections = [{id: 'one'}, {id: 'two'}, {id: 'three'}];
	const staged = visibleTranscriptSections(sections, {
		key: 'task-a',
		total: 3,
		visible: 2,
		phase: 'staging'
	});
	assert.deepEqual(staged.map(s => s.id), ['two', 'three']);
	assert.equal(staged[0], sections[1]);
	const backfill = visibleTranscriptSections(sections, {
		key: 'task-a',
		total: 3,
		visible: 2,
		phase: 'backfill'
	});
	assert.deepEqual(backfill.map(s => s.id), ['two', 'three']);
	assert.equal(
		visibleTranscriptSections(sections, {
			key: 'task-a',
			total: 3,
			visible: 3,
			phase: 'complete'
		}),
		sections
	);
});
