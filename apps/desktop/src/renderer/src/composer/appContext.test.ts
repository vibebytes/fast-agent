import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	appContextSnapshot,
	clearAppContexts,
	readAppContext,
	removeAppContext,
	setAppContext,
	subscribeAppContext
} from './appContext';

test('reads text, image and resource link blocks', () => {
	const draft = readAppContext({
		content: [
			{type: 'text', text: 'mesh 12k tris'},
			{type: 'image', data: 'AAA', mimeType: 'image/png', name: 'viewport.png'},
			{type: 'resource_link', uri: 'ui://vibe3d/viewport.html', name: 'viewport'},
			{type: 'audio', data: 'zzz'}
		]
	});
	assert.deepEqual(draft.text, ['mesh 12k tris']);
	assert.deepEqual(draft.images, [{data: 'AAA', mimeType: 'image/png', name: 'viewport.png'}]);
	assert.deepEqual(draft.links, [{uri: 'ui://vibe3d/viewport.html', name: 'viewport'}]);
});

test('ignores an empty or malformed payload', () => {
	assert.deepEqual(readAppContext({}), {text: [], images: [], links: []});
	assert.deepEqual(readAppContext(null), {text: [], images: [], links: []});
	assert.deepEqual(readAppContext({content: 'nope'}), {text: [], images: [], links: []});
});

test('keeps one entry per tool call and notifies subscribers', () => {
	let hits = 0;
	const off = subscribeAppContext(() => {
		hits += 1;
	});
	const entry = {
		id: 'srv\u0000ui://a\u0000call-1',
		server: 'srv',
		title: 'A',
		toolCallId: 'call-1',
		text: ['first'],
		images: [],
		links: []
	};
	setAppContext(entry);
	setAppContext({...entry, text: ['second']});
	assert.equal(appContextSnapshot().length, 1);
	assert.deepEqual(appContextSnapshot()[0]?.text, ['second']);
	removeAppContext(entry.id);
	assert.equal(appContextSnapshot().length, 0);
	assert.equal(hits, 3);
	off();
	clearAppContexts();
});
