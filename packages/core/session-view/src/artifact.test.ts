import test from 'node:test';
import assert from 'node:assert/strict';

import {parseArtifactSpec, readArtifact, stripArtifact} from './artifact.js';

const spec = {
	kind: 'scene',
	title: 'Clay mannequin fight',
	subtitle: 'vibe3d · room r_ab12cd34',
	meta: ['12 objects', '2.1 MB'],
	open: {kind: 'app', server: 'vibe3d', resourceUri: 'ui://vibe3d/editor/r_ab12cd34'}
};

test('a tagged block becomes a card spec', () => {
	const output = `room created\n<fast-artifact>${JSON.stringify(spec)}</fast-artifact>\n`;
	assert.deepEqual(readArtifact(output), spec);
});

test('a fenced block is accepted too, so JSON stays readable in the log', () => {
	const output = ['done', '```fast-artifact', JSON.stringify(spec), '```', 'bye'].join('\n');
	assert.deepEqual(readArtifact(output), spec);
});

test('stripping the block leaves the human log intact', () => {
	const output = `room created\n<fast-artifact>${JSON.stringify(spec)}</fast-artifact>\nready`;
	assert.equal(stripArtifact(output), 'room created\n\nready');
	assert.equal(stripArtifact(null), '');
});

test('a spec without a title, or whose open target is unsafe, yields no card', () => {
	assert.equal(parseArtifactSpec({kind: 'scene'}), null);
	assert.equal(parseArtifactSpec({title: '   '}), null);
	assert.equal(
		parseArtifactSpec({title: 'x', open: {kind: 'app', server: 'vibe3d', resourceUri: 'javascript:alert(1)'}}),
		null
	);
	assert.equal(parseArtifactSpec({title: 'x', open: {kind: 'file', path: '/etc/passwd'}}), null);
	assert.equal(parseArtifactSpec({title: 'x', open: {kind: 'file', path: 'a/../../b.md'}}), null);
});

test('unknown kinds fall back to other, chips are capped, absent open is allowed', () => {
	const parsed = parseArtifactSpec({
		kind: 'hologram',
		title: '  Report   draft ',
		meta: ['a', 'b', 'c', 'd', 'e']
	});
	assert.deepEqual(parsed, {kind: 'other', title: 'Report draft', meta: ['a', 'b', 'c', 'd']});
});

test('a surface target keeps the producer pane ids and an http url only', () => {
	const spec = parseArtifactSpec({
		title: 'Room',
		open: {
			kind: 'surface',
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			url: 'http://127.0.0.1:5123/#/editor/r/r_ab12cd34',
			instanceKey: 'vibe3d.editor',
			roomId: 'r_ab12cd34'
		}
	});
	assert.equal(spec?.open?.kind, 'surface');
	assert.equal(
		parseArtifactSpec({
			title: 'x',
			open: {kind: 'surface', extId: 'vibe3d', surfaceId: 'e', url: 'file:///etc/passwd'}
		}),
		null
	);
});

test('ordinary tool output never produces a card', () => {
	assert.equal(readArtifact('exit 0\nno artifact here'), null);
	assert.equal(readArtifact('<fast-artifact>not json</fast-artifact>'), null);
	assert.equal(readArtifact(null), null);
});
