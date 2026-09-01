import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import type {ReviewChange, ReviewFile, ReviewList} from '@fast-ide/session-view';
import {
	gitBlobId,
	groupChangesByPath,
	mergeReviewDiff,
	overlayAnchorsMatch,
	overlayLineAt,
	pathsCoveredBy,
	pendingChanges,
	pendingGroupForPath,
	dirtyOverlap,
	refusalAction,
	rememberReviewStats,
	restorePoint,
	restorePoints,
	reviewDiffFor,
	reviewInvalidated,
	reviewListForSession,
	reviewRowChangeIds,
	reviewRows,
	sameReviewList,
	sideNotice,
	withRenameGroups
} from './agentReview.js';

// gitBlobId uses the WebCrypto global a browser renderer provides; the node test runner does not.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const row = (over: Partial<ReviewChange>): ReviewChange => ({
	id: 'chg',
	checkpointId: 'ckpt',
	path: 'a.txt',
	kind: 'modified',
	state: {kind: 'pending'},
	...over
});

const listOf = (changes: ReviewChange[]): ReviewList => ({
	revision: 1,
	changes,
	available: true
});

test('both checkpoint pushes invalidate the list; unrelated ones do not', () => {
	assert.equal(reviewInvalidated({type: 'review_changed'}), true);
	// A restore started in another window moves the tree without moving the projection.
	assert.equal(reviewInvalidated({type: 'tree_advanced'}), true);
	assert.equal(reviewInvalidated({type: 'assistant_delta'}), false);
	assert.equal(reviewInvalidated({}), false);
});

test('a run restores to its first checkpoint, so the whole message is undone', () => {
	const list: ReviewList = {
		...listOf([]),
		checkpoints: [
			{id: 'ckpt-late', runId: 'run-1', messageId: 'msg-1', at: 200},
			{id: 'ckpt-first', runId: 'run-1', messageId: 'msg-1', at: 100},
			{id: 'ckpt-other', runId: 'run-2', messageId: null, at: 300}
		]
	};
	const points = restorePoints(list);
	assert.equal(points.get('run-1')?.id, 'ckpt-first');
	// A transcript row may be keyed by its turn rather than the run; both name the same moment.
	assert.equal(restorePoint(points, 'run-1-turn-1')?.id, 'ckpt-first');
	assert.equal(restorePoint(points, 'run-2')?.id, 'ckpt-other');
	// No checkpoint means no offer: the row must not advertise a restore that cannot happen.
	assert.equal(restorePoint(points, 'run-3'), null);
	assert.equal(restorePoint(points, undefined), null);
	assert.equal(restorePoints(listOf([])).size, 0);
});

/** The drawer is per session: a change from another run in the same checkout must not show. */
test('reviewListForSession keeps only changes whose checkpoint run is in the session', () => {
	const list: ReviewList = {
		...listOf([
			row({id: 'mine', checkpointId: 'ckpt-mine'}),
			row({id: 'other', checkpointId: 'ckpt-other'}),
			row({id: 'orphan', checkpointId: 'ckpt-unknown'})
		]),
		checkpoints: [
			{id: 'ckpt-mine', runId: 'run-1', messageId: 'msg-1', at: 100},
			{id: 'ckpt-other', runId: 'run-2', messageId: 'msg-2', at: 200}
		]
	};
	const filtered = reviewListForSession(list, new Set(['run-1']));
	assert.deepEqual(filtered.changes.map(c => c.id), ['mine']);
	// Revision and availability survive the trim — decisions still address the daemon's table.
	assert.equal(filtered.revision, list.revision);
	assert.equal(filtered.available, true);
});

test('reviewListForSession matches a turn-suffixed run id to its base checkpoint run', () => {
	const list: ReviewList = {
		...listOf([row({id: 'mine', checkpointId: 'ckpt-mine'})]),
		checkpoints: [{id: 'ckpt-mine', runId: 'run-1', messageId: 'msg-1', at: 100}]
	};
	// The timeline may key a row by its turn (`run-1-turn-1`) rather than the run itself.
	assert.deepEqual(reviewListForSession(list, new Set(['run-1-turn-1'])).changes.map(c => c.id), [
		'mine'
	]);
});

test('reviewListForSession with no known runs shows nothing recorded', () => {
	const list: ReviewList = {
		...listOf([row({id: 'mine', checkpointId: 'ckpt-mine'})]),
		checkpoints: [{id: 'ckpt-mine', runId: 'run-1', messageId: 'msg-1', at: 100}]
	};
	assert.deepEqual(reviewListForSession(list, new Set()).changes, []);
	assert.deepEqual(reviewListForSession(list, new Set(['run-9'])).changes, []);
});

