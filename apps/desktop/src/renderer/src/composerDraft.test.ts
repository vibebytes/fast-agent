import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	createComposerDraftStore,
	createTaskComposerDraftStore,
	rememberDraft,
	rememberedDraft
} from './composerDraft.js';

test('Composer draft store notifies only its own subscribers', () => {
	const composer = createComposerDraftStore();
	const other = createComposerDraftStore('untouched');
	let composerTicks = 0;
	let otherTicks = 0;
	composer.subscribe(() => {
		composerTicks += 1;
	});
	other.subscribe(() => {
		otherTicks += 1;
	});

	composer.setDraft('hello');

	assert.equal(composer.getSnapshot(), 'hello');
	assert.equal(other.getSnapshot(), 'untouched');
	assert.equal(composerTicks, 1);
	assert.equal(otherTicks, 0);
});

test('Composer clear and restore update draft without touching another store', () => {
	const composer = createComposerDraftStore('draft');
	const transcriptMirror = createComposerDraftStore('should-stay');
	let transcriptTicks = 0;
	transcriptMirror.subscribe(() => {
		transcriptTicks += 1;
	});

	composer.clear();
	assert.equal(composer.getSnapshot(), '');
	composer.restore('retry me');
	assert.equal(composer.getSnapshot(), 'retry me');
	assert.equal(transcriptMirror.getSnapshot(), 'should-stay');
	assert.equal(transcriptTicks, 0);
});

test('Task composer draft survives a remount for the same task id', () => {
	rememberDraft('task-a', '');
	rememberDraft('task-b', '');
	const a1 = createTaskComposerDraftStore('task-a');
	a1.setDraft('hello from A');
	const b = createTaskComposerDraftStore('task-b');
	b.setDraft('hello from B');

	const a2 = createTaskComposerDraftStore('task-a');
	assert.equal(a2.getSnapshot(), 'hello from A');
	assert.equal(rememberedDraft('task-b'), 'hello from B');

	a2.clear();
	assert.equal(rememberedDraft('task-a'), '');
});