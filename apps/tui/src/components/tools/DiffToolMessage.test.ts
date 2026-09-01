import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diffPreview, parseDiffWithLineNumbers} from './DiffToolMessage.js';

const hunkWithLeadingContext = [
	'@@ -123,11 +123,11 @@',
	' waitForEvent("ready") shouldBe defined',
	' ',
	' // 2. Send StartSession -> wait for session_ready',
	' val sessionId = waitForEvent("session_ready").get.payload',
	'-oldLine()',
	'+newLine()',
	' // trailing context a',
	' // trailing context b',
	' // trailing context c',
	' // trailing context d',
	' // trailing context e'
].join('\n');

test('diffPreview keeps head when first change already fits', () => {
	const lines = parseDiffWithLineNumbers([
		'@@ -1,3 +1,3 @@',
		'-a',
		'+b',
		' c'
	].join('\n')).filter(l => l.type !== 'other');
	const preview = diffPreview(lines, 4);
	assert.equal(preview.length, 4);
	assert.equal(preview[0]?.type, 'hunk');
	assert.equal(preview[1]?.type, 'del');
	assert.equal(preview[2]?.type, 'add');
});

test('diffPreview skips leading context so compact budget shows the change', () => {
	const lines = parseDiffWithLineNumbers(hunkWithLeadingContext).filter(l => l.type !== 'other');
	assert.ok(lines.length > 4);
	const preview = diffPreview(lines, 4);
	assert.equal(preview.length, 4);
	assert.equal(preview[0]?.type, 'hunk');
	assert.ok(preview.some(l => l.type === 'del'), 'must show deletion');
	assert.ok(preview.some(l => l.type === 'add'), 'must show addition');
	assert.ok(!preview.some(l => l.type === 'context' && l.content.includes('waitForEvent')), 'must skip leading context');
});

test('diffPreview uses nearest hunk before the first change', () => {
	const lines = parseDiffWithLineNumbers([
		'@@ -1,4 +1,4 @@',
		' a',
		' b',
		' c',
		' d',
		'@@ -20,5 +20,5 @@',
		' x',
		' y',
		' z',
		'-old',
		'+new'
	].join('\n')).filter(l => l.type !== 'other');
	const preview = diffPreview(lines, 4);
	assert.equal(preview[0]?.type, 'hunk');
	assert.match(preview[0]!.content, /@@ -20/);
	assert.ok(preview.some(l => l.type === 'del'));
	assert.ok(preview.some(l => l.type === 'add'));
});

test('diffPreview returns full list when within budget', () => {
	const lines = parseDiffWithLineNumbers([
		'@@ -1,2 +1,2 @@',
		'-a',
		'+b'
	].join('\n')).filter(l => l.type !== 'other');
	assert.deepEqual(diffPreview(lines, 9), lines);
});
