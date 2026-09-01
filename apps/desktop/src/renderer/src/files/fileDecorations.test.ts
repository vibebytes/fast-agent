import assert from 'node:assert/strict';
import test from 'node:test';
import type {ReviewList} from '@fast-ide/session-view';
import {
	agentFilesMap,
	aggregateAgentKind,
	aggregateDirKind,
	gitFilesMap,
	gitKindAt
} from './fileDecorations.js';

const list = (
	changes: Array<{path: string; kind: string; state: string}>
): ReviewList => ({
	revision: 1,
	available: true,
	changes: changes.map((c, i) => ({
		id: `chg-${i}`,
		checkpointId: 'ckpt',
		path: c.path,
		kind: c.kind as never,
		state: {kind: c.state as never}
	}))
});

/**
 * A kept change is the user's own file now and a reverted one is not in the tree at all, so marking
 * either would leave a badge that never clears.
 */
test('only undecided agent changes get a marker', () => {
	const map = agentFilesMap(
		list([
			{path: 'src/a.ts', kind: 'modified', state: 'pending'},
			{path: 'src/b.ts', kind: 'added', state: 'kept'},
			{path: 'src/c.ts', kind: 'deleted', state: 'reverted'},
			{path: 'src/d.ts', kind: 'modified', state: 'conflict'}
		])
	);
	assert.deepEqual([...map.keys()].sort(), ['src/a.ts', 'src/d.ts']);
	assert.equal(agentFilesMap(undefined).size, 0);
});

test('a directory takes the worst kind under it, per overlay', () => {
	const agent = agentFilesMap(
		list([
			{path: 'src/a.ts', kind: 'modified', state: 'pending'},
			{path: 'src/nested/b.ts', kind: 'renamed', state: 'pending'},
			{path: 'other/c.ts', kind: 'deleted', state: 'pending'}
		])
	);
	assert.equal(aggregateAgentKind('src', agent), 'renamed');
	assert.equal(aggregateAgentKind('other', agent), 'deleted');
	assert.equal(aggregateAgentKind('nothing', agent), null);
	// The root sees everything, which is what makes a collapsed tree still show the change.
	assert.equal(aggregateAgentKind('', agent), 'renamed');

	const git = gitFilesMap([
		{path: 'src/a.ts', kind: 'modified'},
		{path: 'src/b.ts', kind: 'deleted'}
	]);
	assert.equal(aggregateDirKind('src', git), 'deleted');
});

test('gitKindAt inherits added from untracked directory marker', () => {
	const git = gitFilesMap([{path: 'reports/', kind: 'added'}]);
	assert.equal(gitKindAt('reports/aapl.html', git), 'added');
	assert.equal(aggregateDirKind('reports', git), 'added');
	assert.equal(gitKindAt('other.html', git), null);
});

/** `src2` is not under `src`; a plain prefix test would say it was. */
test('a sibling directory with a shared prefix is not counted', () => {
	const agent = agentFilesMap(list([{path: 'src2/a.ts', kind: 'deleted', state: 'pending'}]));
	assert.equal(aggregateAgentKind('src', agent), null);
	assert.equal(aggregateAgentKind('src2', agent), 'deleted');
});
