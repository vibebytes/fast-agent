import assert from 'node:assert/strict';
import test from 'node:test';
import {
	allowFrom,
	hostReady,
	hostToken,
	readPageMsg,
	readyAccepted,
	surfaceSandbox
} from './surfaceHandshake.js';

const ORIGIN = 'http://127.0.0.1:7345';

test('allowFrom always grants webgl and fullscreen', () => {
	const allow = allowFrom([]);
	assert.match(allow, /webgl/);
	assert.match(allow, /fullscreen/);
	assert.doesNotMatch(allow, /clipboard/);
});

test('allowFrom grants clipboard only when declared', () => {
	assert.match(allowFrom(['clipboard']), /clipboard-write/);
});

test('surfaceSandbox never grants same-origin', () => {
	const sandbox = surfaceSandbox();
	assert.match(sandbox, /allow-scripts/);
	assert.doesNotMatch(sandbox, /allow-same-origin/);
});

test('readPageMsg drops messages from another origin', () => {
	const msg = {kind: 'surface.ready', capabilities: []};
	assert.equal(readPageMsg(msg, 'http://evil.example', ORIGIN), null);
});

test('readPageMsg drops unknown kinds and non-objects', () => {
	assert.equal(readPageMsg({kind: 'host.token', token: 'x'}, ORIGIN, ORIGIN), null);
	assert.equal(readPageMsg('surface.ready', ORIGIN, ORIGIN), null);
	assert.equal(readPageMsg(null, ORIGIN, ORIGIN), null);
});

test('readPageMsg normalizes surface.ready capabilities', () => {
	const msg = readPageMsg(
		{kind: 'surface.ready', capabilities: ['tool.call', 'clipboard']},
		ORIGIN,
		ORIGIN
	);
	assert.deepEqual(msg, {kind: 'surface.ready', capabilities: ['tool.call', 'clipboard']});
});

test('readPageMsg drops a surface.ready with an unknown capability', () => {
	assert.equal(
		readPageMsg({kind: 'surface.ready', capabilities: ['scene.read']}, ORIGIN, ORIGIN),
		null
	);
});

test('readPageMsg accepts surface.openExternal with a string url', () => {
	assert.deepEqual(readPageMsg({kind: 'surface.openExternal', url: 'https://x.dev'}, ORIGIN, ORIGIN), {
		kind: 'surface.openExternal',
		url: 'https://x.dev'
	});
	assert.equal(readPageMsg({kind: 'surface.openExternal', url: 42}, ORIGIN, ORIGIN), null);
});

test('readyAccepted requires every requested capability to be declared', () => {
	assert.equal(readyAccepted(['tool.call'], ['tool.call', 'clipboard']), true);
	assert.equal(readyAccepted(['tool.call', 'clipboard'], ['tool.call']), false);
});

test('hostReady and hostToken build the host side messages', () => {
	assert.deepEqual(
		hostReady({surfaceId: 'vibe3d.editor', instanceKey: 'vibe3d.editor', theme: 'dark', width: 800, height: 600}),
		{
			kind: 'host.ready',
			surfaceId: 'vibe3d.editor',
			instanceKey: 'vibe3d.editor',
			theme: 'dark',
			size: {width: 800, height: 600}
		}
	);
	assert.deepEqual(hostToken('tok', ['vibe3d']), {kind: 'host.token', token: 'tok', toolScope: ['vibe3d']});
});
