import assert from 'node:assert/strict';
import test from 'node:test';
import {restoreSurfaceTabs, readSurfaceTabs, serializeSurfaceTabs} from './surfacePersistence.js';
import {surfaceTab} from './surfaceTabs.js';

function openTab(url: string) {
	const base = surfaceTab({extId: 'vibe3d', surfaceId: 'editor', title: 'Vibe3D'});
	return {...base, surface: {...base.surface!, url, roomId: 'r_abc12345'}};
}

test('serialize keeps only opened instances', () => {
	const closed = surfaceTab({extId: 'vibe3d', surfaceId: 'closed', title: 'Closed'});
	const rows = JSON.parse(serializeSurfaceTabs([closed, openTab('http://127.0.0.1:9/x')]));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].surfaceId, 'editor');
	assert.equal(rows[0].url, 'http://127.0.0.1:9/x');
});

test('read drops malformed rows instead of throwing', () => {
	assert.deepEqual(readSurfaceTabs(null), []);
	assert.deepEqual(readSurfaceTabs('not json'), []);
	assert.deepEqual(readSurfaceTabs('[{"extId":"a"}]'), []);
	assert.equal(readSurfaceTabs('[{"extId":"a","surfaceId":"b","title":"t","url":"http://x"}]').length, 1);
});

test('restore upserts over an existing tab and never duplicates', () => {
	const raw = serializeSurfaceTabs([openTab('http://127.0.0.1:9/old')]);
	const restored = restoreSurfaceTabs([], raw);
	assert.equal(restored.length, 1);
	assert.equal(restored[0].id, 'surface:vibe3d:editor');
	assert.equal(restored[0].surface?.url, 'http://127.0.0.1:9/old');

	const again = restoreSurfaceTabs(restored, serializeSurfaceTabs([openTab('http://127.0.0.1:9/new')]));
	assert.equal(again.length, 1);
	assert.equal(again[0].surface?.url, 'http://127.0.0.1:9/new');
	assert.equal(again[0].surface?.roomId, 'r_abc12345');
});
