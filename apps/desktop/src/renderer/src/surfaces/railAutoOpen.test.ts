import assert from 'node:assert/strict';
import test from 'node:test';
import {railOpenIntent} from './railAutoOpen.js';
import type {SurfaceOpenIntent} from './surfaceTabs.js';

const OPEN = {
	extId: 'vibe3d',
	surfaceId: 'vibe3d.editor',
	url: 'http://127.0.0.1:7345/?t=tok'
};

function open(partial: Partial<SurfaceOpenIntent>): SurfaceOpenIntent {
	return {...OPEN, ...partial};
}

test('the first open of an instance expands the collapsed rail', () => {
	const seen = new Set<string>();
	assert.equal(railOpenIntent(seen, OPEN), true);
});

test('a replay of the same instance never reopens a rail the user collapsed', () => {
	const seen = new Set<string>();
	assert.equal(railOpenIntent(seen, OPEN), true);
	assert.equal(railOpenIntent(seen, OPEN), false);
	assert.equal(railOpenIntent(seen, open({roomId: 'r_1'})), false);
});

test('a new url or instance key after a daemon restart is a genuine open again', () => {
	const seen = new Set<string>();
	assert.equal(railOpenIntent(seen, OPEN), true);
	assert.equal(railOpenIntent(seen, open({url: 'http://127.0.0.1:9999/?t=tok'})), true);
	assert.equal(
		railOpenIntent(seen, open({url: 'http://127.0.0.1:9999/?t=tok', instanceKey: 'k2'})),
		true
	);
});

test('instances are tracked per ext/surface pair independently', () => {
	const seen = new Set<string>();
	assert.equal(railOpenIntent(seen, OPEN), true);
	assert.equal(railOpenIntent(seen, open({extId: 'other'})), true);
	assert.equal(railOpenIntent(seen, open({surfaceId: 'other.panel'})), true);
});