test('only pending rows are still the users to decide', () => {
	const list = listOf([
		row({id: 'p'}),
		row({id: 'k', state: {kind: 'kept'}}),
		row({id: 'r', state: {kind: 'reverted'}}),
		row({id: 'c', state: {kind: 'conflict', reason: 'edited since'}})
	]);
	assert.deepEqual(pendingChanges(list).map(c => c.id), ['p']);
});

/** Half a rename is not a state the work tree can be in: the file would exist under both paths. */
test('a decision on one side of a rename covers the other', () => {
	const list = listOf([
		row({id: 'old', path: 'old.txt', kind: 'deleted', groupId: 'g1'}),
		row({id: 'new', path: 'new.txt', kind: 'renamed', groupId: 'g1'}),
		row({id: 'lone', path: 'other.txt'})
	]);
	assert.deepEqual(withRenameGroups(list, ['new']).sort(), ['new', 'old']);
	assert.deepEqual(withRenameGroups(list, ['lone']), ['lone']);
	assert.deepEqual(withRenameGroups(list, ['lone', 'old']).sort(), ['lone', 'new', 'old']);
});

/** N edits to one file collapse into a single group, oldest change first. */
test('groupChangesByPath folds repeated edits to a path into one group', () => {
	const list = listOf([
		row({id: 'c1', path: 'a.txt'}),
		row({id: 'c2', path: 'a.txt'}),
		row({id: 'c3', path: 'b.txt'})
	]);
	const groups = groupChangesByPath(list);
	assert.deepEqual([...groups.keys()].sort(), ['a.txt', 'b.txt']);
	const a = groups.get('a.txt')!;
	assert.deepEqual(a.changeIds, ['c1', 'c2']);
	assert.equal(a.headChangeId, 'c2');
	assert.equal(a.state, 'pending');
	assert.equal(groups.get('b.txt')!.headChangeId, 'c3');
});

/** A settled row must not mask an undecided one in the same group. */
test('a group stays pending while any of its changes is undecided', () => {
	const list = listOf([
		row({id: 'c1', path: 'a.txt', state: {kind: 'kept'}}),
		row({id: 'c2', path: 'a.txt'})
	]);
	assert.equal(groupChangesByPath(list).get('a.txt')!.state, 'pending');
});

/** Rename halves live under different paths, so they group separately; decisions still pair them. */
test('rename halves group by their own path, not by groupId', () => {
	const list = listOf([
		row({id: 'old', path: 'old.txt', kind: 'deleted', groupId: 'g1'}),
		row({id: 'new', path: 'new.txt', kind: 'renamed', groupId: 'g1'})
	]);
	const groups = groupChangesByPath(list);
	assert.deepEqual([...groups.keys()].sort(), ['new.txt', 'old.txt']);
	assert.equal(groups.get('old.txt')!.changeIds[0], 'old');
	assert.equal(groups.get('new.txt')!.changeIds[0], 'new');
});

/** N edits to one file surface as a single row whose decision covers every change id. */
test('reviewRows collapses repeated edits to a path into one row', () => {
	const list = listOf([
		row({id: 'c1', path: 'a.txt'}),
		row({id: 'c2', path: 'a.txt'}),
		row({id: 'c3', path: 'b.txt'})
	]);
	const rows = reviewRows(list, []);
	assert.deepEqual(rows.map(r => r.path), ['a.txt', 'b.txt']);
	const a = rows.find(r => r.path === 'a.txt')!;
	assert.equal(a.changeId, 'c2');
	assert.deepEqual(a.changeIds, ['c1', 'c2']);
	assert.equal(a.state, 'pending');
});

/** A tree click on a path must find a pending group even when prefixes disagree. */
test('pendingGroupForPath matches flexibly and ignores settled groups', () => {
	const list = listOf([
		row({id: 'c1', path: 'agent/README.md'}),
		row({id: 'c2', path: 'done.txt', state: {kind: 'kept'}})
	]);
	const hit = pendingGroupForPath(list, 'README.md');
	assert.equal(hit?.headChangeId, 'c1');
	assert.equal(pendingGroupForPath(list, 'done.txt'), null);
	assert.equal(pendingGroupForPath(list, 'missing.txt'), null);
	assert.equal(pendingGroupForPath(listOf([]), 'a.txt'), null);
});

/**
 * The daemon's record wins. An optimistic row surviving over a reverted one would offer to undo a
 * change that is already gone.
 */
