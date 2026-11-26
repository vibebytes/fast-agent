import assert from 'node:assert/strict';
import test from 'node:test';
import {revealFirstDiffWhenReady} from './diffReveal';

test('reveals the first diff after Monaco finishes computing, then stops auto-scrolling', () => {
	let reveals = 0;
	let listener: (() => void) | undefined;
	const editor = {
		revealFirstDiff: () => {
			reveals += 1;
		},
		onDidUpdateDiff: (next: () => void) => {
			listener = next;
		}
	};
	revealFirstDiffWhenReady(editor);
	assert.equal(reveals, 1);
	assert.ok(listener);
	listener!();
	assert.equal(reveals, 2);
	listener!();
	assert.equal(reveals, 2);
});
