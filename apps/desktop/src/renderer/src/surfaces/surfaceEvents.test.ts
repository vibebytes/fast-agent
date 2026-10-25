import assert from 'node:assert/strict';
import test from 'node:test';
import {parseSurfaceOpen, parseSurfaceState, surfacesReloadOn} from './surfaceEvents.js';

test('surfacesReloadOn only echoes extension list changes, never open/state replays', () => {
	assert.equal(surfacesReloadOn('extensions_changed'), true);
	assert.equal(surfacesReloadOn('surface_open'), false);
	assert.equal(surfacesReloadOn('surface_state'), false);
	assert.equal(surfacesReloadOn(undefined), false);
});

test('parseSurfaceOpen requires the surface_open discriminator', () => {
	assert.equal(
		parseSurfaceOpen({type: 'workspace_file_changed', extId: 'vibe3d', surfaceId: 'a', url: 'http://x'}),
		null
	);
});

test('parseSurfaceOpen accepts an http instance url and keeps optional fields', () => {
	assert.deepEqual(
		parseSurfaceOpen({
			type: 'surface_open',
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			instanceKey: 'vibe3d.editor',
			url: 'http://127.0.0.1:7345/r/kitchen',
			roomId: 'kitchen',
			title: 'Vibe3D'
		}),
		{
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			url: 'http://127.0.0.1:7345/r/kitchen',
			instanceKey: 'vibe3d.editor',
			roomId: 'kitchen',
			title: 'Vibe3D'
		}
	);
});

test('parseSurfaceOpen rejects non-http urls', () => {
	assert.equal(
		parseSurfaceOpen({type: 'surface_open', extId: 'e', surfaceId: 's', url: 'javascript:alert(1)'}),
		null
	);
});

test('parseSurfaceState whitelists the state enum', () => {
	assert.deepEqual(
		parseSurfaceState({type: 'surface_state', extId: 'vibe3d', surfaceId: 's', state: 'down', detail: 'health'}),
		{extId: 'vibe3d', surfaceId: 's', state: 'down', detail: 'health'}
	);
	assert.equal(
		parseSurfaceState({type: 'surface_state', extId: 'vibe3d', surfaceId: 's', state: 'starting'}),
		null
	);
});