test('rows come from the daemon, with live stats filled in and unrecorded paths marked capturing', () => {
	const live: ReviewFile[] = [
		{id: 'live-a', path: 'a.txt', add: 3, del: 1, status: 'done'},
		{id: 'live-z', path: 'z.txt', add: 5, del: 0, status: 'running'}
	];
	const rows = reviewRows(listOf([row({id: 'chg-a', path: 'a.txt'})]), live);

	assert.deepEqual(rows.map(r => r.path), ['a.txt', 'z.txt']);
	assert.deepEqual(
		rows.map(r => [r.state, r.changeId, r.add]),
		[
			['pending', 'chg-a', 3],
			// Written but not yet recorded: shown so the list does not lag the run, but with no id there
			// is nothing to decide on yet.
			['capturing', undefined, 5]
		]
	);
});

test('live +/- still attach when the daemon path has a workspace prefix the tool did not', () => {
	const live: ReviewFile[] = [{id: 'live', path: 'README.md', add: 2, del: 2, status: 'done'}];
	const rows = reviewRows(listOf([row({id: 'chg', path: 'agent/README.md'})]), live);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.add, 2);
	assert.equal(rows[0]!.del, 2);
	assert.equal(rows[0]!.changeId, 'chg');
});

test('remembered +/- survive after the live projection clears', () => {
	const remembered = rememberReviewStats(
		new Map(),
		[{id: 'live', path: 'agent/README.md', add: 2, del: 2, status: 'done'}]
	);
	const rows = reviewRows(listOf([row({id: 'chg', path: 'agent/README.md'})]), [], remembered);
	assert.equal(rows[0]!.add, 2);
	assert.equal(rows[0]!.del, 2);
});

test('a decided row is not resurrected by a live projection of the same path', () => {
	const rows = reviewRows(
		listOf([row({id: 'chg-a', path: 'a.txt', state: {kind: 'reverted'}})]),
		[{id: 'live-a', path: 'a.txt', add: 9, del: 9, status: 'done'}]
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.state, 'reverted');
});

test('an absent diff side says why, and lost bytes say the undo is gone too', () => {
	assert.equal(sideNotice(null), null);
	assert.equal(sideNotice({id: 'b1'}), null);
	assert.match(sideNotice({id: 'b1', omitted: 'binary'})!, /Binary/);
	assert.match(sideNotice({id: 'b1', omitted: 'too-large'})!, /Too large/);
	assert.match(sideNotice({id: 'b1', omitted: 'missing'})!, /cannot be undone/);
});

/** Each refusal has one right next move, and retrying blindly is never it. */
test('refusals are sorted into what the client should do next', () => {
	assert.equal(refusalAction({ok: false, notice: 'off', unavailable: true}), 'unavailable');
	assert.equal(refusalAction({ok: false, notice: 'stale', revision: 4}), 'resync');
	assert.equal(refusalAction({ok: false, notice: 'moved', movedPaths: ['a.txt']}), 're-preview');
	assert.equal(refusalAction({ok: false, notice: 'engine not ready'}), 'report');
	// A pruned snapshot outranks the revision it also reports: resyncing would only offer the same
	// impossible restore again, so the point has to stop being offered instead.
	assert.equal(refusalAction({ok: false, notice: 'gone', expired: true, revision: 7}), 'expired');
	// A stale revision outranks moved paths: re-previewing against a list that has moved would only
	// earn the same refusal again.
	assert.equal(
		refusalAction({ok: false, notice: 'both', revision: 9, movedPaths: ['a.txt']}),
		'resync'
	);
});

test('sameReviewList: unchanged re-fetch is content-equal, real changes are not', () => {
	const base: ReviewList = {
		...listOf([row({id: 'c1'}), row({id: 'c2', path: 'b.txt'})]),
		checkpoints: [{id: 'k1', runId: 'run-1', messageId: null, at: 100}]
	};
	const refetched: ReviewList = {
		revision: 1,
		changes: [row({id: 'c1'}), row({id: 'c2', path: 'b.txt'})],
		available: true,
		checkpoints: [{id: 'k1', runId: 'run-1', messageId: null, at: 100}]
	};
	assert.equal(sameReviewList(base, refetched), true);

	assert.equal(sameReviewList(base, {...refetched, revision: 2}), false);
	assert.equal(sameReviewList(base, {...refetched, available: false}), false);
	assert.equal(
		sameReviewList(base, {
			...refetched,
			changes: [row({id: 'c1'}), row({id: 'c2', path: 'b.txt', state: {kind: 'kept'}})]
		}),
		false
	);
	assert.equal(sameReviewList(base, {...refetched, checkpoints: []}), false);
	assert.equal(sameReviewList(base, {...refetched, changes: [row({id: 'c1'})]}), false);
});

