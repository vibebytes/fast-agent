import assert from 'node:assert/strict';
import test from 'node:test';
import type {ReviewChangeDetail} from '@fast-ide/session-view';
import {combinedDiffView, diffView, drifted} from './diffSides.js';

function detail(over: Partial<ReviewChangeDetail> = {}): ReviewChangeDetail {
	return {
		id: 'chg-1',
		checkpointId: 'ckpt-1',
		path: 'a.txt',
		kind: 'modified',
		state: {kind: 'pending'},
		before: {id: 'blob-b', text: 'one\n'},
		after: {id: 'blob-a', text: 'two\n'},
		current: {id: 'blob-a', text: 'two\n'},
		...over
	} as ReviewChangeDetail;
}

test('the default pair is the agent change, not whatever is on disk', () => {
	const view = diffView(detail(), 'agent');
	assert.equal(view.original, 'one\n');
	assert.equal(view.modified, 'two\n');
	assert.equal(view.blocked, null);
});

test('an added file diffs against an empty document, a deleted file into one', () => {
	const added = diffView(detail({kind: 'added', before: null}), 'agent');
	assert.equal(added.original, '');
	assert.equal(added.blocked, null);

	const deleted = diffView(detail({kind: 'deleted', after: null, current: null}), 'agent');
	assert.equal(deleted.modified, '');
	assert.equal(deleted.blocked, null);
});

test('drift is judged by blob id, so it survives a side that was too large to inline', () => {
	assert.equal(drifted(detail()), false);
	assert.equal(drifted(detail({current: {id: 'blob-c', text: 'three\n'}})), true);
	assert.equal(
		drifted(detail({current: {id: 'blob-c', bytes: 9_000_000, omitted: 'too-large'}})),
		true
	);
	// A delete the user has not touched: no after, no current, and no drift to report.
	assert.equal(drifted(detail({after: null, current: null})), false);
});

test('an omitted side blocks the pair that needs it and leaves the others usable', () => {
	const lost = detail({before: {id: 'blob-b', omitted: 'missing'}});
	assert.match(diffView(lost, 'agent').blocked ?? '', /cannot be undone/);
	assert.equal(diffView(lost, 'since').blocked, null);

	const binary = detail({after: {id: 'blob-a', omitted: 'binary'}});
	assert.match(diffView(binary, 'agent').blocked ?? '', /Binary/);
	assert.equal(diffView(binary, 'net').blocked, null);
});

test('a single detail combines to the same view as diffView', () => {
	const d = detail();
	const combined = combinedDiffView([d], 'agent');
	assert.equal(combined.broken, false);
	assert.equal(combined.view.original, 'one\n');
	assert.equal(combined.view.modified, 'two\n');
});

test('a chained multi-edit file shows one cumulative diff, first before → last after', () => {
	const first = detail({
		id: 'chg-1',
		before: {id: 'blob-0', text: 'one\n'},
		after: {id: 'blob-1', text: 'two\n'},
		current: {id: 'blob-1', text: 'two\n'}
	});
	const second = detail({
		id: 'chg-2',
		before: {id: 'blob-1', text: 'two\n'},
		after: {id: 'blob-2', text: 'three\n'},
		current: {id: 'blob-2', text: 'three\n'}
	});
	const combined = combinedDiffView([first, second], 'agent');
	assert.equal(combined.broken, false);
	assert.equal(combined.view.original, 'one\n');
	assert.equal(combined.view.modified, 'three\n');
});

test('a broken chain (user edit between agent edits) falls back to the head change', () => {
	const first = detail({
		id: 'chg-1',
		before: {id: 'blob-0', text: 'one\n'},
		after: {id: 'blob-1', text: 'two\n'},
		current: {id: 'blob-1', text: 'two\n'}
	});
	// The user edited on top, so the second agent change starts from a blob the first never produced.
	const second = detail({
		id: 'chg-2',
		before: {id: 'blob-user', text: 'user edit\n'},
		after: {id: 'blob-2', text: 'three\n'},
		current: {id: 'blob-2', text: 'three\n'}
	});
	const combined = combinedDiffView([first, second], 'agent');
	assert.equal(combined.broken, true);
	assert.equal(combined.view.original, 'user edit\n');
	assert.equal(combined.view.modified, 'three\n');
});

test('an empty list yields an empty, unblocked view', () => {
	const combined = combinedDiffView([], 'agent');
	assert.equal(combined.broken, false);
	assert.equal(combined.view.original, '');
	assert.equal(combined.view.modified, '');
	assert.equal(combined.view.blocked, null);
});
