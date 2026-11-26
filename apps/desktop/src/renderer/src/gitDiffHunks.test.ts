import assert from 'node:assert/strict';
import test from 'node:test';
import type {GitFileDiff} from '@fast-ide/session-view';
import {gitDiffHunks, gitDiffOverlay} from './gitDiffHunks';
import {overlayAnchorsMatch, overlayLineAt} from './review/agentReview';

const diff: GitFileDiff = {
	path: 'a.ts',
	additions: 2,
	deletions: 1,
	hunks: [
		{
			header: '@@ -1,3 +1,4 @@ fn',
			lines: ['-old', '+new', '+added', ' context', ' last']
		}
	],
	original: 'old\ncontext\nlast',
	modified: 'new\nadded\ncontext\nlast'
};

test('maps Git hunk lines onto old and new line numbers', () => {
	const [hunk] = gitDiffHunks(diff);
	assert.equal(hunk?.header, '@@ -1,3 +1,4 @@ fn');
	assert.equal(hunk?.additions, 2);
	assert.equal(hunk?.deletions, 1);
	assert.equal(hunk?.targetLine, 1);
	assert.deepEqual(
		hunk?.lines.map(line => ({
			kind: line.kind,
			oldLine: line.oldLine,
			newLine: line.newLine,
			text: line.text
		})),
		[
			{kind: 'del', oldLine: 1, newLine: null, text: 'old'},
			{kind: 'add', oldLine: null, newLine: 1, text: 'new'},
			{kind: 'add', oldLine: null, newLine: 2, text: 'added'},
			{kind: 'context', oldLine: 2, newLine: 3, text: 'context'},
			{kind: 'context', oldLine: 3, newLine: 4, text: 'last'}
		]
	);
});

test('converts Git hunks into editor overlay anchors', () => {
	const overlay = gitDiffOverlay(diff, gitDiffHunks(diff));
	assert.ok(overlay);
	assert.equal(overlay.broken, false);
	assert.equal(overlay.hunks.length, 1);
	assert.deepEqual(overlay.hunks[0], {
		oldStart: 1,
		oldLines: 3,
		newStart: 1,
		newLines: 4,
		lines: [
			{kind: 'del', oldLine: 1, newLine: null, text: 'old'},
			{kind: 'add', oldLine: null, newLine: 1, text: 'new'},
			{kind: 'add', oldLine: null, newLine: 2, text: 'added'},
			{kind: 'context', oldLine: 2, newLine: 3, text: 'context'},
			{kind: 'context', oldLine: 3, newLine: 4, text: 'last'}
		]
	});
	assert.equal(overlayAnchorsMatch(overlay.hunks, overlayLineAt(diff.modified ?? '')), true);
});

test('reuses parsed hunks instead of re-parsing the Git diff', () => {
	assert.equal(gitDiffOverlay(diff, []), null);
	assert.equal(gitDiffOverlay({...diff, hunks: []}, gitDiffHunks(diff))?.hunks.length, 1);
});

test('strips CRLF from Git hunk lines before anchoring', () => {
	const [hunk] = gitDiffHunks({
		...diff,
		hunks: [{header: '@@ -1 +1 @@\r', lines: ['-old\r', '+new\r']}]
	});
	assert.deepEqual(hunk?.lines, [
		{kind: 'del', oldLine: 1, newLine: null, text: 'old'},
		{kind: 'add', oldLine: null, newLine: 1, text: 'new'}
	]);
});

test('keeps malformed hunk headers visible without anchors', () => {
	const [hunk] = gitDiffHunks({
		...diff,
		hunks: [{header: '@@ malformed @@', lines: ['+one']}]
	});
	assert.equal(hunk?.header, '@@ malformed @@');
	assert.equal(hunk?.lines[0]?.kind, 'add');
	assert.equal(hunk?.lines[0]?.newLine, null);
});