test('reviewRowChangeIds covers the whole file group, not just the head', () => {
	const rows = reviewRows(
		listOf([row({id: 'c1', path: 'a.txt'}), row({id: 'c2', path: 'a.txt'})]),
		[]
	);
	assert.deepEqual(reviewRowChangeIds(rows[0]!), ['c1', 'c2']);
	assert.deepEqual(reviewRowChangeIds({changeId: 'only'}), ['only']);
	assert.deepEqual(reviewRowChangeIds({}), []);
});

test('pathsCoveredBy expands a rename so both halves count as dirty overlap', () => {
	const list = listOf([
		row({id: 'old', path: 'a.txt', groupId: 'g1'}),
		row({id: 'neu', path: 'b.txt', groupId: 'g1'})
	]);
	assert.deepEqual(pathsCoveredBy(list, ['old']).sort(), ['a.txt', 'b.txt']);
	assert.deepEqual(
		dirtyOverlap(['src/b.txt', 'other.ts'], ['b.txt']),
		['src/b.txt']
	);
	assert.deepEqual(dirtyOverlap(['c.txt'], ['a.txt', 'b.txt']), []);
});

test('reviewDiffFor matches flexible prefixes the way the tree overlay does', () => {
	const files = [
		{
			path: 'agent/README.md',
			changeIds: ['c1'],
			hunks: [],
			additions: 1,
			deletions: 0,
			broken: false
		}
	];
	assert.equal(reviewDiffFor(files, 'agent/README.md')?.path, 'agent/README.md');
	assert.equal(reviewDiffFor(files, 'README.md')?.path, 'agent/README.md');
	assert.equal(reviewDiffFor(files, 'missing.md'), undefined);
	const twins = [
		...files,
		{path: 'docs/README.md', changeIds: ['c2'], hunks: [], additions: 1, deletions: 0, broken: false}
	];
	assert.equal(reviewDiffFor(twins, 'README.md'), undefined);
	assert.equal(reviewDiffFor(twins, 'docs/README.md')?.path, 'docs/README.md');
});

test('mergeReviewDiff replaces a full snapshot and merges a partial one', () => {
	const a = {
		path: 'a.txt',
		changeIds: ['c1'],
		hunks: [],
		additions: 1,
		deletions: 0,
		broken: false
	};
	const b = {
		path: 'b.txt',
		changeIds: ['c2'],
		hunks: [],
		additions: 2,
		deletions: 0,
		broken: false
	};
	const prev = {revision: 1, files: [a, b]};
	const replaced = mergeReviewDiff(prev, {revision: 2, files: [b]});
	assert.deepEqual(replaced.files.map(f => f.path), ['b.txt']);

	const merged = mergeReviewDiff(prev, {
		revision: 2,
		files: [{...b, additions: 9}],
		removedPaths: ['a.txt'],
		partial: true
	});
	assert.equal(merged.revision, 2);
	assert.equal(merged.files.length, 1);
	assert.equal(merged.files[0]!.path, 'b.txt');
	assert.equal(merged.files[0]!.additions, 9);
});

test('overlayAnchorsMatch follows hunk line numbers, not the whole-file blob', () => {
	const hunks = [
		{
			lines: [
				{kind: 'context' as const, newLine: 1, text: 'keep'},
				{kind: 'add' as const, newLine: 2, text: 'added'},
				{kind: 'del' as const, oldLine: 2, text: 'gone'}
			]
		}
	];
	assert.equal(overlayAnchorsMatch(hunks, overlayLineAt('keep\nadded\n')), true);
	// CRLF / trailing newline are not drift — gitBlobId would disagree, the overlay must not.
	assert.equal(overlayAnchorsMatch(hunks, overlayLineAt('keep\r\nadded\r\n')), true);
	assert.equal(overlayAnchorsMatch(hunks, overlayLineAt('keep\nadded')), true);
	assert.equal(overlayAnchorsMatch(hunks, overlayLineAt('keep\nCHANGED\n')), false);
	assert.equal(overlayAnchorsMatch(hunks, overlayLineAt('keep\n')), false);
});

test('gitBlobId matches what git itself would name the bytes', async () => {
	// `echo hello | git hash-object --stdin` and the well-known empty-blob id.
	assert.equal(await gitBlobId('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
	assert.equal(await gitBlobId(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	// Multi-byte content hashes over UTF-8 byte length, not string length.
	assert.notEqual(await gitBlobId('变更\n'), await gitBlobId('cc\n'));
});
