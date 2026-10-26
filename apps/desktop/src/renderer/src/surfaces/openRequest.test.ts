import {test} from 'node:test';
import assert from 'node:assert/strict';

import {onSurfaceOpen, onSurfaceOpenRequest, requestOpenSurface} from './openRequest.js';

const ROOM = {
	extId: 'vibe3d',
	surfaceId: 'vibe3d.editor',
	url: 'http://127.0.0.1:5123/#/editor/r/r_ab12cd34',
	instanceKey: 'vibe3d.editor',
	roomId: 'r_ab12cd34',
	title: 'Clay mannequin fight'
};

test('a click with no tab owner waits for the next mount', () => {
	const rail: string[] = [];
	const offRail = onSurfaceOpenRequest(open => rail.push(open.url));

	requestOpenSurface(ROOM);
	assert.deepEqual(rail, [ROOM.url]);

	const got: string[] = [];
	const off = onSurfaceOpen(open => got.push(open.url));
	assert.deepEqual(got, [ROOM.url]);

	off();
	offRail();
});

test('a live owner gets the click immediately and leaves nothing behind', () => {
	const live: string[] = [];
	const off = onSurfaceOpen(open => live.push(open.url));

	requestOpenSurface(ROOM);
	assert.deepEqual(live, [ROOM.url]);
	off();

	const next: string[] = [];
	const offNext = onSurfaceOpen(open => next.push(open.url));
	assert.deepEqual(next, []);
	offNext();
});

test('a second click for the same surface replaces the pending one', () => {
	requestOpenSurface({...ROOM, url: 'http://127.0.0.1:5123/#/editor/r/old'});
	requestOpenSurface({...ROOM, url: 'http://127.0.0.1:5123/#/editor/r/new'});

	const got: string[] = [];
	const off = onSurfaceOpen(open => got.push(open.url));
	assert.deepEqual(got, ['http://127.0.0.1:5123/#/editor/r/new']);
	off();
});
