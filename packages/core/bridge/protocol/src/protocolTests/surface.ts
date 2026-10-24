import assert from 'node:assert/strict';
import test from 'node:test';
import {bridgeEventPayloadSchema} from '../protocol.js';

test('surface_open parses with instance url and room', () => {
	const parsed = bridgeEventPayloadSchema.parse({
		type: 'surface_open',
		extId: 'vibe3d',
		surfaceId: 'vibe3d.editor',
		instanceKey: 'vibe3d.editor',
		url: 'http://127.0.0.1:7345/r/kitchen',
		roomId: 'kitchen'
	});
	assert.equal(parsed.type, 'surface_open');
	if (parsed.type !== 'surface_open') return;
	assert.equal(parsed.url, 'http://127.0.0.1:7345/r/kitchen');
	assert.equal(parsed.roomId, 'kitchen');
});

test('surface_state only accepts the four known states', () => {
	assert.equal(
		bridgeEventPayloadSchema.parse({
			type: 'surface_state',
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			state: 'down',
			detail: 'health'
		}).type,
		'surface_state'
	);
	assert.throws(() =>
		bridgeEventPayloadSchema.parse({
			type: 'surface_state',
			extId: 'vibe3d',
			surfaceId: 'vibe3d.editor',
			state: 'starting'
		})
	);
});
